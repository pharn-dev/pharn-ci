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

/** A full object id: 40 hex digits (SHA-1) or 64 (SHA-256). */
const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
/** A `--batch-check` result line and a `--batch` header line: `<oid> <type> <size>`. */
const OBJECT_LINE = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) (\S+) (\d+)$/;
const MAX_REASON_CHARS = 300;

/** A step failed; the message is the reason the sources are unavailable. */
class StepFailed extends Error {}

const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).trim().split("\n")[0]?.slice(0, MAX_REASON_CHARS) ?? "";

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

/** `git cat-file --batch-check` for `<oid>:<path>` lines: one result per line, in order; null when absent. */
async function batchCheck(
  deps: TestSourceGitDeps,
  requests: readonly { oid: string; path: string }[],
): Promise<({ oid: string; object: TestSourceObject } | null)[]> {
  if (requests.length === 0) return [];
  const input = requests.map((r) => `${r.oid}:${r.path}\n`).join("");
  let out: Uint8Array;
  try {
    out = await deps.gitBatch(["cat-file", "--batch-check"], input);
  } catch (err) {
    throw new StepFailed(`git cat-file --batch-check failed: ${firstLine(err)}`);
  }
  const lines = Buffer.from(out).toString("utf8").split("\n");
  if (lines.pop() !== "" || lines.length !== requests.length) {
    throw new StepFailed("git cat-file --batch-check output could not be read");
  }
  return lines.map((line) => {
    const match = OBJECT_LINE.exec(line);
    return match === null
      ? null
      : { oid: match[1] as string, object: { type: match[2] as string, size: Number(match[3]) } };
  });
}

/** `git cat-file --batch` for blob ids: the bytes of each, by id. */
async function batchRead(deps: TestSourceGitDeps, oids: readonly string[]): Promise<Map<string, Uint8Array>> {
  const contents = new Map<string, Uint8Array>();
  if (oids.length === 0) return contents;
  let out: Uint8Array;
  try {
    out = await deps.gitBatch(["cat-file", "--batch"], oids.map((oid) => `${oid}\n`).join(""));
  } catch (err) {
    throw new StepFailed(`git cat-file --batch failed: ${firstLine(err)}`);
  }
  const unreadable = () => new StepFailed("git cat-file --batch output could not be read");
  let at = 0;
  for (const oid of oids) {
    const end = out.indexOf(0x0a, at);
    if (end === -1) throw unreadable();
    const header = OBJECT_LINE.exec(Buffer.from(out.subarray(at, end)).toString("utf8"));
    if (header === null || header[1] !== oid || header[2] !== "blob") throw unreadable();
    const size = Number(header[3]);
    const start = end + 1;
    if (start + size >= out.length || out[start + size] !== 0x0a) throw unreadable();
    contents.set(oid, out.subarray(start, start + size));
    at = start + size + 1;
  }
  if (at !== out.length) throw unreadable();
  return contents;
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
