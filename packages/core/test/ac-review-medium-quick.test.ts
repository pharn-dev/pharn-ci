import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { MESSAGE_HINTS, renderMarkdown } from "../src/render/markdown.js";
import {
  type Message,
  type Report,
  type TestIntegritySignal,
  testIntegritySignalMessages,
  verdictOf,
} from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Review MEDIUM quick batch: findings 10 (a cut signal id keeps its message), 11 (no hint tells the reader to loosen
// the gate), 17 and 18 (README and SECURITY.md name the token permissions and git commands the job uses). The doc pins
// read the documents inside each test body: a separate patch edits them.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const lineStarting = (doc: string, start: string) => doc.split("\n").find((line) => line.startsWith(start));

const base = check({
  version: "0.4.0",
  coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
  diff: { text: fixture("golden/pr.diff") },
  repoRoot: "/home/runner/work/demo/demo",
  threshold: 80,
  repoFiles: fixture("golden/files.txt").trim().split("\n"),
} as Parameters<typeof check>[0]);

const signal = (id: string, severity: TestIntegritySignal["severity"], path: string, line: number) =>
  ({ id, severity, path, line, detail: `${id} ${severity} finding.` }) as TestIntegritySignal;

/** The golden report with these signals and their messages, plus `extra` messages, in mode block. */
function reportWith(signals: TestIntegritySignal[], extra: Message[] = []): Report {
  const others = base.messages.filter((m) => !/^TEST_INTEGRITY_TI\d\d$/.test(m.code));
  const messages = [...others, ...extra, ...testIntegritySignalMessages(signals)];
  const verdict = signals.some((s) => s.severity === "block") ? "fail" : signals.length > 0 ? "warn" : "pass";
  const report = {
    ...base,
    verdict: verdictOf(messages),
    messages,
    testIntegrity: { ...base.testIntegrity, mode: "block", source: "input" as const, verdict, signals },
  } as Report;
  expectValidReport(report);
  return report;
}

/** The lines of the 💬 Messages section, heading excluded (empty when there is none). */
function messagesSection(markdown: string): string[] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => line.startsWith("### 💬 Messages"));
  if (at === -1) return [];
  const end = lines.findIndex((line, i) => i > at && line.startsWith("### "));
  return lines.slice(at + 1, end === -1 ? undefined : end);
}

/** Phrases that tell the reader to loosen the gate the message reports on. */
const LOOSENING = ["policy: never", "test-integrity: off", "coverage.exclude", "remove it from `"];

describe("review finding 10: a signal id cut from the Test integrity section keeps its message", () => {
  it("20 TI04 blocks and 1 TI16 info: TEST_INTEGRITY_TI16 is under Messages, TEST_INTEGRITY_TI04 is not, and the cut is counted", () => {
    const blocks = Array.from({ length: 20 }, (_, i) => signal("TI04", "block", "src/focus.test.ts", i + 1));
    const report = reportWith([...blocks, signal("TI16", "info", "src/lint.test.ts", 1)]);
    expect(report.messages.map((m) => m.code)).toEqual(
      expect.arrayContaining(["TEST_INTEGRITY_TI04", "TEST_INTEGRITY_TI16"]),
    );
    const markdown = renderMarkdown(report);
    const messages = messagesSection(markdown);
    expect(messages.some((line) => line.includes("`TEST_INTEGRITY_TI16`"))).toBe(true);
    expect(messages.some((line) => line.includes("`TEST_INTEGRITY_TI04`"))).toBe(false);
    expect(markdown.split("\n")).toContain("- _…and 1 more findings in report.json._");
  });
});

describe("review finding 11: no hint tells the reader to loosen the gate", () => {
  it("every MESSAGE_HINTS value and every per-signal hint lacks the loosening phrases", () => {
    const hints = Object.entries(MESSAGE_HINTS).map(
      ([code, hint]) => [code, typeof hint === "function" ? hint("`pharn-ci:accept`") : hint] as const,
    );
    expect(hints.length).toBeGreaterThan(0);
    for (const [code, text] of hints) {
      for (const phrase of LOOSENING) expect(text, `${code} hint`).not.toContain(phrase);
    }

    // The per-signal hints under each finding, as rendered.
    const ids = Array.from({ length: 16 }, (_, i) => `TI${String(i + 1).padStart(2, "0")}`);
    const markdown = renderMarkdown(reportWith(ids.map((id, i) => signal(id, "warn", `src/t${i}.test.ts`, 1))));
    const hintLines = markdown.split("\n").filter((line) => line.startsWith("  - Hint: "));
    expect(hintLines.length).toBeGreaterThanOrEqual(ids.length);
    for (const line of hintLines) for (const phrase of LOOSENING) expect(line).not.toContain(phrase);
  });

  it("the rendered POLICY_UNAVAILABLE and AGENT_SETUP_EXPECTED_MISSING hints name no way to loosen the gate", () => {
    const report = reportWith(
      [],
      [
        { level: "warn", code: "POLICY_UNAVAILABLE", text: "The org policy could not be fetched." },
        { level: "warn", code: "AGENT_SETUP_EXPECTED_MISSING", text: "No setup file for: cursor." },
      ],
    );
    const lines = messagesSection(renderMarkdown(report));
    for (const code of ["POLICY_UNAVAILABLE", "AGENT_SETUP_EXPECTED_MISSING"]) {
      const at = lines.findIndex((line) => line.includes(`\`${code}\``));
      expect(at, `${code} is listed`).toBeGreaterThan(-1);
      const hint = lines[at + 1] ?? "";
      expect(hint.startsWith("  - Hint: "), `${code} has a hint`).toBe(true);
      for (const phrase of LOOSENING) expect(hint, `${code} hint`).not.toContain(phrase);
    }
  });
});

describe("review findings 17 and 18: README and SECURITY.md name what the job uses", () => {
  it("README: the github-token input row names pulls/{n}/commits and pull-requests: read", () => {
    const row = lineStarting(read("README.md"), "| `github-token`");
    expect(row, "the github-token row").toBeDefined();
    expect(row).toContain("pulls/{n}/commits");
    expect(row).toContain("pull-requests: read");
  });

  it("README: the quick-start id-token: write line says it is for the upload", () => {
    const line = read("README.md")
      .split("\n")
      .find((l) => /^\s+id-token: write #/.test(l));
    expect(line, "the quick-start id-token line").toBeDefined();
    expect(line).toContain("upload");
  });

  it("README: the Small token footprint bullet names id-token: write", () => {
    const line = lineStarting(read("README.md"), "- **Small token footprint.**");
    expect(line, "the Small token footprint bullet").toBeDefined();
    expect(line).toContain("`id-token: write`");
  });

  it("SECURITY.md: the repo owner/name row names /pulls/{n}/commits", () => {
    const row = lineStarting(read("SECURITY.md"), "| Repo owner/name, PR number");
    expect(row, "the repo owner/name row").toBeDefined();
    expect(row).toContain("/pulls/{n}/commits");
  });

  it("SECURITY.md: the source code row names git cat-file, git merge-base and git rev-parse", () => {
    const row = lineStarting(read("SECURITY.md"), "| Source code and working tree");
    expect(row, "the source code row").toBeDefined();
    for (const command of ["git cat-file", "git merge-base", "git rev-parse"]) expect(row).toContain(command);
  });
});
