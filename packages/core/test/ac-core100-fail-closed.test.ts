import { describe, expect, it } from "vitest";
import { type DiffFile, parseUnifiedDiff, type Report } from "../src/index.js";
import { fixture } from "./helpers.js";
import { addedFileDiff } from "./injection-fixture.js";
import { expectValidReport } from "./schema.js";
import { check, type TextCheckInput } from "./text-coverage.js";

// CORE-100 part 1 (R3.2, decision Q2: a cut the pull request can cause is an error where the check can block).
// The diff reader keeps added text against two budgets of 8,000,000 code units: one for agent instruction and Markdown
// files, one for every other file, so a large file cannot use up the budget that guards AGENTS.md. A cut in an
// instruction or Markdown file is INJECTION_TEXT_TRUNCATED at level error; a cut only in other files stays a warning.
// DIFF_BINARY_COVERED_FILE is an error when a diff-coverage threshold is in force. Large inputs are generated here,
// never committed; no timing is asserted (the hang ceiling is raised for coverage-instrumented CI runners).

const REPO_ROOT = "/home/runner/work/demo/demo";
const BUDGET = 8_000_000;
const RLO = String.fromCharCode(0x202e);

function run(diff: TextCheckInput["diff"], over: Partial<TextCheckInput> = {}): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff,
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    ...over,
  });
  expectValidReport(report);
  return report;
}

/**
 * `total` code units of `ch`, as lines of at most 100,000 code units. The default is a dot: no base64 or hex run
 * (PI04), no phrase and no invisible character, so the only injection message is the truncation.
 */
function bulk(total: number, ch = "."): string[] {
  const lines: string[] = [];
  for (let left = total; left > 0; left -= 100_000) lines.push(ch.repeat(Math.min(left, 100_000)));
  return lines;
}

const truncated = (report: Report) => report.messages.find((m) => m.code === "INJECTION_TEXT_TRUNCATED");

