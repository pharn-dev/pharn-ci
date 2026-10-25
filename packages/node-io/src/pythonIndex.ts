import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import {
  oneLineDetail,
  PYTHON_INDEX_MAX_STDOUT_BYTES,
  PYTHON_INDEX_TIMEOUT_MS,
  type PythonIndexFile,
  type PythonIndexRun,
  type PythonSourceFile,
  type PythonSpawnResult,
  planPythonIndex,
  pythonIndexStdin,
  pythonRunOutcome,
  type TestIndexResult,
} from "@pharn-ci/core";
import { PYTHON_BOOTSTRAP, PYTHON_INDEX_SCRIPT } from "./pythonIndexScript.js";

/** The options every interpreter run gets. */
export interface PythonSpawnOptions {
  /** The temporary directory, so no file of the repository is on the interpreter's path. */
  cwd: string;
  /** `PATH` when the parent has it, plus `SYSTEMROOT` when set; nothing else. */
  env: Record<string, string>;
  shell: false;
  timeout: number;
  killSignal: "SIGKILL";
  maxBuffer: number;
}

/** Runs one interpreter with `stdin` on its standard input. Never rejects. */
export type PythonSpawn = (
  command: string,
  args: readonly string[],
  options: PythonSpawnOptions,
  stdin: string,
) => Promise<PythonSpawnResult>;

export interface PythonIndexDeps {
  /** The interpreter names to try in order. Default `["python3", "python"]`. */
  interpreters?: readonly string[];
  /** Default `spawnPython`. */
  spawn?: PythonSpawn;
}

const DEFAULT_INTERPRETERS: readonly string[] = ["python3", "python"];

function decodeStrict(data: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return "";
  }
}

/** What `execFile` puts on its error: `code` is a string for a system or Node error and a number for an exit code. */
interface ExecFailure {
  code?: unknown;
  killed?: unknown;
  signal?: unknown;
}

/**
 * The real spawn: `execFile` with no shell, the timeout, the output cap and stdin written from a string. It never
 * rejects: a process that cannot run, is killed or exits non-zero comes back as data.
 */
export const spawnPython: PythonSpawn = (command, args, options, stdin) =>
  new Promise<PythonSpawnResult>((resolve) => {
    try {
      const child = execFile(
        command,
        [...args],
        { ...options, encoding: "buffer" },
        (error, stdout: Buffer, stderr: Buffer) => {
          const out = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ""));
          const err = Buffer.isBuffer(stderr) ? stderr : Buffer.from(String(stderr ?? ""));
          if (error === null) {
            resolve({
              errorCode: null,
              timedOut: false,
              exitCode: 0,
              stdout: decodeStrict(out),
              stderr: err.toString("utf8"),
            });
            return;
          }
          const failure: ExecFailure = error;
          const errorCode = typeof failure.code === "string" ? failure.code : null;
          resolve({
            errorCode,
            timedOut:
              failure.killed === true &&
              failure.signal === "SIGKILL" &&
              errorCode !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            exitCode: typeof failure.code === "number" ? failure.code : null,
            stdout: decodeStrict(out),
            stderr: err.toString("utf8"),
          });
        },
      );
      child.stdin?.on("error", () => {});
      child.stdin?.end(stdin, "utf8");
    } catch (error) {
      const code = (error as ExecFailure).code;
      resolve({
        errorCode: typeof code === "string" ? code : "ERR_SPAWN_FAILED",
        timedOut: false,
        exitCode: null,
        stdout: "",
        stderr: "",
      });
    }
  });

function spawnOptions(): PythonSpawnOptions {
  const env: Record<string, string> = {};
  const path = process.env.PATH;
  if (path !== undefined) env.PATH = path;
  const systemRoot = process.env.SYSTEMROOT;
  if (systemRoot !== undefined) env.SYSTEMROOT = systemRoot;
  return {
    cwd: tmpdir(),
    env,
    shell: false,
    timeout: PYTHON_INDEX_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: PYTHON_INDEX_MAX_STDOUT_BYTES,
  };
}

/**
 * Indexes the `.py` files of `files` (every other path is left out) with the interpreter's own parser, in one run.
 * Which files are sent and the caps are decided in core (`planPythonIndex`); the interpreter gets an id and the text
 * of each file, never a path. A missing interpreter, a version older than 3.8, a failed or killed run and unreadable
 * output all give `{ available: false, reason, detail }`. Never throws.
 */
export async function indexPythonTests(
  files: readonly PythonSourceFile[],
  deps: PythonIndexDeps = {},
): Promise<PythonIndexRun> {
  const plan = planPythonIndex(files);
  if (plan.send.length === 0) {
    return {
      available: true,
      files: plan.entries.map(
        (entry): PythonIndexFile => ({ path: entry.path, result: { parsed: false, reason: "too-large" } }),
      ),
    };
  }
  const interpreters = deps.interpreters ?? DEFAULT_INTERPRETERS;
  const spawn = deps.spawn ?? spawnPython;
  const stdin = pythonIndexStdin(plan.send);
  const args = ["-I", "-S", "-B", "-c", PYTHON_BOOTSTRAP, PYTHON_INDEX_SCRIPT];
  const options = spawnOptions();

  let outcome: ReturnType<typeof pythonRunOutcome> | null = null;
  for (const command of interpreters) {
    let result: PythonSpawnResult;
    try {
      result = await spawn(command, args, options, stdin);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        available: false,
        reason: "python-failed",
        detail: oneLineDetail(`${command} could not run: ${message}`) || "python-failed",
      };
    }
    if (result.errorCode === "ENOENT") continue;
    outcome = pythonRunOutcome(result, plan.send.length, command);
    break;
  }
  if (outcome === null) {
    return {
      available: false,
      reason: "python-not-found",
      detail: oneLineDetail(`no Python interpreter found: tried ${interpreters.join(", ")}`) || "python-not-found",
    };
  }
  if (!outcome.available) return outcome;
  const results: readonly TestIndexResult[] = outcome.results;
  return {
    available: true,
    files: plan.entries.map((entry): PythonIndexFile => {
      const result: TestIndexResult =
        "refused" in entry ? { parsed: false, reason: entry.refused } : (results[entry.id] as TestIndexResult);
      return { path: entry.path, result };
    }),
  };
}
