import { execFile, spawn } from "node:child_process";
import { open, readdir, readFile as readFileText } from "node:fs/promises";
import type { DirEntry } from "@pharn-ci/core";

/** A git call is killed after this long, so a hung git cannot hang the CLI or stall the job until its own timeout. */
export const GIT_TIMEOUT_MS = 120_000;

/**
 * The only git subcommands the shared runners run. All are local and read-only: none contacts a remote, so none
 * takes `--upload-pack` or `--receive-pack`. pharn-ci runs `cat-file` (without `--textconv` or `--filters`, which can
 * run a configured program), `diff`, `ls-files`, `ls-tree`, `merge-base` and `rev-parse`; `log` and `hash-object`
 * (without `-w`, it writes nothing) are what the tests of these runners use.
 */
export const LOCAL_GIT_SUBCOMMANDS = [
  "cat-file",
  "diff",
  "hash-object",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "rev-parse",
] as const;

/** Options that make git run another program or write a file. Refused before `--end-of-options` or `--`. */
const REFUSED_OPTION_PREFIXES = ["--upload-pack", "--receive-pack", "--exec", "--output", "--ext-diff"];

/**
 * A new argument list for a git call the shared runners allow, or an Error saying why the call is refused. The
 * subcommand in the result is the allowlist's own constant, never the caller's string. Options are checked up to
 * the first `--end-of-options` or `--`; what follows is a revision or a path, not an option.
 */
export function localGitArgs(args: readonly string[]): string[] {
  const subcommand = LOCAL_GIT_SUBCOMMANDS.find((name) => name === args[0]);
  if (subcommand === undefined) {
    throw new Error(
      `git ${args[0] ?? ""} is not allowed: pharn-ci runs only these git subcommands: ${LOCAL_GIT_SUBCOMMANDS.join(", ")}`,
    );
  }
  const safe: string[] = [subcommand];
  let options = true;
  for (const arg of args.slice(1)) {
    if (options && (arg === "--end-of-options" || arg === "--")) {
      options = false;
    } else if (
      options &&
      (REFUSED_OPTION_PREFIXES.some((prefix) => arg.startsWith(prefix)) ||
        (subcommand === "hash-object" && arg === "-w") ||
        (subcommand === "cat-file" && (arg.startsWith("--textconv") || arg.startsWith("--filters"))))
    ) {
      throw new Error(`git ${subcommand}: the option "${arg}" is not allowed`);
    }
    safe.push(`${arg}`);
  }
  return safe;
}

/**
 * git's stdout as UTF-8 text chunks, with no buffer limit. Iteration throws git's stderr when git fails, and says
 * that git timed out when the timer killed it. Stdin stays an open pipe, as with `execFile`. Only a call
 * `localGitArgs` allows is run; any other throws on the first iteration, before git starts.
 */
export async function* streamGit(
  cwd: string,
  gitArgs: string[],
  timeoutMs: number = GIT_TIMEOUT_MS,
): AsyncGenerator<string> {
  const args = localGitArgs(gitArgs);
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

/**
 * git's whole stdout as one text. Rejects with git's stderr when git fails, and says when git timed out. Only a call
 * `localGitArgs` allows is run; any other rejects before git starts.
 */
export function runGit(cwd: string, gitArgs: string[], timeoutMs: number = GIT_TIMEOUT_MS): Promise<string> {
  let args: string[];
  try {
    args = localGitArgs(gitArgs);
  } catch (err) {
    return Promise.reject(err);
  }
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

/** The most git's stdout may hold in `runGitBatch`: two sides of 16 MiB of text, their headers, and room to spare. */
const GIT_BATCH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Runs git with `input` written to its stdin and resolves its whole stdout as bytes (for `cat-file --batch`, whose
 * output is not text). Rejects with git's stderr when git fails, and says when git timed out. Only a call
 * `localGitArgs` allows is run; any other rejects before git starts. `GIT_NO_LAZY_FETCH=1` keeps a partial clone from
 * fetching a missing object from its remote: the call stays local.
 */
export function runGitBatch(
  cwd: string,
  gitArgs: string[],
  input: string,
  timeoutMs: number = GIT_TIMEOUT_MS,
): Promise<Buffer> {
  let args: string[];
  try {
    args = localGitArgs(gitArgs);
  } catch (err) {
    return Promise.reject(err);
  }
  return new Promise((ok, fail) => {
    const child = execFile(
      "git",
      args,
      {
        cwd,
        maxBuffer: GIT_BATCH_MAX_BUFFER,
        encoding: "buffer",
        timeout: timeoutMs,
        env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
      },
      (err, stdout, stderr) => {
        if (err?.killed) fail(new Error(`git ${args[0] ?? ""} timed out after ${timeoutMs / 1000} s`));
        else if (err) fail(new Error(stderr.toString("utf8") || err.message));
        else ok(stdout);
      },
    );
    // A broken pipe on stdin (git exited early) is reported through the exit code, not as an uncaught error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
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
