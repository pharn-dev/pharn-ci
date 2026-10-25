import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources, check(), the renderer and the fixture are loaded inside the test body: the AC test is
// written before the tests-changed summary, its table and fixtures/tests-changed/ exist, so nothing that depends on
// them may run while the file loads. The expected section is written here from the AC (the fixture's planned counts:
// +4 −1 ~3 · 2 renamed over five files); the committed golden under fixtures/tests-changed/ must hold the same text,
// so the golden is checked against this expectation and is not the oracle itself.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ROOT = `${FIXTURES}tests-changed/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const HEADING = "### 🔍 Test integrity";
const SLOW = 60_000;

/** The collapsed Tests changed section the AC-8 report renders, line by line (U+2212 minus, U+00B7 middle dot). */
const EXPECTED = [
  "<details><summary>Tests changed: +4 \u22121 ~3 \u00b7 2 renamed</summary>",
  "",
  "| Test file | Added | Removed | Modified | Renamed |",
  "| --- | ---: | ---: | ---: | ---: |",
  "| `src/a.test.ts` | 1 | 1 | 2 | 0 |",
  "| `src/b.test.ts` | 0 | 0 | 0 | 1 |",
  "| `src/c.test.js` | 1 | 0 | 0 | 0 |",
  "| `src/d.test.ts` | 1 | 0 | 0 | 1 |",
  "| `tests/test_e.py` | 1 | 0 | 1 | 0 |",
  "",
  "</details>",
  "",
];

interface SourceFile {
  path: string;
  text: string;
}
interface Entry {
  path: string;
  name: string;
  line: number;
}
interface Report {
  testIntegrity: {
    signals: { detail: string }[];
    changes?: { added: Entry[]; removed: Entry[]; modified: Entry[]; renamed: Entry[] };
  };
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

async function report(): Promise<Report> {
  const base = sideFiles(`${ROOT}base`);
  const head = sideFiles(`${ROOT}head`);
  const diff = readFileSync(`${ROOT}change.diff`, "utf8");
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const sources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran with the real interpreter").toBe(true);
  const { check } = await import("@pharn-ci/core");
  const result = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set(head.map((f) => f.path))].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "warn" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(result);
  return result as unknown as Report;
}

describe("renderMarkdown(): the collapsed Tests changed table", () => {
  it(
    "AC-11: right after the Test integrity section's lines the comment holds the collapsed Tests changed summary and table, equal to the committed golden, and no test name",
    async () => {
      const r = await report();
      expect(r.testIntegrity.changes, "the report holds testIntegrity.changes").toBeDefined();
      const { renderMarkdown } = await import("@pharn-ci/core");
      const markdown = renderMarkdown(r as never);
      const lines = markdown.split("\n");

      const start = lines.indexOf(HEADING);
      expect(start, "a Test integrity section").toBeGreaterThan(-1);
      const nextHeading = lines.findIndex((line, i) => i > start && line.startsWith("### "));
      const end = nextHeading === -1 ? lines.length : nextHeading;
      const at = lines.indexOf(EXPECTED[0] as string);
      expect(at, "the summary line").toBeGreaterThan(start);
      expect(lines.slice(at, at + EXPECTED.length)).toEqual(EXPECTED);
      expect(lines[at - 1], "a blank line closes the section's own lines").toBe("");
      expect(at + EXPECTED.length, "the block ends the Test integrity section").toBe(end);
      // The section's own lines come between the heading and the block, and none of them is the table.
      const own = lines.slice(start + 2, at - 1);
      expect(own.length, "the section's own lines").toBeGreaterThan(0);
      for (const line of own) expect(line.startsWith("<details><summary>Tests changed")).toBe(false);

      const golden = readFileSync(`${ROOT}comment-section.md`, "utf8");
      expect(golden.replace(/\n+$/, ""), "the committed golden holds the same section").toBe(
        EXPECTED.join("\n").replace(/\n+$/, ""),
      );

      // No test name of the summary reaches the comment, except where an existing finding's detail already names it.
      const changes = r.testIntegrity.changes as NonNullable<Report["testIntegrity"]["changes"]>;
      const details = r.testIntegrity.signals.map((s) => s.detail).join("\n");
      const block = EXPECTED.join("\n");
      for (const entry of [...changes.added, ...changes.removed, ...changes.modified, ...changes.renamed]) {
        expect(block, entry.name).not.toContain(entry.name);
        if (details.includes(entry.name)) continue;
        expect(markdown, `the name ${entry.name} is not in the comment`).not.toContain(entry.name);
      }
    },
    SLOW,
  );
});
