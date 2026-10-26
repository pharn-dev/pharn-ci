import {
  type AgentConfigSources,
  decodeTestSourceText,
  isUnsafeTestSourcePath,
  planTestSourceReads,
  type TestSourceDrop,
  type TestSourceFile,
  type TestSourceObject,
} from "@pharn-ci/core";
import { batchCheck, batchRead, firstLine, type GitBatchDeps, StepFailed } from "./gitBlobs.js";

/** The one git call the reader makes: bytes out for a call that is given stdin. */
export type AgentConfigGitDeps = GitBatchDeps;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The text of the agent config files `paths` names, as committed at `HEAD`: one `cat-file --batch-check` for the
 * `HEAD:<path>` lines of the safe paths and one `cat-file --batch` for the blobs the read plan keeps (the test-source
 * caps: 200 files, 512 KiB each, 16 MiB in all). It never reads the working tree and never follows a symlink: a tracked
 * symlink is a blob that holds its link text. `files` and `dropped` are each sorted by path. A git failure makes the
 * result `{ unavailable }` with a reason that names the step; this never throws.
 */
export async function readAgentConfigSources(
  deps: AgentConfigGitDeps,
  paths: readonly string[],
): Promise<AgentConfigSources> {
  try {
    const unique = [...new Set(paths)].sort(byCodeUnit);
    // A path with a control character or a path-resolution segment never reaches git's stdin.
    const requests = unique.filter((path) => !isUnsafeTestSourcePath(path)).map((path) => ({ oid: "HEAD", path }));
    const checked = await batchCheck(deps, requests);

    const objects = new Map<string, TestSourceObject | null>();
    const blobs = new Map<string, string>();
    requests.forEach((request, i) => {
      const result = checked[i] ?? null;
      objects.set(request.path, result === null ? null : result.object);
      if (result !== null) blobs.set(request.path, result.oid);
    });

    const plan = planTestSourceReads(unique, objects);
    const wanted = new Set<string>();
    for (const path of plan.read) wanted.add(blobs.get(path) as string);
    const contents = await batchRead(deps, [...wanted].sort(byCodeUnit));

    const files: TestSourceFile[] = [];
    const dropped: TestSourceDrop[] = [...plan.dropped];
    for (const path of plan.read) {
      const text = decodeTestSourceText(contents.get(blobs.get(path) as string) as Uint8Array);
      if (text === null) dropped.push({ path, reason: "binary" });
      else files.push({ path, text });
    }
    dropped.sort((a, b) => byCodeUnit(a.path, b.path));
    return { files, dropped };
  } catch (err) {
    return { unavailable: err instanceof StepFailed ? err.message : `git could not be read: ${firstLine(err)}` };
  }
}
