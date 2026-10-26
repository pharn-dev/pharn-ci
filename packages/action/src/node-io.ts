import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import {
  GIT_TIMEOUT_MS,
  listDir,
  lstatPath,
  readFile,
  readFileStream,
  runGit,
  runGitBatch,
  streamGit,
} from "@pharn-ci/node-io";
import type { ActionDeps } from "./run.js";

export { GIT_TIMEOUT_MS };

/** The runner's file, git and summary access, as run() takes it. `workspace` is the git working directory. */
export function createNodeIo(
  workspace: string,
  opts: { gitTimeoutMs?: number } = {},
): Pick<ActionDeps, "git" | "readFile" | "listDir" | "lstat" | "writeFile" | "resolvePath" | "writeSummary"> &
  Required<Pick<ActionDeps, "gitStream" | "gitBatch" | "readFileStream">> {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  return {
    gitBatch: (args, input) => runGitBatch(workspace, args, input, timeout),
    gitStream: (args) => streamGit(workspace, args, timeout),
    readFileStream,
    git: (args) => runGit(workspace, args, timeout),
    readFile,
    listDir,
    lstat: lstatPath,
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
