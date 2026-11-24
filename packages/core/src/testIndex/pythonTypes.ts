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
  /**
   * The module names of the file's import statements (anywhere in the module), each once, at most `MAX_TEST_IMPORTS`,
   * for the tests-exercise check: `import a.b` gives `a.b`, `from a.b import c` gives `a.b` and `a.b.c`, a relative
   * import keeps its dots (`.c`). Present only for a parsed file that imports something.
   */
  imports?: string[];
  /**
   * The file's top-level import bindings as `[local, target]` pairs (the local name and the dotted name it stands
   * for), in the order the interpreter read them, a later binding of a name replacing an earlier one. Only the
   * module's own `import` and `from ... import` statements count (not inside `if`, `try` or a function), and only a
   * binding into `pytest` or `unittest` whose local name differs from its target (`import pytest` and `from m import *`
   * add nothing). A file with more than `MAX_TEST_IMPORTS` such pairs, or one whose name or target is over 500
   * characters, is refused as `too-large` by the interpreter instead (never cut). TI03 resolves aliased skip spellings
   * with it. Present only for a parsed file with at least one such pair.
   */
  aliases?: [local: string, target: string][];
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
