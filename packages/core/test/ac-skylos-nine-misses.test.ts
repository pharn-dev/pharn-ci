import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Skylos nine: the four cases the signals of this release do not catch (emptied-assertion, replaced-test and
// edited-expected-value moved out when TI05, TI02 and TI07 shipped; their catch assertions are in
// ac-ti0205-skylos.test.ts and ac-ti07-skylos.test.ts). Each must run through check()
// and the renderer without crashing and give no test-integrity signal. When the signal planned for a case ships (see
// the case table in ac-skylos-nine-table.test.ts), that case's miss assertion is replaced by its catch assertion.
// check(), the renderer and the fixtures are loaded inside each test body: the AC tests are written before
// fixtures/skylos-nine/ exists, so a missing fixture fails only its test, never the file's load.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";

const MISSES = ["deselect-setting", "hard-coded-answer", "always-true-matcher", "loosened-assertion"] as const;

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

describe("Skylos nine: the four expected misses run cleanly and give no signal", () => {
  for (const name of MISSES) {
    it(`AC-3: ${name} — check() and the renderer do not throw, the report is valid and has no test-integrity signal`, async () => {
      const { check } = await import("../src/check.js");
      const { renderMarkdown } = await import("../src/render/markdown.js");
      const input = {
        version: "0.1.0",
        coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
        diff: { text: fixture(`skylos-nine/${name}/change.diff`) },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture(`skylos-nine/${name}/files.txt`).trim().split("\n"),
        testIntegrityMode: { input: "block" },
      } as Parameters<typeof check>[0];

      let report: ReturnType<typeof check> | undefined;
      expect(() => {
        report = check(input);
      }).not.toThrow();
      if (report === undefined) throw new Error("check() returned nothing");
      expectValidReport(report);
      expect(report.testIntegrity.signals).toEqual([]);

      let markdown = "";
      expect(() => {
        markdown = renderMarkdown(report as NonNullable<typeof report>);
      }).not.toThrow();
      expect(section(markdown).filter((line) => line.trim() !== "")).toEqual([
        HEADING,
        "No test-integrity findings (mode: block).",
      ]);
    });
  }
});
