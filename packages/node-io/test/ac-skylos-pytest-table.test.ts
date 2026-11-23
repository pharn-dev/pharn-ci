import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// Skylos nine, part 2: the case → signal → severity cells cannot drift from check(). Every vitest cell is recomputed
// from fixtures/skylos-nine/ (with fixtures/skylos-nine-sources/ for the five cases that need the base and head text),
// exactly as packages/core/test/ac-skylos-nine-table.test.ts runs them, and every pytest cell from
// fixtures/skylos-nine-pytest/ with the real python3 index, and each must equal the expected cell written here. The
// fixtures, the index and check() are read inside the test body. With no python3 of 3.8 or newer on PATH the test
// fails, never skips. (CORE-133: the check that the docs/PRECISION.md §3 table holds the same cells moved out.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = `${ROOT}fixtures/`;
const REPO_ROOT = "/home/runner/work/demo/demo";
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

/** The table's rows in the order the AC names, with the cells the table must hold for each. */
const EXPECTED: ReadonlyArray<{ name: string; vitest: string; pytest: string }> = [
  { name: "deleted-test", vitest: "TI01 block", pytest: "TI01 block" },
  { name: "added-skip", vitest: "TI03 block", pytest: "TI03 block" },
  { name: "emptied-assertion", vitest: "TI05 block", pytest: "TI05 block" },
  { name: "deselect-setting", vitest: "TI09 block", pytest: "TI09 block" },
  { name: "hard-coded-answer", vitest: "missed", pytest: "missed" },
  // ti17-always-true-matcher-2: TI17 reads the matcher (vitest) and the helper (pytest); pytest keeps its TI06 too.
  { name: "always-true-matcher", vitest: "TI17 warn", pytest: "TI06 warn, TI17 warn" },
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

async function runVitest(name: string): Promise<Signal[]> {
  const { check } = await import("../../core/test/text-coverage.js");
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
  const { check } = await import("../../core/test/text-coverage.js");
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

describe("the Skylos nine cells match check()", () => {
  it(
    "AC-8: every vitest and pytest cell of the nine cases equals what check() returns and the expected cell, and the totals are vitest 8 of 9, pytest 8 of 9",
    async () => {
      requirePython();
      const live: Array<{ vitest: string; pytest: string }> = [];
      for (const expected of EXPECTED) {
        const liveVitest = cellOf(await runVitest(expected.name));
        const livePytest = cellOf(await runPytest(expected.name));
        expect(liveVitest, `${expected.name}: the expected vitest cell`).toBe(expected.vitest);
        expect(livePytest, `${expected.name}: the expected pytest cell`).toBe(expected.pytest);
        live.push({ vitest: liveVitest, pytest: livePytest });
      }
      const caught = (column: "vitest" | "pytest") => live.filter((cells) => cells[column] !== "missed").length;
      expect([caught("vitest"), caught("pytest")], "vitest 8 of 9, pytest 8 of 9").toEqual([8, 8]);
    },
    SLOW,
  );
});