describe("CORE-100: injection budgets and binary covered files fail closed", { timeout: 300_000 }, () => {
  it("AC-1: an 8.1 MB generated file first in the diff does not hide a bidi character in a later AGENTS.md", () => {
    const diff =
      addedFileDiff("dist/bundle.js", bulk(8_100_000)) + addedFileDiff("AGENTS.md", [`Run the tests.${RLO}`]);
    const report = run({ text: diff });
    // Control: the bundle itself is cut (it is past the budget for other files), and only it.
    const message = truncated(report);
    expect(message?.level).toBe("warn");
    expect(message?.text).toContain("`dist/bundle.js`");
    expect(message?.text).not.toContain("AGENTS.md");
    expect(report.injection?.signals.map((s) => [s.id, s.path, s.line])).toEqual([["PI01", "AGENTS.md", 1]]);
    expect(report.verdict).toBe("fail");
  });

  it("AC-2: instruction and Markdown text alone over their budget is INJECTION_TEXT_TRUNCATED at level error, verdict fail", () => {
    // Control: the same files under the budget pass with no truncation message.
    const small = run({ text: addedFileDiff("AGENTS.md", ["a"]) + addedFileDiff("docs/guide.md", ["b"]) });
    expect(truncated(small)).toBeUndefined();
    expect(small.verdict).not.toBe("fail");

    const diff = addedFileDiff("AGENTS.md", bulk(5_000_000)) + addedFileDiff("docs/guide.md", bulk(3_100_000));
    const report = run({ text: diff });
    const message = truncated(report);
    expect(message?.level).toBe("error");
    expect(message?.text).toContain("`docs/guide.md`");
    expect(message?.text).not.toContain("`AGENTS.md`");
    expect(message?.text).toContain("The cut files count against the budget for instruction and Markdown files.");
    expect(report.verdict).toBe("fail");
  });

  it("AC-3: a 9 MB bundle with no instruction or Markdown file cut stays a warning", () => {
    const diff = addedFileDiff("AGENTS.md", ["Run the tests."]) + addedFileDiff("dist/app.js", bulk(9_000_000));
    const report = run({ text: diff });
    const message = truncated(report);
    expect(message?.level).toBe("warn");
    expect(message?.text).toContain("`dist/app.js`");
    // Control: the text says which budget was hit.
    expect(message?.text).toContain("The cut files count against the budget for other files.");
    expect(report.verdict).toBe("warn");
  });

  it("AC-4: DIFF_BINARY_COVERED_FILE is an error under a threshold and a warning without one", () => {
    const input = (
      threshold: number | null,
    ): Pick<TextCheckInput, "coverage" | "diff" | "threshold" | "repoFiles"> => ({
      coverage: { text: fixture("gate-tamper/coverage.info"), format: "lcov" },
      diff: { text: fixture("gate-tamper/binary.diff") },
      threshold,
      repoFiles: fixture("gate-tamper/files.txt").trim().split("\n"),
    });
    const level = (report: Report) => report.messages.filter((m) => m.code === "DIFF_BINARY_COVERED_FILE");
    const without = level(run(input(null).diff, input(null)));
    expect(without.map((m) => m.level)).toEqual(["warn"]);
    const gated = run(input(80).diff, input(80));
    expect(level(gated).map((m) => m.level)).toEqual(["error"]);
    expect(level(gated)[0]?.text).toContain("`src/x.ts`");
    expect(gated.verdict).toBe("fail");
    // A threshold of 0 is still a threshold the user set: the gate cannot measure the binary file either way.
    expect(level(run(input(0).diff, input(0))).map((m) => m.level)).toEqual(["error"]);
  });

  it("AC-5: INJECTION_TEXT_TRUNCATED's level follows the cause: priority cut, other cut, both, none", () => {
    const file = (path: string, cut: boolean): DiffFile => ({
      path,
      oldPath: path,
      status: "added",
      addedLines: [1],
      addedText: [{ line: 1, text: "plain text" }],
      ...(cut ? { addedTextCut: true as const } : {}),
    });
    const table: { cause: string; files: DiffFile[]; level: string | undefined }[] = [
      { cause: "priority cut", files: [file("AGENTS.md", true), file("src/a.js", false)], level: "error" },
      { cause: "Markdown cut, upper case", files: [file("docs/NOTES.MD", true)], level: "error" },
      { cause: ".mdx cut", files: [file("site/page.mdx", true)], level: "error" },
      { cause: ".markdown cut", files: [file("notes.markdown", true)], level: "error" },
      { cause: ".mdc cut", files: [file("rules/a.mdc", true)], level: "error" },
      { cause: "instruction file of no Markdown extension cut", files: [file(".cursorrules", true)], level: "error" },
      { cause: "other cut", files: [file("AGENTS.md", false), file("dist/a.js", true)], level: "warn" },
      { cause: "both", files: [file("dist/a.js", true), file("CLAUDE.md", true)], level: "error" },
      { cause: "none", files: [file("AGENTS.md", false), file("dist/a.js", false)], level: undefined },
    ];
    const levels = table.map(({ cause, files }) => [cause, truncated(run({ parsed: files }))?.level]);
    expect(levels).toEqual(table.map(({ cause, level }) => [cause, level]));
    expect(truncated(run({ parsed: table[7]?.files ?? [] }))?.text).toContain(
      "not seen in `CLAUDE.md`, `dist/a.js`. The cut files count against both budgets.",
    );
    // Control: a priority cut fails the verdict, an other cut only warns.
    expect(run({ parsed: table[0]?.files ?? [] }).verdict).toBe("fail");
    expect(run({ parsed: table[6]?.files ?? [] }).verdict).toBe("warn");
  });

  it("AC-6: the reader cuts each budget at its own size, so both together keep at most 16,000,000 code units", () => {
    const diff =
      addedFileDiff("dist/big.js", ["o".repeat(BUDGET - 5), "o".repeat(20)]) +
      addedFileDiff("docs/big.md", ["p".repeat(BUDGET - 5), "p".repeat(20)]) +
      addedFileDiff("dist/late.js", ["late"]) +
      addedFileDiff("AGENTS.md", ["late"]);
    const files = parseUnifiedDiff(diff, {
      keepAddedText: () => true,
      priorityAddedText: (f) => f.path.endsWith(".md"),
    });
    const kept = (path: string) =>
      (files.find((f) => f.path === path)?.addedText ?? []).reduce((sum, l) => sum + l.text.length, 0);
    expect(kept("dist/big.js")).toBe(BUDGET);
    expect(kept("docs/big.md")).toBe(BUDGET);
    expect(files.filter((f) => f.addedTextCut === true).map((f) => f.path)).toEqual([
      "dist/big.js",
      "docs/big.md",
      "dist/late.js",
      "AGENTS.md",
    ]);
    // Control: without the priority option every file counts against one budget, as a caller that never asks gets.
    const single = parseUnifiedDiff(addedFileDiff("dist/big.js", ["o".repeat(BUDGET)]) + addedFileDiff("a.md", ["x"]), {
      keepAddedText: () => true,
    });
    expect(single.map((f) => f.addedTextCut === true)).toEqual([false, true]);
  });
});
