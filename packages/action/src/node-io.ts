import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import { GIT_TIMEOUT_MS, listDir, readFile, readFileStream, runGit, streamGit } from "@pharn-ci/node-io";
import type { ActionDeps } from "./run.js";

export { GIT_TIMEOUT_MS };

/** The runner's file, git and summary access, as run() takes it. `workspace` is the git working directory. */
export function createNodeIo(
  workspace: string,
  opts: { gitTimeoutMs?: number } = {},
): Pick<ActionDeps, "git" | "readFile" | "listDir" | "writeFile" | "resolvePath" | "writeSummary"> &
  Required<Pick<ActionDeps, "gitStream" | "readFileStream">> {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  return {
    gitStream: (args) => streamGit(workspace, args, timeout),
    readFileStream,
    git: (args) => runGit(workspace, args, timeout),
    readFile,
    listDir,
    writeFile: async (path, text) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
    resolvePath: (...segments) => resolve(...segments),
    writeSummary: async (markdown) => {
      await core.summary.addRaw(markdown).write();
    },
  };
}
