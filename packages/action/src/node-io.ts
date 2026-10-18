import { execFile, spawn } from "node:child_process";
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import type { ActionDeps } from "./run.js";

/** A git call is killed after this long, so a hung git cannot stall the job until its own timeout. */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * git's stdout as UTF-8 text chunks, with no buffer limit. Iteration throws git's stderr when git fails, and says
 * that git timed out when the timer killed it. Stdin stays an open pipe, as with `execFile`.
 */
async function* streamGit(cwd: string, args: string[], timeout: number): AsyncGenerator<string> {
  const child = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let timedOut = false;
  // Nothing is written to stdin; a broken pipe on it must not become an uncaught error.
  child.stdin.on("error", () => {});
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  // Attached up front, so a failure that happens while the consumer is busy is never an unhandled rejection.
  const closed = new Promise<{ code: number | null; error?: Error }>((done) => {
    child.on("error", (error) => done({ code: null, error }));
    child.on("close", (code) => done({ code }));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeout);
  try {
    child.stdout.setEncoding("utf8");
    for await (const chunk of child.stdout) yield chunk as string;
    const { code, error } = await closed;
    if (timedOut) throw new Error(`git ${args[0] ?? ""} timed out after ${timeout / 1000} s`);
    if (error) throw error;
    if (code !== 0) throw new Error(stderr || `Command failed: git ${args.join(" ")}`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/** The runner's file, git and summary access, as run() takes it. `workspace` is the git working directory. */
export function createNodeIo(
  workspace: string,
  opts: { gitTimeoutMs?: number } = {},
): Pick<ActionDeps, "git" | "readFile" | "listDir" | "writeFile" | "resolvePath" | "writeSummary"> &
  Required<Pick<ActionDeps, "gitStream" | "readFileStream">> {
  const timeout = opts.gitTimeoutMs ?? GIT_TIMEOUT_MS;
  return {
    gitStream: (args) => streamGit(workspace, args, timeout),
    readFileStream: async (path) => {
      let handle: Awaited<ReturnType<typeof open>>;
      try {
        handle = await open(path, "r");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      // The stream decodes a multi-byte character cut by a read boundary whole, keeps a BOM, and closes the handle
      // when it ends or is destroyed.
      return handle.createReadStream({ encoding: "utf8" });
    },
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
