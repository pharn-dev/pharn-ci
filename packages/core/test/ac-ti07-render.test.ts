import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the renderer and the fixture are loaded inside the test body: the AC test is written before TI07 and its
// hint exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const CASE = "warn-tobe-number";
const HINT =
  "  - Hint: Check each new expected value against what the code should do, not what it now returns; if the behaviour change is meant, say so in the PR so a reviewer can confirm it.";
const FINDING = /^- \S+ \*\*(TI\d\d)\*\* `([^`]+)`/;

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
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

describe("renderMarkdown(): TI07 in the Test integrity section", () => {
  it("AC-7: the TI07 finding is listed with **TI07** in bold, path:line in a code span and the detail, followed by its hint line", async () => {
    const root = `${FIXTURES}test-integrity/TI07/${CASE}/`;
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    expect(head.length, "the case has head test text").toBeGreaterThan(0);
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: readFileSync(`${root}change.diff`, "utf8") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
      testIntegrityMode: { input: "block" },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const signals = (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI07");
    expect(signals).toHaveLength(1);
    const signal = signals[0] as Signal;

    const { renderMarkdown } = await import("../src/render/markdown.js");
    const lines = section(renderMarkdown(report as never));
    const at = lines.findIndex((line) => {
      const m = FINDING.exec(line);
      return m !== null && m[1] === "TI07" && m[2] === `${signal.path}:${signal.line}`;
    });
    expect(at, "the TI07 finding line, **TI07** then `path:line`").toBeGreaterThan(-1);
    const line = lines[at] as string;
    // A plain prefix comparison: the icon, then the id in bold, then the location code span, then a space.
    expect(line, "one finding line, the id in bold then the code span").toMatch(/^- \S+ \*\*TI07\*\* `/);
    const afterIcon = line.slice(line.indexOf(" **TI07** "));
    expect(afterIcon.startsWith(` **TI07** \`${signal.path}:${signal.line}\` `), afterIcon).toBe(true);
    expect(line.replace(/\\(.)/g, "$1"), "the finding line holds the detail").toContain(signal.detail);
    expect(lines[at + 1]).toBe(HINT);
  });
});
