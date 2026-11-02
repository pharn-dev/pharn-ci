import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// The fixtures, indexPythonTestSources and check() are loaded inside the test body: this AC test is written before the
// Python index and the line reader read `pytestmark` and before the fixtures exist. Each case's sources are indexed by
// node-io with the real python3, then check() runs in mode block. With no python3 of 3.8 or newer on PATH the test
// fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PY = "tests/test_user.py";
const DRAFT = "tests/test_draft.py";
const ADDS = "A skip was added to a test that no removed line of this file opens, so the diff shows it as new.";
const CONDITIONAL = "A conditional skip was added; the test is skipped only where its condition holds.";

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

function textOf(files: SourceFile[], path: string): string {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no ${path}`);
  return file.text;
}

/** The 1-based number of the one line of `text` whose trimmed start is `start`. */
function lineStarting(text: string, start: string): number {
  const found = text
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trimStart().startsWith(start));
  expect(found, `exactly one line starts with ${start}`).toHaveLength(1);
  return (found[0] as { index: number }).index + 1;
}

/** The added and removed lines of a diff, headers left out. */
const changedLines = (diff: string) => diff.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

/** The case's sources indexed with the real python3, then check() in mode block; the report validated. */
async function runCase(name: string) {
  const root = `${FIXTURES}test-integrity/TI03/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const testSources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<{ available: boolean } | undefined>;
  };
  const pythonTestIndex = await io.indexPythonTestSources(testSources);
  expect(pythonTestIndex?.available, `${name}: the Python index ran`).toBe(true);
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const ti03 = (report as unknown as Report).testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map(({ severity, path, line, detail }) => ({ severity, path, line, detail }));
  return { diff, base, head, ti03 };
}

describe("TI03 does not block the pytestmark forms that stop no test that ran before", () => {
  it("AC-9: pytestmark skip in a file the change adds warns with the new adds sentence, a pytestmark skipif warns as conditional, and an untouched pytestmark gives nothing", async () => {
    requirePython();

    const added = await runCase("warn-pytestmark-new-file");
    expect(added.base, "the file is new").toEqual([]);
    expect(added.diff, "the diff adds the file").toContain("new file mode");
    const addedLine = lineStarting(textOf(added.head, DRAFT), 'pytestmark = pytest.mark.skip(reason="wip")');
    expect(added.ti03, "warn-pytestmark-new-file").toEqual([
      { severity: "warn", path: DRAFT, line: addedLine, detail: ADDS },
    ]);

    const conditional = await runCase("warn-pytestmark-skipif");
    expect(textOf(conditional.base, PY), "no pytestmark at base").not.toContain("pytestmark");
    const conditionalHead = textOf(conditional.head, PY);
    const conditionalLine = lineStarting(conditionalHead, "pytestmark = pytest.mark.skipif(");
    expect(conditionalHead.split("\n")[conditionalLine - 1]?.startsWith("pytestmark"), "at column 0").toBe(true);
    expect(conditional.ti03, "warn-pytestmark-skipif").toEqual([
      { severity: "warn", path: PY, line: conditionalLine, detail: CONDITIONAL },
    ]);

    const unchanged = await runCase("pass-pytestmark-unchanged");
    for (const side of [unchanged.base, unchanged.head]) {
      expect(textOf(side, PY).split("\n"), "the same pytestmark on both sides").toContain(
        'pytestmark = pytest.mark.skip(reason="x")',
      );
    }
    expect(
      changedLines(unchanged.diff).some((l) => l.includes("pytestmark")),
      "the diff does not touch the pytestmark line",
    ).toBe(false);
    expect(changedLines(unchanged.diff).length, "but it edits a test body").toBeGreaterThan(0);
    expect(unchanged.ti03, "pass-pytestmark-unchanged").toEqual([]);
  });
});
