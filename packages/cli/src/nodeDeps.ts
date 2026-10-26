import { resolve } from "node:path";
import {
  GIT_TIMEOUT_MS,
  listDir,
  lstatPath,
  oneChunk,
  readFile,
  readFileStream,
  runGit,
  runGitBatch,
  streamGit,
} from "@pharn-ci/node-io";
import type { CliDeps } from "./main.js";

export { GIT_TIMEOUT_MS };

/** Real I/O for the CLI. */
export function nodeDeps(
  cwd: string = process.cwd(),
  opts: { gitTimeoutMs?: number } = {},
): CliDeps & Required<Pick<CliDeps, "gitStream" | "gitBatch" | "readFileStream">> {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  const realGit: CliDeps["git"] = (args) => runGit(cwd, args, timeout);
  const realReadFile: CliDeps["readFile"] = (path) => readFile(path);
  const deps: CliDeps & Required<Pick<CliDeps, "gitStream" | "gitBatch" | "readFileStream">> = {
    cwd,
    gitBatch: (args, input) => runGitBatch(cwd, args, input, timeout),
    // A caller that replaced `git` or `readFile` on these deps (a test double, a wrapper) keeps getting its own
    // function called: the stream then is that function's one text, not a real child process or file stream.
    gitStream: (args) => (deps.git === realGit ? streamGit(cwd, args, timeout) : oneChunk(() => deps.git(args))),
    readFileStream: async (path) => {
      if (deps.readFile !== realReadFile) {
        const text = await deps.readFile(path);
        return text === null ? null : oneChunk(async () => text);
      }
      return readFileStream(path);
    },
    git: realGit,
    readFile: realReadFile,
    listDir,
    lstat: lstatPath,
    resolvePath: (...segments) => resolve(...segments),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
  return deps;
}
