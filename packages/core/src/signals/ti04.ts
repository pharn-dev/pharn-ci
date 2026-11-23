import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { byCodeUnit } from "../text.js";
import { capFindings } from "./findingCap.js";
import { parseJsTestCall, testLanguage } from "./testLines.js";

const DETAIL =
  "A focused-run marker (`.only`, `fit` or `fdescribe`) was added, so the runner may skip the other tests of this file or of the whole run.";

/**
 * TI04, a focused-run marker added to a JS/TS test file. An added line that starts with a test call carrying `.only`
 * (`it.only(`, `describe.only(`, `test.describe.only(`) or the bare `fit(` and `fdescribe(` is one signal, at its line in
 * the new file, with the mode as its severity. A removed line of the same file with the same marker and the same name
 * (an edit or a move) accounts for it. At most 20 signals per file (`capFindings`), on the lowest line numbers. Python and Go files and
 * files that are not tests give nothing. No test text reaches a signal: the detail is one fixed sentence.
 */
export function detectTI04(diff: readonly DiffFile[], mode: "block" | "warn"): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isTestFile(file.path)) continue;
    if (testLanguage(file.path) !== "jsts") continue;

    const removed = new Set<string>();
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        const parsed = parseJsTestCall(entry.text);
        if (parsed !== null && parsed.kind === "call" && parsed.token === "only") removed.add(parsed.name);
      }
    }

    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        const parsed = parseJsTestCall(entry.text);
        if (parsed === null || parsed.kind !== "call" || parsed.token !== "only") continue;
        if (!removed.has(parsed.name)) {
          signals.push({ id: "TI04", severity: mode, path: file.path, line: entry.line, detail: DETAIL });
        }
      }
    }
  }
  return capFindings(signals).kept.sort((a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0));
}
