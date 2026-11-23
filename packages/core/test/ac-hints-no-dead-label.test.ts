import { describe, expect, it } from "vitest";

import { withFixHints } from "../src/fix/attach.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { type Report, type TestIntegritySignal, testIntegritySignalMessages, verdictOf } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-73 (R2.10). The accept label is read only when a test-integrity finding blocks. TI06, TI12 and TI17 are always
// `warn` unless an org policy raises them, so their hints no longer offer the label in the comment or in `fix.hint`;
// the hints of the signals that block by default (TI02, TI03, TI05, TI09, TI10, TI13) still name it. A TI06, TI12 or
// TI17 finding that an org policy raised to `block` keeps the label clause, because there the label does count.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const QUIET = ["TI06", "TI12", "TI17"] as const;
const NAMING = ["TI02", "TI03", "TI05", "TI09", "TI10", "TI13"] as const;
const LABEL = /accept label|pharn\/accepted/i;

const finding = (id: string, severity: TestIntegritySignal["severity"], line: number): TestIntegritySignal =>
  ({
    id,
    severity,
    path: `src/${id.toLowerCase()}.test.ts`,
    line,
    detail: `A ${id} finding.`,
  }) as TestIntegritySignal;

/** The golden report with the given signals and their messages put in, fix hints attached, validated. */
function reportWith(signals: TestIntegritySignal[]): Report {
  const base = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  const others = base.messages.filter((m) => !/^TEST_INTEGRITY_TI\d\d$/.test(String(m.code)));
  const messages = [...others, ...testIntegritySignalMessages(signals)];
  const blocks = signals.some((s) => s.severity === "block");
  const report = withFixHints({
    ...base,
    verdict: verdictOf(messages),
    messages,
    testIntegrity: {
      ...base.testIntegrity,
      mode: "block",
      source: "input",
      verdict: blocks ? "fail" : "warn",
      signals,
    },
  } as Report);
  expectValidReport(report);
  return report;
}

/** The hint line under the finding of `id` in the Test integrity section. */
function hintOf(markdown: string, id: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  expect(start, "the Test integrity heading").toBeGreaterThan(-1);
  const at = lines.findIndex((line, i) => i > start && line.includes(`**${id}**`));
  expect(at, `${id} is listed`).toBeGreaterThan(-1);
  const hint = lines[at + 1] ?? "";
  expect(hint.startsWith("  - Hint: "), `${id} has a hint`).toBe(true);
  return hint;
}

describe("CORE-73: the hints offer the accept label only where it can count", () => {
  it("the TI06, TI12 and TI17 warn hints do not mention the accept label, in the comment or in fix.hint; the TI02, TI03, TI05, TI09, TI10 and TI13 hints still name it", () => {
    const report = reportWith([
      ...NAMING.map((id, i) => finding(id, "block", i + 1)),
      ...QUIET.map((id, i) => finding(id, "warn", i + 1)),
    ]);
    const markdown = renderMarkdown(report);

    for (const id of QUIET) {
      const hint = hintOf(markdown, id);
      expect(hint, `${id} comment hint`).not.toMatch(LABEL);
      expect(hint, `${id} comment hint`).not.toMatch(/sign-?off/i);
      expect(hint, `${id} comment hint ends a sentence`).toMatch(/\.$/);
      const signal = report.testIntegrity.signals.find((s) => s.id === id);
      expect(signal?.fix?.hint, `${id} fix.hint`).toBeDefined();
      expect(signal?.fix?.hint, `${id} fix.hint`).not.toMatch(LABEL);
      const message = report.messages.find((m) => m.code === `TEST_INTEGRITY_${id}`);
      expect(message?.fix?.hint, `TEST_INTEGRITY_${id} fix.hint`).toBeDefined();
      expect(message?.fix?.hint, `TEST_INTEGRITY_${id} fix.hint`).not.toMatch(LABEL);
    }
    for (const id of NAMING) {
      const hint = hintOf(markdown, id);
      expect(hint, `${id} comment hint`).toMatch(/accept label/i);
      expect(hint, `${id} comment hint`).toContain("`pharn/accepted`");
    }
  });

  it("a TI06, TI12 or TI17 finding an org policy raised to block keeps the accept label clause", () => {
    const report = reportWith(QUIET.map((id, i) => finding(id, "block", i + 1)));
    const markdown = renderMarkdown(report);
    for (const id of QUIET) {
      const hint = hintOf(markdown, id);
      expect(hint, `${id} block hint`).toMatch(
        /; a reviewer who is not the PR author can record that sign-off by applying the accept label `pharn\/accepted`\.$/,
      );
    }
  });
});
