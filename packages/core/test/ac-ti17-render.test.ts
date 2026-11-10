import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// ti17-always-true-matcher-2, AC-19. check() and the renderer are loaded inside the test body: the AC test is written
// before TI17 and its hint exist. The first report is the one of AC-1. The second adds a lint suppression to the same
// test file (so path order cannot decide), and the report also holds a TI16 finding; its severity is set to warn, the
// TI17 severity, so the order of the two lines in the comment is the report order and not the severity order. The
// suppression marker is built from parts, so this file holds none as written.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "skylos-nine/always-true-matcher";
const HEADING = "### 🔍 Test integrity";
const FINDING = /^- \S+ \*\*(TI\d\d)\*\* `([^`]+)`/;

async function report(diff: string) {
  const { check } = await import("../src/check.js");
  const result = check({
    version: "0.1.0",
    coverage: { text: "SF:src/cart.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(`${CASE}/files.txt`).trim().split("\n"),
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(result);
  return result;
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

const findings = (lines: string[]) =>
  lines.flatMap((line, at) => {
    const m = FINDING.exec(line);
    return m === null ? [] : [{ id: m[1] as string, where: m[2] as string, at }];
  });

describe("renderMarkdown(): TI17 in the Test integrity section", () => {
  it("AC-19: the comment lists TI17 with src/cart.test.ts:9 and its detail and a hint to restore the assertion that can fail or say in the PR why the test checks less now, and a TI17 line follows a TI16 line of the same severity", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const benchmark = fixture(`${CASE}/change.diff`);
    const one = await report(benchmark);
    const signal = one.testIntegrity.signals.find((s) => String(s.id) === "TI17");
    expect(signal, "the report holds TI17").toBeDefined();

    const lines = section(renderMarkdown(one));
    const listed = findings(lines).filter((f) => f.id === "TI17");
    expect(listed.map((f) => f.where)).toEqual(["src/cart.test.ts:9"]);
    const at = (listed[0] as { at: number }).at;
    const line = lines[at] as string;
    expect(line.replace(/\\(.)/g, "$1"), "the finding line holds the detail").toContain(signal?.detail ?? "\u0000");
    const hint = lines[at + 1] ?? "";
    expect(hint.startsWith("  - Hint: "), "TI17 has a hint").toBe(true);
    expect(hint).toMatch(/restore/i);
    expect(hint).toMatch(/assertion that can fail/);
    expect(hint).toMatch(/\b(PR|pull request)\b/);
    expect(hint).toMatch(/why the test checks less/);

    // A TI16 finding beside it, at the same severity: the TI17 line comes after the TI16 line.
    const LINE = ["/", "/"].join("");
    const marker = `  ${LINE} ${["eslint", "-disable-next-line"].join("")} no-console`;
    // One more hunk of the same test file (the benchmark diff has one file and ends with a newline).
    const both = await report(`${benchmark}${["@@ -15,0 +17 @@", `+${marker}`, ""].join("\n")}`);
    const same = {
      ...both,
      testIntegrity: {
        ...both.testIntegrity,
        signals: both.testIntegrity.signals.map((s) => (String(s.id) === "TI16" ? { ...s, severity: "warn" } : s)),
      },
    } as typeof both;
    expectValidReport(same);
    const order = findings(section(renderMarkdown(same)));
    const ti16 = order.findIndex((f) => f.id === "TI16");
    const ti17 = order.findIndex((f) => f.id === "TI17");
    expect(ti16, "a TI16 line").toBeGreaterThan(-1);
    expect(ti17, "a TI17 line").toBeGreaterThan(-1);
    expect(ti16, "TI16 comes before TI17").toBeLessThan(ti17);
  });
});
