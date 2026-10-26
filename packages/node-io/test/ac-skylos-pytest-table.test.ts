import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Skylos nine, part 2: the case → signal → severity table in docs/PRECISION.md cannot drift from check(). Every vitest
// cell is recomputed from fixtures/skylos-nine/ (with fixtures/skylos-nine-sources/ for the five cases that need the
// base and head text), exactly as packages/core/test/ac-skylos-nine-table.test.ts runs them, and every pytest cell from
// fixtures/skylos-nine-pytest/ with the real python3 index. The expected cells are written here too, so a table that
// agrees with a changed check() still fails until it is changed on purpose. The docs, the fixtures, the index and
// check() are read inside the test body. With no python3 of 3.8 or newer on PATH the test fails, never skips.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = `${ROOT}fixtures/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
const SECTION_HEADING = "## 3. Skylos nine: what pharn-ci catches";
const SLOW = 240_000;

/** The python3 on PATH and whether it is 3.8 or newer, decided once while the file loads (no build code runs). */
const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

/** Fails the test, with the reason, when no python3 of 3.8 or newer is on PATH. */
function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
}

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
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const read = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The table's rows in the order the AC names, with the cells the table must hold for each. */
const EXPECTED: ReadonlyArray<{ name: string; vitest: string; pytest: string }> = [
  { name: "deleted-test", vitest: "TI01 block", pytest: "TI01 block" },
  { name: "added-skip", vitest: "TI03 block", pytest: "TI03 block" },
  { name: "emptied-assertion", vitest: "TI05 block", pytest: "TI05 block" },
  { name: "deselect-setting", vitest: "TI09 block", pytest: "TI09 block" },
  { name: "hard-coded-answer", vitest: "missed", pytest: "missed" },
  { name: "always-true-matcher", vitest: "missed", pytest: "TI06 warn" },
  { name: "replaced-test", vitest: "TI02 block", pytest: "TI02 block" },
  { name: "loosened-assertion", vitest: "TI06 warn", pytest: "TI06 warn" },
  { name: "edited-expected-value", vitest: "TI07 warn", pytest: "TI07 warn" },
];
/** The vitest cases whose signal reads the base and head text, which `skylos-nine-sources` holds. */
const WITH_SOURCES = new Set([
  "emptied-assertion",
  "deselect-setting",
  "replaced-test",
  "loosened-assertion",
  "edited-expected-value",
]);

/** A case's cell: `<id> <severity>` of its signals, `missed` when it has none, every distinct pair when they differ. */
function cellOf(signals: Signal[]): string {
  const pairs = [...new Set(signals.map((s) => `${s.id} ${s.severity}`))];
  return pairs.length === 0 ? "missed" : pairs.join(", ");
}

/** The last `## ` section of a markdown text: its heading line and the lines after it. */
function lastH2(text: string): string[] {
  const all = lines(text);
  const starts = all.flatMap((line, index) => (line.startsWith("## ") ? [index] : []));
  if (starts.length === 0) throw new Error("no ## section");
  return all.slice(starts.at(-1) as number);
}

/** The first markdown table of a section: its header cells and its body rows' cells. */
function firstTable(section: string[]): { header: string[]; rows: string[][] } {
  const start = section.findIndex((line) => line.trimStart().startsWith("|"));
  if (start === -1) throw new Error("the section has no table");
  const rest = section.slice(start);
  const end = rest.findIndex((line) => !line.trimStart().startsWith("|"));
  const block = end === -1 ? rest : rest.slice(0, end);
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
  expect(block.length, "a header, a separator and rows").toBeGreaterThanOrEqual(2);
  expect(block[1], "the separator row").toMatch(/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/);
  return { header: cells(block[0] as string), rows: block.slice(2).map(cells) };
}

async function runVitest(name: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const sources = WITH_SOURCES.has(name)
    ? {
        testSources: {
          base: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/base`), dropped: [] },
          head: { files: sideFiles(`${FIXTURES}skylos-nine-sources/${name}/head`), dropped: [] },
        },
      }
    : {};
  const report = check({
    version: "0.1.0",
    coverage: { text: read("fixtures/test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: read(`fixtures/skylos-nine/${name}/change.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: read(`fixtures/skylos-nine/${name}/files.txt`).trim().split("\n"),
    testIntegrityMode: { input: "block" },
    ...sources,
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.map((s) => ({ id: String(s.id), severity: s.severity }));
}

async function runPytest(name: string): Promise<Signal[]> {
  const root = `${FIXTURES}skylos-nine-pytest/${name}/`;
  const sources = {
    base: { files: sideFiles(`${root}base`), dropped: [] },
    head: { files: sideFiles(`${root}head`), dropped: [] },
  };
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  if ([...sources.base.files, ...sources.head.files].some((f) => f.path.endsWith(".py"))) {
    expect(pythonTestIndex?.available, `${name}: the Python index ran`).toBe(true);
  }
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: read("fixtures/test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: readFileSync(`${root}files.txt`, "utf8").trim().split("\n"),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.map((s) => ({ id: String(s.id), severity: s.severity }));
}

describe("docs/PRECISION.md section 3: the Skylos nine table matches check()", () => {
  it(
    "AC-8: the last ## section is ## 3. Skylos nine: what pharn-ci catches, its four-column table has the nine cases in order, every vitest and pytest cell equals what check() returns (and the expected cells), and the totals read vitest 7 of 9, pytest 8 of 9",
    async () => {
      requirePython();
      const section = lastH2(read("docs/PRECISION.md"));
      expect(section[0], "the last ## heading").toBe(SECTION_HEADING);

      const { header, rows } = firstTable(section);
      expect(
        header.map((cell) => cell.toLowerCase()),
        "the four columns",
      ).toEqual(["case", "vitest", "pytest", "notes"]);
      expect(rows.length, "nine rows").toBe(9);
      for (const row of rows) expect(row.length, `row ${row.join(" | ")}: four cells`).toBe(4);
      expect(
        rows.map((row) => (row[0] as string).replace(/^`(.*)`$/, "$1")),
        "the case cells, in order",
      ).toEqual(EXPECTED.map((e) => e.name));

      const CELL = /^(?:TI\d\d (?:block|warn|info)|missed)$/;
      for (const [index, row] of rows.entries()) {
        const expected = EXPECTED[index] as (typeof EXPECTED)[number];
        const [, vitestCell, pytestCell] = row as [string, string, string, string];
        expect(vitestCell, `${expected.name}: the vitest cell's form`).toMatch(CELL);
        expect(pytestCell, `${expected.name}: the pytest cell's form`).toMatch(CELL);

        const liveVitest = cellOf(await runVitest(expected.name));
        const livePytest = cellOf(await runPytest(expected.name));
        expect(vitestCell, `${expected.name}: the vitest cell equals check()`).toBe(liveVitest);
        expect(pytestCell, `${expected.name}: the pytest cell equals check()`).toBe(livePytest);
        expect(vitestCell, `${expected.name}: the expected vitest cell`).toBe(expected.vitest);
        expect(pytestCell, `${expected.name}: the expected pytest cell`).toBe(expected.pytest);
      }

      const text = section.join("\n").replace(/\s+/g, " ");
      expect(text, "the totals sentence").toContain("vitest 7 of 9, pytest 8 of 9");
      const totals = /vitest (\d+) of 9, pytest (\d+) of 9/.exec(text);
      const caught = (column: number) => rows.filter((row) => row[column] !== "missed").length;
      expect([Number(totals?.[1]), Number(totals?.[2])], "the totals equal the table's counts").toEqual([
        caught(1),
        caught(2),
      ]);
    },
    SLOW,
  );
});
