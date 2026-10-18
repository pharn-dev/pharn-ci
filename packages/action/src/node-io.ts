import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import type { ActionDeps } from "./run.js";

/** A git call is killed after this long, so a hung git cannot stall the job until its own timeout. */
export const GIT_TIMEOUT_MS = 120_000;

/** The runner's file, git and summary access, as run() takes it. `workspace` is the git working directory. */
export function createNodeIo(
  workspace: string,
  opts: { gitTimeoutMs?: number } = {},
): Pick<ActionDeps, "git" | "readFile" | "listDir" | "writeFile" | "resolvePath" | "writeSummary"> {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  return {
    git: (args) =>
      new Promise((ok, fail) => {
        execFile(
          "git",
          args,
          { cwd: workspace, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", timeout },
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
    listDir: async (path) => {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        // A symbolic link is reported as one (Node does not follow it here), whatever it points to.
        return entries.map((entry) => ({
          name: entry.name,
          kind: entry.isSymbolicLink()
            ? ("symlink" as const)
            : entry.isDirectory()
              ? ("directory" as const)
              : entry.isFile()
                ? ("file" as const)
                : ("other" as const),
        }));
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw err;
      }
    },
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
