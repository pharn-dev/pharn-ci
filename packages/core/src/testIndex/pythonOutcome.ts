import { utf8ByteLength } from "./pythonPlan.js";
import { pythonIndexFromRaw } from "./pythonRaw.js";
import {
  MAX_PYTHON_DETAIL_CHARS,
  PYTHON_INDEX_MAX_STDOUT_BYTES,
  type PythonIndexUnavailable,
  type PythonSpawnResult,
} from "./pythonTypes.js";
import type { TestIndexResult } from "./types.js";

/** Control characters become spaces, runs of whitespace collapse, the ends are trimmed, and the text is cut to 300. */
export function oneLineDetail(text: string): string {
  let out = "";
  let lastSpace = true;
  for (let i = 0; i < text.length && out.length <= MAX_PYTHON_DETAIL_CHARS; i++) {
    const code = text.charCodeAt(i);
    const blank = code <= 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
    if (blank) {
      if (!lastSpace) out += " ";
      lastSpace = true;
    } else {
      out += text[i];
      lastSpace = false;
    }
  }
  const cut = out.length > MAX_PYTHON_DETAIL_CHARS ? out.slice(0, MAX_PYTHON_DETAIL_CHARS) : out;
  return cut.trim();
}

function unavailable(reason: PythonIndexUnavailable["reason"], detail: string): PythonIndexUnavailable {
  const line = oneLineDetail(detail);
  return { available: false, reason, detail: line === "" ? reason : line };
}

/** The last stderr line that is not blank, or "". */
function lastLine(stderr: string): string {
  const lines = stderr.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] as string).trim();
    if (line !== "") return line;
  }
  return "";
}

const TOO_OLD_LINE = /^pharn-ci-python-too-old (\S+)$/;

/**
 * Classifies what one interpreter run gave. The first match wins: output too large, timeout, an interpreter that
 * does not know `-I` (Python 2, or 3.0 to 3.3), the bootstrap's report that Python is older than 3.8, any other
 * error code, a non-zero exit, and finally the validation of the raw output (`pythonIndexFromRaw`).
 */
export function pythonRunOutcome(
  result: PythonSpawnResult,
  count: number,
  command: string,
): { available: true; results: TestIndexResult[] } | PythonIndexUnavailable {
  if (
    result.errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    result.stdout.length > PYTHON_INDEX_MAX_STDOUT_BYTES ||
    utf8ByteLength(result.stdout) > PYTHON_INDEX_MAX_STDOUT_BYTES
  ) {
    return unavailable("output-too-large", "the interpreter wrote more than 64 MiB");
  }
  if (result.timedOut) return unavailable("timeout", `${command} did not finish within 30 s and was killed`);
  if (result.stderr.includes("Unknown option: -I")) {
    return unavailable("python-too-old", `${command} does not know the -I option (Python 2, or 3.0 to 3.3)`);
  }
  if (result.exitCode === 3) {
    for (const line of result.stderr.split("\n")) {
      const match = TOO_OLD_LINE.exec(line.trim());
      if (match !== null) return unavailable("python-too-old", `Python ${match[1]} is older than 3.8`);
    }
  }
  if (result.errorCode !== null) return unavailable("python-failed", `${command} could not run: ${result.errorCode}`);
  if (result.exitCode !== 0) {
    return unavailable("python-failed", `${command} exited with code ${result.exitCode}: ${lastLine(result.stderr)}`);
  }
  const mapped = pythonIndexFromRaw(result.stdout, count);
  return mapped.available ? mapped : unavailable(mapped.reason, mapped.detail);
}
