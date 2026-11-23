import {
  byCodeUnit,
  type DiffFile,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  modifiedTestSourcePaths,
  planTestSourceReads,
  selectTestSourcePaths,
  type TestSourceDrop,
  type TestSourceFile,
  type TestSourceObject,
  type TestSourceReadLimits,
  type TestSourceSide,
  type TestSources,
  unavailableTestSources,
} from "@pharn-ci/core";
import { batchCheck, batchRead, firstLine, type GitBatchDeps, StepFailed } from "./gitBlobs.js";
import type { RunRevisions } from "./revisions.js";

export interface ReadTestSourcesOptions {
  /** The run's base and HEAD; the base side is read at their merge base, the head side at HEAD. */
  revisions: RunRevisions;
  /** The parsed diff of the change under review. */
  diff: readonly DiffFile[];
  /**
   * Which paths to read on each side. Default `selectTestSourcePaths` (the test and test-config files); rule P13 passes
   * `selectSelfModificationPaths`. The same caps, safety checks and decoding apply to any selection. With the default
   * selection the test files the change modifies are planned first on both sides (`modifiedTestSourcePaths`); a given
   * selection is planned in code-unit order.
   */
  select?: (diff: readonly DiffFile[]) => { base: string[]; head: string[] };
  /** The read plan's caps. Default the test sources' (`TEST_SOURCE_LIMITS`); dependency safety passes `DEPENDENCY_SOURCE_LIMITS`. */
  limits?: TestSourceReadLimits | undefined;
}

/**
 * The text of the test and test-config files a change touches: the base side at the merge base of the base and HEAD
 * (resolved once per run, see `RunRevisions`), the head side at HEAD. Reads committed git objects only, with one
 * `cat-file --batch-check` for both sides and one `cat-file --batch` for the blobs the read plan keeps. A git failure
 * makes both sides `unavailable` with a reason that names the step; this never throws.
 */
export async function readTestSources(deps: GitBatchDeps, options: ReadTestSourcesOptions): Promise<TestSources> {
  try {
    const revisions = await options.revisions.resolve();
    if ("unresolved" in revisions) return unavailableTestSources(revisions.unresolved);
    const { head: headOid, mergeBase } = revisions;

    const selected = (options.select ?? selectTestSourcePaths)(options.diff);
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

    // The default selection plans the test files the change modifies first on both sides, so added or deleted files
    // cannot use up the file cap ahead of them; a caller's own selection keeps its order.
    const modified = options.select === undefined ? modifiedTestSourcePaths(options.diff) : undefined;
    const firsts = modified === undefined ? [undefined, undefined] : [new Set(modified.base), new Set(modified.head)];
    const plans = sides.map((side, i) => planTestSourceReads(side.paths, side.objects, options.limits, firsts[i]));
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
