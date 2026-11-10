import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { byCodeUnit } from "../text.js";
import { alwaysTrueHelperLines, alwaysTrueMatcherLines } from "./alwaysTrue.js";
import { testLanguage } from "./testLines.js";
import { wildcardReplacementLines } from "./wildcardExpected.js";

/**
 * TI17, an assertion that always passes added to a test file; always severity `warn`. In a JavaScript, TypeScript or
 * Python test file (not Go) with kept text, three forms are read on added lines only, from the diff alone (no test
 * source, no Python index):
 *
 * - a call to a custom matcher that the same diff adds to `expect` and whose every `pass` is the constant true
 *   (JavaScript and TypeScript);
 * - an `assert` or `self.assertTrue` that is exactly a call to a helper the same diff defines and whose every `return` is
 *   `True` (Python);
 * - a wildcard (`expect.anything()`, `ANY`) in place of the expected value of an equality line the same hunk removes.
 *
 * Each scan reads a kept line left to right once, at most 50 names per file are recorded and one definition is open at a
 * time, so the time is linear in the kept text. A file with at least one such line gives one signal at the lowest, whose
 * fixed detail holds the count and no name or diff text. It does not read a definition on unchanged lines or in another
 * file, a value computed indirectly, or the other always-true forms; those are named misses (docs/LIMITS.md).
 */
export function detectTI17(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isTestFile(file.path)) continue;
    const language = testLanguage(file.path);
    if (language !== "jsts" && language !== "python") continue;

    const lines = new Set<number>([
      ...(language === "jsts" ? alwaysTrueMatcherLines(file) : alwaysTrueHelperLines(file)),
      ...wildcardReplacementLines(file, language),
    ]);
    if (lines.size === 0) continue;
    let first = Number.POSITIVE_INFINITY;
    for (const line of lines) if (line < first) first = line;
    const count = lines.size === 1 ? "1 assertion that always passes" : `${lines.size} assertions that always pass`;
    signals.push({
      id: "TI17",
      severity: "warn",
      path: file.path,
      line: first,
      detail: `This test file adds ${count}: a custom matcher or helper that is always true, or a wildcard in place of an expected value, so it no longer checks a value.`,
    });
  }
  return signals.sort((a, b) => byCodeUnit(a.path, b.path));
}
