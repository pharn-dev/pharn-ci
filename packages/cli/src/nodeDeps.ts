import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliDeps } from "./main.js";

/** A git call is killed after this long, so a hung git cannot hang the CLI. */
export const GIT_TIMEOUT_MS = 120_000;

/** Real I/O for the CLI. */
export function nodeDeps(cwd: string = process.cwd(), opts: { gitTimeoutMs?: number } = {}): CliDeps {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  return {
    cwd,
    git: (args) =>
      new Promise((ok, fail) => {
        execFile(
          "git",
          args,
          { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", timeout },
          (err, stdout, stderr) => {
            if (err?.killed) fail(new Error(`git ${args[0] ?? ""} timed out after ${timeout / 1000} s`));
            else if (err) fail(new Error(stderr || err.message));
            else ok(stdout);
          },
        );
      }),
    readFile: async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    resolvePath: (...segments) => resolve(...segments),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  };
}
