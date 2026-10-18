import { execFile, spawn } from "node:child_process";
import { open, readdir, readFile as readFileText } from "node:fs/promises";
import type { DirEntry } from "@pharn-ci/core";

/** A git call is killed after this long, so a hung git cannot hang the CLI or stall the job until its own timeout. */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * git's stdout as UTF-8 text chunks, with no buffer limit. Iteration throws git's stderr when git fails, and says
 * that git timed out when the timer killed it. Stdin stays an open pipe, as with `execFile`.
 */
export async function* streamGit(
  cwd: string,
  args: string[],
  timeoutMs: number = GIT_TIMEOUT_MS,
): AsyncGenerator<string> {
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
  }, timeoutMs);
  try {
    child.stdout.setEncoding("utf8");
    for await (const chunk of child.stdout) yield chunk as string;
    const { code, error } = await closed;
    if (timedOut) throw new Error(`git ${args[0] ?? ""} timed out after ${timeoutMs / 1000} s`);
    if (error) throw error;
    if (code !== 0) throw new Error(stderr || `Command failed: git ${args.join(" ")}`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/** git's whole stdout as one text. Rejects with git's stderr when git fails, and says when git timed out. */
export function runGit(cwd: string, args: string[], timeoutMs: number = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((ok, fail) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 256 * 1024 * 1024, encoding: "utf8", timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err?.killed) fail(new Error(`git ${args[0] ?? ""} timed out after ${timeoutMs / 1000} s`));
        else if (err) fail(new Error(stderr || err.message));
        else ok(stdout);
      },
    );
  });
}

/** File contents as UTF-8 text, or null when the file does not exist. */
export async function readFile(path: string): Promise<string | null> {
  try {
    return await readFileText(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** The file as UTF-8 text chunks, or null when it does not exist. */
export async function readFileStream(path: string): Promise<AsyncIterable<string> | null> {
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
}

/**
 * The entries of a directory, with symbolic links reported as such and never followed; null when the directory does
 * not exist or is not a directory.
 */
export async function listDir(path: string): Promise<DirEntry[] | null> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    // A symbolic link is reported as one (Node does not follow it here), whatever it points to.
    return entries.map(
      (entry): DirEntry => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      }),
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}
