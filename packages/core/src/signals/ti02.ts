import type { TestIntegritySignal } from "../report.js";
import type { TestMatch } from "./testMatch.js";
import { fullTestName, removedDynamicTestDetail, removedTestDetail } from "./testName.js";

/**
 * TI02, a test removed. Every candidate no matching rule cleared is one finding: the path is the base path and the line
 * the base line. Severity is the mode (`block` in block mode, `warn` in warn mode), or `warn` when the test's name is
 * computed. The detail is a fixed sentence around the full name, at most 300 characters. No file content reaches a
 * signal.
 */
export function detectTI02(match: Pick<TestMatch, "unmatched">, mode: "block" | "warn"): TestIntegritySignal[] {
  return match.unmatched.map(({ path, block }) => ({
    id: "TI02",
    severity: block.nameDynamic ? "warn" : mode,
    path,
    line: block.line,
    detail: block.nameDynamic
      ? removedDynamicTestDetail(fullTestName(block), block.line)
      : removedTestDetail(fullTestName(block), block.line),
  }));
}
