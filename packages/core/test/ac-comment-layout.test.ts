import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { type Report, type TestIntegritySignal, testIntegritySignalMessages, verdictOf } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The comment layout of product/REPORT-V2.md: the headline counts test-integrity findings, the summary table has a
// Test integrity column, the section lists blocks first and collapses after 10, and the Messages section does not repeat
// a signal message the section already lists.

const base = check({
  version: "0.2.0",
  coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
  diff: { text: fixture("golden/pr.diff") },
  repoRoot: "/home/runner/work/demo/demo",
  threshold: 80,
  repoFiles: fixture("golden/files.txt").trim().split("\n"),
} as Parameters<typeof check>[0]);

const signal = (id: string, severity: TestIntegritySignal["severity"], path: string, line: number) =>
  ({ id, severity, path, line, detail: `${id} ${severity} finding.` }) as TestIntegritySignal;

/** The golden report with these signals, their messages and the verdict they give, in mode `mode`. */
function withSignals(signals: TestIntegritySignal[], mode: "block" | "warn" | "off" = "block"): Report {
  const others = base.messages.filter((m) => !/^TEST_INTEGRITY_TI\d\d$/.test(m.code));
  const messages = [...others, ...testIntegritySignalMessages(signals)];
  const verdict = signals.some((s) => s.severity === "block") ? "fail" : signals.length > 0 ? "warn" : "pass";
  const report = {
    ...base,
    verdict: verdictOf(messages),
    messages,
    testIntegrity: { ...base.testIntegrity, mode, source: "input" as const, verdict, signals },
  } as Report;
  expectValidReport(report);
  return report;
}

/** The lines of the Test integrity section, heading excluded. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.indexOf("### 🔍 Test integrity");
  const end = lines.findIndex((line, i) => i > at && line.startsWith("### "));
  return lines.slice(at + 1, end);
}

const findingIds = (lines: string[]) =>
  lines.flatMap((line) => /^- \S+ \*\*(TI\d\d)\*\* `([^`]+)`/.exec(line)?.slice(1, 3).join(" ") ?? []);

describe("the comment layout", () => {
  it("lists blocks first, then warns, then info, whatever the report order", () => {
    const report = withSignals([
      signal("TI01", "info", "src/a.test.ts", 1),
      signal("TI03", "warn", "src/b.test.ts", 2),
      signal("TI14", "block", ".pharn/ci.yml", 3),
    ]);
    expect(findingIds(section(renderMarkdown(report)))).toEqual([
      "TI14 .pharn/ci.yml:3",
      "TI03 src/b.test.ts:2",
      "TI01 src/a.test.ts:1",
    ]);
  });

  it("lists 10 findings open and the next ones in a collapsed details block, then counts the rest", () => {
    const warns = Array.from({ length: 24 }, (_, i) =>
      signal("TI03", "warn", `src/t${String(i).padStart(2, "0")}.test.ts`, 1),
    );
    const report = withSignals([...warns, signal("TI14", "block", ".pharn/ci.yml", 3)]);
    const lines = section(renderMarkdown(report));
    const details = lines.indexOf("<details><summary>10 more findings</summary>");
    expect(details).toBeGreaterThan(-1);
    expect(findingIds(lines.slice(0, details))).toHaveLength(10);
    // The block is the first finding, though it comes last in the report.
    expect(findingIds(lines)[0]).toBe("TI14 .pharn/ci.yml:3");
    const close = lines.indexOf("</details>");
    expect(findingIds(lines.slice(details, close))).toHaveLength(10);
    expect(lines).toContain("- _…and 5 more findings in report.json._");
  });

  it("15 findings: 10 open, 5 in the details block, nothing counted", () => {
    const report = withSignals(
      Array.from({ length: 15 }, (_, i) => signal("TI04", "block", `src/f${i}.test.ts`, i + 1)),
    );
    const lines = section(renderMarkdown(report));
    expect(lines).toContain("<details><summary>5 more findings</summary>");
    expect(lines.some((line) => line.includes("more findings in report.json"))).toBe(false);
  });

  it("the headline counts the findings and the blocking ones; with none it is the sentence it was", () => {
    const report = withSignals([
      signal("TI03", "block", "src/a.test.ts", 1),
      signal("TI03", "warn", "src/b.test.ts", 2),
    ]);
    expect(renderMarkdown(report)).toContain(
      "> **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 2 test-integrity findings, 1 blocking; 8 agent setup files found.",
    );
    expect(renderMarkdown(withSignals([signal("TI03", "warn", "src/b.test.ts", 2)]))).toContain(
      "; 1 test-integrity finding; 8 agent setup files found.",
    );
    expect(renderMarkdown(base)).toContain(
      "> **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.",
    );
  });

  it.each([
    ["no findings", [], "warn", "none (warn)"],
    ["mode off", [], "off", "off"],
    [
      "a block among them",
      [signal("TI03", "block", "a.test.ts", 1), signal("TI03", "warn", "b.test.ts", 1)],
      "block",
      "❌ 2 findings, 1 blocking",
    ],
    [
      "warns only",
      [signal("TI03", "warn", "a.test.ts", 1), signal("TI03", "warn", "b.test.ts", 1)],
      "warn",
      "⚠️ 2 findings",
    ],
    ["info only", [signal("TI01", "info", "a.test.ts", 1)], "block", "ℹ️ 1 finding"],
  ] as const)("the summary table's Test integrity cell with %s is %s", (_label, signals, mode, cell) => {
    const lines = renderMarkdown(withSignals([...signals], mode)).split("\n");
    const at = lines.indexOf("| Verdict | Diff coverage | Test integrity | Agent setup |");
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toBe("| --- | --- | --- | --- |");
    expect(lines[at + 2]?.split(" | ")[2]).toBe(cell);
  });

  it("the Messages section leaves out the messages of listed signals and keeps every other message", () => {
    const report = withSignals([
      signal("TI03", "block", "src/a.test.ts", 1),
      signal("TI14", "warn", ".pharn/ci.yml", 3),
    ]);
    const markdown = renderMarkdown(report);
    expect(report.messages.map((m) => m.code)).toEqual(
      expect.arrayContaining(["TEST_INTEGRITY_TI03", "TEST_INTEGRITY_TI14"]),
    );
    expect(markdown).not.toContain("`TEST_INTEGRITY_TI03`");
    expect(markdown).not.toContain("`TEST_INTEGRITY_TI14`");
    const kept = report.messages.filter((m) => !m.code.startsWith("TEST_INTEGRITY_TI"));
    expect(markdown).toContain(`### 💬 Messages (${kept.length})`);
    for (const message of kept) expect(markdown).toContain(`\`${message.code}\``);
  });
});
