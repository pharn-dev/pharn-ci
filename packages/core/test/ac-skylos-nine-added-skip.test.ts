import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Skylos nine, case "added-skip": an agent turns a failing vitest test into an unconditional skip. Caught today by
// TI03. check(), the renderer and the fixtures are loaded inside the test body: the AC tests are written before
// fixtures/skylos-nine/ exists, so a missing fixture fails only its test, never the file's load.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const CASE = "added-skip";

/** The lines of the Test integrity section: from its heading to the line before the next `### ` heading. */
function section(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(HEADING);
  if (start === -1) throw new Error("no Test integrity heading");
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return [HEADING, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** `it("name", …` or `test("name", …` (optionally `.skip`): the call, the modifier and the test name. */
const OPENING = /^\s*(it|test)(\.skip)?\(\s*(['"`])(.*?)\3/;

describe("Skylos nine: the added-skip case is caught by TI03", () => {
  it("AC-2: turning an existing it( into it.skip( with the same name gives one TI03 block signal, a fail verdict and a rendered **TI03** line with path:line", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const diff = fixture(`skylos-nine/${CASE}/change.diff`);
    const repoFiles = fixture(`skylos-nine/${CASE}/files.txt`).trim().split("\n");

    // The Given: one test file, one removed opening line and one added `.skip` opening line with the same name.
    const lines = diff.split("\n");
    const target = lines.find((line) => line.startsWith("+++ b/"));
    expect(target).toBeDefined();
    const path = (target ?? "").slice("+++ b/".length);
    expect(path).toMatch(/\.test\.ts$/);
    const hunkHeader = lines.find((line) => line.startsWith("@@"));
    const newStart = Number(/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(hunkHeader ?? "")?.[1] ?? Number.NaN);
    expect(Number.isInteger(newStart)).toBe(true);
    const removed = lines
      .filter((l) => l.startsWith("-") && !l.startsWith("--- "))
      .map((l) => OPENING.exec(l.slice(1)));
    const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++ ")).map((l) => OPENING.exec(l.slice(1)));
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0]).not.toBeNull();
    expect(added[0]).not.toBeNull();
    expect(removed[0]?.[2]).toBeUndefined();
    expect(added[0]?.[2]).toBe(".skip");
    expect(added[0]?.[1]).toBe(removed[0]?.[1]);
    expect(added[0]?.[4]).toBe(removed[0]?.[4]);

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
    expect(signals.map((s) => String(s.id))).toEqual(["TI03"]);
    expect(signals[0]?.severity).toBe("block");
    expect(signals[0]?.path).toBe(path);
    expect(signals[0]?.line).toBe(newStart);
    expect(report.testIntegrity.verdict).toBe("fail");

    const rendered = section(renderMarkdown(report));
    const finding = rendered.find((line) => line.includes("**TI03**"));
    expect(finding, rendered.join("\n")).toBeDefined();
    expect(finding).toContain(`\`${path}:${newStart}\``);
  });
});
