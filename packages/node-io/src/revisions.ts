import { firstLine, OBJECT_ID, StepFailed } from "./gitBlobs.js";

/** The base, HEAD and their merge base as commit ids; or why they could not be found, naming the git step. */
export type Revisions = { base: string; head: string; mergeBase: string } | { unresolved: string };

/**
 * The base a run compares with HEAD, resolved once: the first `resolve()` runs `git rev-parse` for the base, then for
 * HEAD, then `git merge-base` of the two, and every later call shares that answer. The config at the merge base, the
 * test sources, the P13 and dependency sources, the stale-instruction manifests and the base-is-HEAD check all read
 * it, so one run asks git once.
 */
export interface RunRevisions {
  /** The base as the caller named it. */
  readonly base: string;
  resolve(): Promise<Revisions>;
}

const revParseArgs = (revision: string) => [
  "rev-parse",
  "--verify",
  "--quiet",
  "--end-of-options",
  `${revision}^{commit}`,
];

/**
 * The run's revisions for `base`. `printedBase` is the output of the caller's own `git rev-parse` of the base with the
 * same arguments (the Action asks it to find which ref exists), which then stands in for that call.
 */
export function runRevisions(
  deps: { git(args: string[]): Promise<string> },
  base: string,
  printedBase?: string,
): RunRevisions {
  let answer: Promise<Revisions> | undefined;
  const commit = async (revision: string, label: string, printed?: string): Promise<string> => {
    let out = printed;
    if (out === undefined) {
      try {
        out = await deps.git(revParseArgs(revision));
      } catch (err) {
        throw new StepFailed(`git rev-parse could not resolve the ${label}: ${firstLine(err)}`);
      }
    }
    const oid = out.trim();
    if (!OBJECT_ID.test(oid))
      throw new StepFailed(`git rev-parse could not resolve the ${label}: no commit id was printed`);
    return oid;
  };
  const find = async (): Promise<Revisions> => {
    try {
      const baseOid = await commit(base, "base", printedBase);
      const headOid = await commit("HEAD", "head");
      let out: string;
      try {
        out = await deps.git(["merge-base", baseOid, headOid]);
      } catch (err) {
        throw new StepFailed(`git merge-base failed: ${firstLine(err)}`);
      }
      const mergeBase = out.trim();
      if (!OBJECT_ID.test(mergeBase)) throw new StepFailed("git merge-base failed: no commit id was printed");
      return { base: baseOid, head: headOid, mergeBase };
    } catch (err) {
      return { unresolved: err instanceof StepFailed ? err.message : `git could not be read: ${firstLine(err)}` };
    }
  };
  return {
    base,
    resolve: () => {
      answer ??= find();
      return answer;
    },
  };
}

/**
 * The base and head a run names to git for the change under review (the `git diff` range, the `file:` policy at the
 * base, the fork point): the commit ids of the run's one resolution, so a base ref that moves during the run cannot make
 * the diff, the base-is-HEAD check and the reads at the base judge different commits. When the resolution failed, the
 * base as the caller named it and `HEAD`: git then refuses the range for the same reason (no such commit, no merge
 * base), and its own error is the one the run reports.
 */
export async function diffEnds(revisions: RunRevisions): Promise<{ base: string; head: string }> {
  const resolved = await revisions.resolve();
  return "unresolved" in resolved
    ? { base: revisions.base, head: "HEAD" }
    : { base: resolved.base, head: resolved.head };
}
