import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside the test body: the AC test is written before the TI01
// moved-names rule reads the Python index and before fixtures/test-integrity-precision/ exists, so nothing the build
// adds may run while the file loads. The fixture is written by the build, so the test first checks that its text
// holds the case: the AC-8 shape as Python test files. The real interpreter runs, with no skip: the moved-names rule
// for Python needs the Python index, so a run without one proves nothing here.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const ROOT = `${FIXTURES}test-integrity-precision/TI01/info-moved-names-py/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const SLOW = 60_000;
const DELETED = ["parse", "format", "load", "save", "merge", "split"].map((n) => `tests/test_${n}.py`);
const MODIFIED = "pkg/test_core.py";
const ADDED = ["pkg/text/test_text_ops.py", "pkg/io/test_io_ops.py"];
const MOVED_DETAIL =
  "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";
const TODAY = "Test file deleted; its removed lines defined tests.";

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

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
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

const textAt = (files: SourceFile[], path: string) => {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  return file.text;
};
const defs = (text: string) => [...text.matchAll(/^\s*(?:async\s+)?def\s+(test\w*)\s*\(/gm)].map((m) => m[1] as string);

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

async function run(diff: string, base: SourceFile[], head: SourceFile[], pythonTestIndex: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "pkg/core.py"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("TI01 precision on Python test files, through the Python test index", () => {
  it(
    "AC-10: the moved-names case as Python files is TI01 info with the moved detail with the Python index, and TI01 block with today's detail with the index unavailable",
    async () => {
      const diff = readFileSync(`${ROOT}change.diff`, "utf8");
      const base = sideFiles(`${ROOT}base`);
      const head = sideFiles(`${ROOT}head`);
      for (const path of DELETED) expect(diffSection(diff, path), `${path} is deleted`).toMatch(/^deleted file mode/m);
      expect(diffSection(diff, MODIFIED)).not.toMatch(/^(new|deleted) file mode/m);
      for (const path of ADDED) expect(diffSection(diff, path), `${path} is added`).toMatch(/^new file mode/m);
      const headDefs = new Set([...ADDED, MODIFIED].flatMap((path) => defs(textAt(head, path))));
      for (const path of DELETED) {
        const names = defs(textAt(base, path));
        expect(names.length, `${path} defines tests`).toBeGreaterThan(0);
        for (const name of names) expect(headDefs.has(name), `${path}: ${name} reappears`).toBe(true);
      }

      const io = (await import("../src/index.js")) as unknown as {
        indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
      };
      const pythonTestIndex = await io.indexPythonTestSources({
        base: { files: base, dropped: [] },
        head: { files: head, dropped: [] },
      });
      expect(pythonTestIndex?.available, "the Python index ran with the real interpreter").toBe(true);

      const moved = await run(diff, base, head, pythonTestIndex);
      const unavailable = await run(diff, base, head, {
        available: false,
        reason: "python-not-found",
        detail: "no python3 found on PATH",
      });
      for (const [report, severity, detail] of [
        [moved, "info", MOVED_DETAIL],
        [unavailable, "block", TODAY],
      ] as const) {
        const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01");
        for (const path of DELETED) {
          const mine = ti01.filter((s) => s.path === path);
          expect(mine, `${path}: one TI01 signal`).toHaveLength(1);
          expect(mine[0]?.severity, `${path} is ${severity}`).toBe(severity);
          expect(mine[0]?.detail).toBe(detail);
        }
      }
    },
    SLOW,
  );
});
