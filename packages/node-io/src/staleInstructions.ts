import {
  byCodeUnit,
  type DiffFile,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  MAX_TIMESTAMP_FILES,
  type StaleInstructionSources,
  scanAgentSetup,
  staleInstructionPaths,
  staleTimestampPaths,
} from "@pharn-ci/core";
import { readAgentConfigSources } from "./agentConfigSources.js";
import { batchCheck, batchRead, type GitBatchDeps, OBJECT_ID } from "./gitBlobs.js";

/** The git calls the stale-instruction reader makes: blobs by `cat-file`, and `git log` for SI04's commit times. */
export interface StaleInstructionGitDeps extends GitBatchDeps {
  /** Absent: SI04's commit times are not read, so SI04 does not run. */
  git?(args: string[]): Promise<string>;
}

/** The largest root package.json or Makefile that is read; a larger one counts as unreadable. */
const MAX_MANIFEST_BYTES = 512 * 1024;
/** The root manifests SI01 compares commands with. */
const MANIFESTS = ["package.json", "Makefile"] as const;
/** A `git log --format=%ct` answer: seconds since the epoch. */
const SECONDS = /^\d{1,12}$/;

/**
 * The text of each `<rev>:<path>` blob, or null when it is absent, too large, not a blob or binary. One
 * `cat-file --batch-check` and one `cat-file --batch`; a git failure throws.
 */
async function readBlobs(
  deps: GitBatchDeps,
  requests: readonly { rev: string; path: string }[],
): Promise<(string | null)[]> {
  const checked = await batchCheck(
    deps,
    requests.map((request) => ({ oid: request.rev, path: request.path })),
  );
  const wanted = checked.flatMap((result) =>
    result !== null && result.object.type === "blob" && result.object.size <= MAX_MANIFEST_BYTES ? [result.oid] : [],
  );
  const contents = await batchRead(deps, [...new Set(wanted)].sort(byCodeUnit));
  return checked.map((result) => {
    if (result === null) return null;
    const bytes = contents.get(result.oid);
    return bytes === undefined ? null : decodeTestSourceText(bytes);
  });
}

/**
 * What the stale-instruction signals (SI01 to SI04) read, or undefined when the repository has no instruction file:
 * the instruction files at HEAD (the inventory's instruction kinds, at most 50, through `readAgentConfigSources` and its
 * caps), the root `package.json` and `Makefile` at HEAD and, when the change touches them and `base` is given, at the
 * merge base, and, with a `git` runner, the last commit time of the instruction files `staleTimestampPaths` names (at
 * most 20) and HEAD's. Every read is of committed objects, never the working tree. A failed manifest read leaves the
 * manifests out (no command is checked) and a failed `git log` leaves the times out (SI04 does not run); an unreadable
 * instruction set is returned as `{ unavailable }`, which core reads as nothing. Never throws.
 */
export async function readStaleInstructionSources(
  deps: StaleInstructionGitDeps,
  options: { repoFiles: readonly string[]; diff: readonly DiffFile[]; base?: string },
): Promise<StaleInstructionSources | undefined> {
  const agentSetup = scanAgentSetup(options.repoFiles);
  const paths = staleInstructionPaths(agentSetup);
  if (paths.length === 0) return undefined;
  const instructions = await readAgentConfigSources({ gitBatch: deps.gitBatch }, paths);
  if ("unavailable" in instructions) return { instructions };

  const sources: StaleInstructionSources = { instructions };
  const tracked = new Set(options.repoFiles);
  const touched = (path: string) => options.diff.some((file) => file.path === path || file.oldPath === path);
  try {
    // The base side is read at the merge base of `base` and HEAD, as the diff is, and only for a touched manifest.
    let mergeBase: string | null = null;
    const { base } = options;
    if (base !== undefined && !base.startsWith("-") && deps.git !== undefined && MANIFESTS.some(touched)) {
      const out = (await deps.git(["merge-base", base, "HEAD"])).trim();
      if (OBJECT_ID.test(out)) mergeBase = out;
    }
    const requests: { rev: string; path: string; side: "head" | "base"; manifest: (typeof MANIFESTS)[number] }[] = [];
    for (const manifest of MANIFESTS) {
      if (tracked.has(manifest)) requests.push({ rev: "HEAD", path: manifest, side: "head", manifest });
      if (mergeBase !== null && touched(manifest)) {
        requests.push({ rev: mergeBase, path: manifest, side: "base", manifest });
      }
    }
    const texts = await readBlobs(deps, requests);
    const sides: Record<(typeof MANIFESTS)[number], { head: string | null; base?: string | null }> = {
      "package.json": { head: null },
      Makefile: { head: null },
    };
    requests.forEach((request, i) => {
      sides[request.manifest][request.side] = texts[i] ?? null;
    });
    sources.packageJson = sides["package.json"];
    sources.makefile = sides.Makefile;
  } catch {
    // The manifests could not be read: no command is checked.
  }

  if (deps.git !== undefined) {
    const timed = staleTimestampPaths({ instructions, diff: options.diff, repoFiles: options.repoFiles, agentSetup })
      .filter((path) => !isUnsafeTestSourcePath(path))
      .slice(0, MAX_TIMESTAMP_FILES);
    if (timed.length > 0) {
      try {
        const head = (await deps.git(["log", "-1", "--format=%ct", "HEAD"])).trim();
        if (SECONDS.test(head)) {
          const files: { path: string; time: number }[] = [];
          for (const path of timed) {
            // `:(top,literal)` names the path from the repository root, with no glob characters.
            const out = (await deps.git(["log", "-1", "--format=%ct", "HEAD", "--", `:(top,literal)${path}`])).trim();
            if (SECONDS.test(out)) files.push({ path, time: Number(out) });
          }
          sources.commitTimes = { head: Number(head), files };
        }
      } catch {
        // git log failed: SI04 does not run.
      }
    }
  }
  return sources;
}
