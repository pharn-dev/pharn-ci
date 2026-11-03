import { MAX_TEST_SOURCE_FILE_BYTES, MAX_TEST_SOURCE_FILES, MAX_TEST_SOURCE_TOTAL_BYTES } from "../testSources.js";
import { utf8ByteLength } from "../text.js";
import type { PythonSourceFile } from "./pythonTypes.js";

/** What is sent to the interpreter, and what each `.py` input file became. */
export interface PythonIndexPlan {
  /** One entry per `.py` input file, in input order. */
  entries: ({ path: string; id: number } | { path: string; refused: "too-large" })[];
  /** What is sent: ids 0..n-1 in order. */
  send: { id: number; text: string }[];
}

/**
 * Chooses the files to send: those whose path ends in `.py`, in input order. A file over 512 KiB, a file once 200 are
 * planned, and a file that would take the running total past 16 MiB (and every later file) is refused as `too-large`
 * and not sent, the way `planTestSourceReads` drops files.
 */
export function planPythonIndex(files: readonly PythonSourceFile[]): PythonIndexPlan {
  const entries: PythonIndexPlan["entries"] = [];
  const send: PythonIndexPlan["send"] = [];
  let total = 0;
  let tripped = false;
  for (const file of files) {
    if (!file.path.endsWith(".py")) continue;
    const size = utf8ByteLength(file.text);
    if (size > MAX_TEST_SOURCE_FILE_BYTES || send.length >= MAX_TEST_SOURCE_FILES) {
      entries.push({ path: file.path, refused: "too-large" });
    } else if (tripped || total + size > MAX_TEST_SOURCE_TOTAL_BYTES) {
      tripped = true;
      entries.push({ path: file.path, refused: "too-large" });
    } else {
      total += size;
      entries.push({ path: file.path, id: send.length });
      send.push({ id: send.length, text: file.text });
    }
  }
  return { entries, send };
}

/** The interpreter's stdin: a JSON array of `{"id": n, "text": …}`, in id order. It carries no path. */
export function pythonIndexStdin(send: readonly { id: number; text: string }[]): string {
  return JSON.stringify(send.map((entry) => ({ id: entry.id, text: entry.text })));
}
