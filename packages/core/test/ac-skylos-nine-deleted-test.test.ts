import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Skylos nine, case "deleted-test": an agent deletes a failing vitest test file and keeps its source. Caught today by
// TI01. check(), the renderer and the fixtures are loaded inside the test body: the AC tests are written before
// fixtures/skylos-nine/ exists, so a missing fixture fails only its test, never the file's load.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const CASE = "deleted-test";

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** The path of every file the diff deletes, with the lines it removes from it. */
function deletedFiles(diff: string): Array<{ path: string; removed: string[] }> {
  const out: Array<{ path: string; removed: string[] }> = [];
  for (const chunk of diff.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "))) {
    const lines = chunk.split("\n");
    if (!lines.some((line) => line.startsWith("deleted file mode"))) continue;
    const from = lines.find((line) => line.startsWith("--- a/"));
    if (from === undefined) continue;
    const firstHunk = lines.findIndex((line) => line.startsWith("@@"));
    const removed = lines
      .slice(firstHunk === -1 ? lines.length : firstHunk)
      .filter((line) => line.startsWith("-"))
      .map((line) => line.slice(1));
    out.push({ path: from.slice("--- a/".length), removed });
  }
  return out;
}

describe("Skylos nine: the deleted-test case is caught by TI01", () => {
  it("AC-1: deleting a vitest test file while its source stays gives one TI01 block signal, a fail verdict and a rendered **TI01** line with the path", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const diff = fixture(`skylos-nine/${CASE}/change.diff`);
    const repoFiles = fixture(`skylos-nine/${CASE}/files.txt`).trim().split("\n");

    // The Given: one deleted vitest test file whose removed lines define tests; it is gone at head, its source is not.
    const deleted = deletedFiles(diff);
    expect(deleted.map((d) => d.path)).toHaveLength(1);
    const [{ path, removed }] = deleted as [{ path: string; removed: string[] }];
    expect(path).toMatch(/\.test\.ts$/);
    expect(removed.some((line) => /\b(it|test)\(/.test(line))).toBe(true);
    expect(repoFiles).not.toContain(path);
    const sourceName = (path.split("/").at(-1) ?? "").replace(/\.test\.ts$/, ".ts");
    expect(repoFiles.some((file) => file.split("/").at(-1) === sourceName)).toBe(true);

    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles,
      testIntegrityMode: { input: "block" },
    } as Parameters<typeof check>[0]);
    expectValidReport(report);

    const signals = report.testIntegrity.signals;
    expect(signals.map((s) => String(s.id))).toEqual(["TI01"]);
    expect(signals[0]?.severity).toBe("block");
    expect(signals[0]?.path).toBe(path);
    expect(report.testIntegrity.verdict).toBe("fail");

    const lines = section(renderMarkdown(report));
    const finding = lines.find((line) => line.includes("**TI01**"));
    expect(finding, lines.join("\n")).toBeDefined();
    expect(finding).toContain(`\`${path}\``);
  });
});
