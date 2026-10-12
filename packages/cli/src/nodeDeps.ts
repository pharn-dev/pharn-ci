import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliDeps } from "./main.js";

/** Real I/O for the CLI. */
export function nodeDeps(cwd: string = process.cwd()): CliDeps {
  return {
    cwd,
    git: (args) =>
      new Promise((ok, fail) => {
        execFile("git", args, { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }, (err, stdout, stderr) => {
          if (err) fail(new Error(stderr || err.message));
          else ok(stdout);
        });
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
