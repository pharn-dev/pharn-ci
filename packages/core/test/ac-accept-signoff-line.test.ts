import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and renderMarkdown() are loaded inside the test body: the AC tests are written before the accept label
// exists, so nothing the build adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";

/** A report with warn TI10 and TI13 signals and their warn messages, and the given `testIntegrity.accepted`. */
async function reportWith(accepted: { label: string; by: string } | null) {
  const { check } = await import("@pharn-ci/core");
  const base = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  const report = {
    ...base,
    messages: [
      ...base.messages,
      { level: "warn", code: "TEST_INTEGRITY_TI10", text: "text-TI10" },
      { level: "warn", code: "TEST_INTEGRITY_TI13", text: "text-TI13" },
    ],
    testIntegrity: {
      ...base.testIntegrity,
      verdict: "warn",
      signals: [
        { id: "TI10", severity: "warn", path: "package.json", line: 7, detail: "detail-TI10" },
        { id: "TI13", severity: "warn", path: "src/a.ts", line: 12, detail: "detail-TI13" },
      ],
      accepted,
    },
  } as unknown as typeof base;
  expectValidReport(report);
  return report;
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

const isAcceptedLine = (line: string) => line.includes("`team/tests-ok`") && line.includes("@Reviewer-1");

describe("the accepted line in the Test integrity section", () => {
  it("AC-10: an accepted report has one line naming the label and @Reviewer-1 after the findings; a null one has none", async () => {
    const { renderMarkdown } = await import("@pharn-ci/core");

    const accepted = section(renderMarkdown(await reportWith({ label: "team/tests-ok", by: "Reviewer-1" })));
    const lastFinding = Math.max(
      accepted.findIndex((line) => line.includes("**TI10**")),
      accepted.findIndex((line) => line.includes("**TI13**")),
    );
    expect(lastFinding).toBeGreaterThan(0);
    const at = accepted.findIndex(isAcceptedLine);
    expect(accepted.filter(isAcceptedLine)).toHaveLength(1);
    // After the last finding and its hint line.
    expect(at).toBeGreaterThan(lastFinding + 1);

    const none = section(renderMarkdown(await reportWith(null)));
    expect(none.filter(isAcceptedLine)).toEqual([]);
    expect(none.filter((line) => line.includes("@Reviewer-1"))).toEqual([]);
  });
});
