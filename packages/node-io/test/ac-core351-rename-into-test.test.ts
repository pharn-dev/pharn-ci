import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-351 (AC-18). A file renamed from a non-test path (py/cart_checks.py) into a test path (py/test_cart.py) is read
// as an added test file: its head tests are counted as added tests of py/test_cart.py. The rename also adds a skip
// decorator above a `def test_…` line the diff does not show, spelled `@pytest.mark.skip` and, separately,
// `@pt.mark.skip` under `import pytest as pt`; TI03's line pass keeps the finding it gives on today's code (measured
// during planning: block, at the decorator line). The head text is indexed by node-io with the real python3; then
// check() runs. indexPythonTestSources and check() are loaded inside the test body: the AC test is written before the
// build, so nothing the build changes may run while the file loads. With no python3 of 3.8 or newer on PATH the test
// fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const OLD = "py/cart_checks.py";
const NEW = "py/test_cart.py";
const SLOW = 120_000;

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

interface Spelling {
  name: string;
  importLine: string;
  decorator: string;
}

const SPELLINGS: Spelling[] = [
  { name: "@pytest.mark.skip", importLine: "import pytest", decorator: "@pytest.mark.skip" },
  { name: "@pt.mark.skip under import pytest as pt", importLine: "import pytest as pt", decorator: "@pt.mark.skip" },
];

/** The decorator is line 5 of the head text, above `def test_adds():` (line 6), which the diff does not show. */
const DECORATOR_LINE = 5;

function headText(s: Spelling): string {
  return `${[
    s.importLine,
    "",
    "from cart import total",
    "",
    s.decorator,
    "def test_adds():",
    "    assert total([2, 3]) == 5",
    "",
    "",
    "def test_empty():",
    "    assert total([]) == 0",
  ].join("\n")}\n`;
}

function diffOf(s: Spelling): string {
  return `${[
    `diff --git a/${OLD} b/${NEW}`,
    "similarity index 95%",
    `rename from ${OLD}`,
    `rename to ${NEW}`,
    "index 1111111..2222222 100644",
    `--- a/${OLD}`,
    `+++ b/${NEW}`,
    "@@ -4,0 +5 @@ from cart import total",
    `+${s.decorator}`,
  ].join("\n")}\n`;
}

describe("CORE-351: a file renamed into a test path is read as an added test file", () => {
  it.each(SPELLINGS)(
    "AC-18: renaming py/cart_checks.py to py/test_cart.py and adding $name above a def test_ line the diff does not show keeps today's block TI03 finding at the decorator line, and the renamed file's tests are counted as added tests of py/test_cart.py",
    async (s) => {
      requirePython();
      const head = headText(s);
      expect(head.split("\n")[DECORATOR_LINE - 1], "the decorator line").toBe(s.decorator);
      expect(head.split("\n")[DECORATOR_LINE], "the def line under it").toBe("def test_adds():");
      // The base side has no text: py/cart_checks.py is not a test file, so the sources reader never selects it.
      const testSources = {
        base: { files: [], dropped: [] },
        head: { files: [{ path: NEW, text: head }], dropped: [] },
      };
      const io = await import("../src/index.js");
      const pythonTestIndex = await io.indexPythonTestSources(testSources);
      expect(pythonTestIndex?.available, "the Python index ran").toBe(true);

      const { check } = await import("../../core/test/text-coverage.js");
      const report = check({
        version: "0.1.0",
        coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
        diff: { text: diffOf(s) },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: null,
        repoFiles: [NEW, "py/cart.py", "src/app.ts"].sort(),
        testIntegrityMode: { input: "block" },
        testSources,
        ...(pythonTestIndex === undefined ? {} : { pythonTestIndex }),
      });
      expectValidReport(report);

      const atDecorator = report.testIntegrity.signals
        .filter((sig) => String(sig.id) === "TI03" && sig.path === NEW && sig.line === DECORATOR_LINE)
        .map((sig) => sig.severity);
      expect(atDecorator, "one TI03 finding at the decorator line, at today's severity").toEqual(["block"]);

      const changes = report.testIntegrity.changes;
      expect(changes?.files, "the tests-changed summary has a row for py/test_cart.py").toEqual([
        { path: NEW, language: "py", added: 2, removed: 0, modified: 0, renamed: 0 },
      ]);
      expect(
        changes?.added.map((t) => [t.path, t.name]),
        "both tests are added tests of py/test_cart.py",
      ).toEqual([
        [NEW, "test_adds"],
        [NEW, "test_empty"],
      ]);
    },
    SLOW,
  );
});
