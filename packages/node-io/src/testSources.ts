import {
  type DiffFile,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  planTestSourceReads,
  selectTestSourcePaths,
  type TestSourceDrop,
  type TestSourceFile,
  type TestSourceObject,
  type TestSourceSide,
  type TestSources,
  unavailableTestSources,
} from "@pharn-ci/core";
import { batchCheck, batchRead, firstLine, OBJECT_ID, StepFailed } from "./gitBlobs.js";

/** The two git calls the reader makes: whole text out, and bytes out for a call that is given stdin. */
export interface TestSourceGitDeps {
  git(args: string[]): Promise<string>;
  gitBatch(args: string[], input: string): Promise<Uint8Array>;
}

export interface ReadTestSourcesOptions {
  /** The base revision; the base side is read at its merge base with the head. */
  base: string;
  /** The head revision. Default `HEAD`. */
  head?: string;
  /** The parsed diff of the change under review. */
  diff: readonly DiffFile[];
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

async function resolveRevision(deps: TestSourceGitDeps, revision: string, label: string): Promise<string> {
  let out: string;
  try {
    out = await deps.git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`]);
  } catch (err) {
    throw new StepFailed(`git rev-parse could not resolve the ${label}: ${firstLine(err)}`);
  }
  const oid = out.trim();
  if (!OBJECT_ID.test(oid))
    throw new StepFailed(`git rev-parse could not resolve the ${label}: no commit id was printed`);
  return oid;
}

async function mergeBaseOf(deps: TestSourceGitDeps, baseOid: string, headOid: string): Promise<string> {
  let out: string;
  try {
    out = await deps.git(["merge-base", baseOid, headOid]);
  } catch (err) {
    throw new StepFailed(`git merge-base failed: ${firstLine(err)}`);
  }
  const oid = out.trim();
  if (!OBJECT_ID.test(oid)) throw new StepFailed("git merge-base failed: no commit id was printed");
  return oid;
}

/**
 * The text of the test and test-config files a change touches: the base side at the merge base of `base` and `head`,
 * the head side at `head`. Reads committed git objects only, with one `merge-base`, one `cat-file --batch-check` for
 * both sides and one `cat-file --batch` for the blobs the read plan keeps. A git failure makes both sides
 * `unavailable` with a reason that names the step; this never throws.
 */
export async function readTestSources(deps: TestSourceGitDeps, options: ReadTestSourcesOptions): Promise<TestSources> {
  try {
    const baseOid = await resolveRevision(deps, options.base, "base");
    const headOid = await resolveRevision(deps, options.head ?? "HEAD", "head");
    const mergeBase = await mergeBaseOf(deps, baseOid, headOid);

    const selected = selectTestSourcePaths(options.diff);
    // A path with a control character or a path-resolution segment never reaches git's stdin.
    const requests = [
      ...selected.base.filter((path) => !isUnsafeTestSourcePath(path)).map((path) => ({ oid: mergeBase, path })),
      ...selected.head.filter((path) => !isUnsafeTestSourcePath(path)).map((path) => ({ oid: headOid, path })),
    ];
    const checked = await batchCheck(deps, requests);

    const sides: { paths: string[]; objects: Map<string, TestSourceObject | null>; blobs: Map<string, string> }[] = [
      selected.base,
      selected.head,
    ].map((paths) => ({ paths, objects: new Map(), blobs: new Map() }));
    const baseCount = selected.base.filter((path) => !isUnsafeTestSourcePath(path)).length;
    requests.forEach((request, i) => {
      const side = sides[i < baseCount ? 0 : 1];
      const result = checked[i] ?? null;
      side?.objects.set(request.path, result === null ? null : result.object);
      if (result !== null) side?.blobs.set(request.path, result.oid);
    });

    const plans = sides.map((side) => planTestSourceReads(side.paths, side.objects));
    const wanted = new Set<string>();
    plans.forEach((plan, i) => {
      for (const path of plan.read) wanted.add(sides[i]?.blobs.get(path) as string);
    });
    const contents = await batchRead(deps, [...wanted].sort(byCodeUnit));

    const decoded = new Map<string, string | null>();
    const build = (index: number): TestSourceSide => {
      const plan = plans[index];
      const side = sides[index];
      if (plan === undefined || side === undefined)
        throw new StepFailed("git cat-file --batch output could not be read");
      const files: TestSourceFile[] = [];
      const dropped: TestSourceDrop[] = [...plan.dropped];
      for (const path of plan.read) {
        const oid = side.blobs.get(path) as string;
        if (!decoded.has(oid)) decoded.set(oid, decodeTestSourceText(contents.get(oid) as Uint8Array));
        const text = decoded.get(oid) as string | null;
        if (text === null) dropped.push({ path, reason: "binary" });
        else files.push({ path, text });
      }
      dropped.sort((a, b) => byCodeUnit(a.path, b.path));
      return { files, dropped };
    };
    return { base: build(0), head: build(1) };
  } catch (err) {
    return unavailableTestSources(err instanceof StepFailed ? err.message : `git could not be read: ${firstLine(err)}`);
  }
}
