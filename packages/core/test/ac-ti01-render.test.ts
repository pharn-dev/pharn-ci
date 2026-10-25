import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the renderer are loaded inside each test body: the AC tests are written before TI01 and
// fixtures/test-integrity/TI01/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";

async function load() {
  const { check } = await import("../src/check.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, renderMarkdown };
}

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

async function tiReport() {
  const { check } = await load();
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture("test-integrity/TI01/block-code-stays.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("renderMarkdown(): the Test integrity section lists TI01 findings", () => {
  it("AC-11: a check() report with a block signal lists it with a hint, and the Messages hint does not name an accept label", async () => {
    const { renderMarkdown } = await load();
    const report = await tiReport();
    const markdown = renderMarkdown(report);

    const lines = section(markdown);
    const at = lines.findIndex((line) => line.includes("TI01"));
    expect(at, lines.join("\n")).toBeGreaterThan(-1);
    expect(lines[at]).toContain("`src/__tests__/b.test.ts`");
    expect(lines[at]).toContain(report.testIntegrity.signals[0]?.detail ?? "missing");
    expect(lines[at + 1]?.startsWith("  - Hint: ")).toBe(true);

    // The comment-layout change leaves the signal's message out of the Messages section on purpose (the finding and
    // its hint are listed above); report.json keeps it. The hint under the finding names no accept label.
    expect(report.messages.some((m) => m.code === "TEST_INTEGRITY_TI01")).toBe(true);
    expect(markdown).not.toContain("`TEST_INTEGRITY_TI01`");
    expect((lines[at + 1] ?? "").toLowerCase()).not.toContain("accept");
  });

  it("AC-11: three signals of severity block, warn and info give three finding lines, each with its hint line", async () => {
    const { renderMarkdown } = await load();
    const report = await tiReport();
    const synthetic = {
      ...report,
      testIntegrity: {
        ...report.testIntegrity,
        signals: [
          { id: "TI01", severity: "block", path: "a/x.test.ts", line: null, detail: "detail-block" },
          { id: "TI01", severity: "warn", path: "b/y.test.ts", line: null, detail: "detail-warn" },
          { id: "TI01", severity: "info", path: "c/z.test.ts", line: null, detail: "detail-info" },
        ],
      },
    } as typeof report;
    expectValidReport(synthetic);

    const lines = section(renderMarkdown(synthetic));
    for (const [path, detail] of [
      ["a/x.test.ts", "detail-block"],
      ["b/y.test.ts", "detail-warn"],
      ["c/z.test.ts", "detail-info"],
    ] as const) {
      const at = lines.findIndex((line) => line.includes(`\`${path}\``));
      expect(at, path).toBeGreaterThan(-1);
      expect(lines[at], path).toContain("TI01");
      expect(lines[at], path).toContain(detail);
      expect(lines[at + 1]?.startsWith("  - Hint: "), path).toBe(true);
    }
  });

  it("AC-11: the report without signals keeps exactly the four lines of the empty state, where a report with one lists it", async () => {
    const { check, renderMarkdown } = await load();
    // Control: the report with a signal lists a finding line, so the empty state below is a decision, not a gap.
    const listed = section(renderMarkdown(await tiReport()));
    expect(listed.some((line) => line.includes("TI01"))).toBe(true);

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    expect(report.testIntegrity.signals).toEqual([]);
    expect(section(renderMarkdown(report))).toEqual([HEADING, "", "No test-integrity findings (mode: warn).", ""]);
  });
});
