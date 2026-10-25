import type { TestIndexResult } from "./types.js";

/** The interpreter run is killed after this many milliseconds. */
export const PYTHON_INDEX_TIMEOUT_MS = 30_000;
/** The most bytes of output one interpreter run may write (64 MiB). */
export const PYTHON_INDEX_MAX_STDOUT_BYTES = 67_108_864;
/** The longest array the interpreter's raw output may hold, at the top level or inside an entry. */
export const MAX_PYTHON_RAW_ARRAY = 524_288;
/** The longest `detail` of an unavailable run, in UTF-16 code units. */
export const MAX_PYTHON_DETAIL_CHARS = 300;

/** Why a Python run gave no index at all. */
export const PYTHON_INDEX_UNAVAILABLE_REASONS = [
  "python-not-found",
  "python-too-old",
  "python-failed",
  "timeout",
  "output-too-large",
  "bad-output",
] as const;
export type PythonIndexUnavailableReason = (typeof PYTHON_INDEX_UNAVAILABLE_REASONS)[number];

/** The path and text of one Python test file. */
export interface PythonSourceFile {
  path: string;
  text: string;
}

/** The index result of one Python test file. */
export interface PythonIndexFile {
  path: string;
  result: TestIndexResult;
}

/** A run that gave no index: the reason, and a one-line detail of at most 300 characters. */
export interface PythonIndexUnavailable {
  available: false;
  reason: PythonIndexUnavailableReason;
  detail: string;
}

/** The result of indexing the `.py` files of one input: one entry per `.py` file, in input order. */
export type PythonIndexRun = { available: true; files: PythonIndexFile[] } | PythonIndexUnavailable;

/** What one interpreter run gave, as node-io's spawn reports it. */
export interface PythonSpawnResult {
  /** The Node error code when the interpreter could not run or was stopped ("ENOENT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", …), else null. */
  errorCode: string | null;
  /** The 30 s timeout killed the interpreter. */
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
