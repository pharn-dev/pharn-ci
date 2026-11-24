import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Report } from "../../core/src/report.js";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-356 (AC-4, AC-5). Aliased skips in an added py/test_cart.py, on a new test in a modified one, and in a file
// renamed from a non-test path into py/test_cart.py, decided with the real Python index in mode block. The added-file
// case directories are written by the build, so each test first checks that the case holds the shape its criterion
// names; the modified and renamed cases are inline. indexPythonTestSources and check() are loaded inside the test body,
// so nothing the build changes runs while the file loads. With no python3 of 3.8 or newer on PATH the test fails with
// that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const PATH = "py/test_cart.py";
const SLOW = 120_000;

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

const linesOf = (text: string) => text.split("\n").map((l) => l.replace(/\r$/, ""));

interface Input {
  diff: string;
  /** The base text, at `basePath` (default PATH); none for an added file or a rename from a non-test path. */
  base?: string;
  head: string;
}

/** An added-file case directory: its diff (a new file) and its head text; it has no base side. */
function loadAdded(dir: string): Input & { dir: string } {
  const root = `${FIXTURES}test-integrity/TI03/${dir}/`;
  const read = (p: string) => {
    if (!existsSync(`${root}${p}`)) throw new Error(`the case ${dir} has no ${p}`);
    return readFileSync(`${root}${p}`, "utf8");
  };
  const c = { dir, diff: read("change.diff"), head: read(`head/${PATH}.txt`) };
  expect(existsSync(`${root}base/${PATH}.txt`), `${dir}: no base text (an added file)`).toBe(false);
  expect(c.diff, `${dir}: the diff adds ${PATH}`).toContain(`+++ b/${PATH}`);
  expect(c.diff, `${dir}: the diff is a new file`).toContain("new file mode");
  expect(c.diff, `${dir}: from /dev/null`).toContain("--- /dev/null");
  return c;
}

async function run(input: Input): Promise<Report> {
  const sources = {
    base: { files: input.base === undefined ? [] : [{ path: PATH, text: input.base }], dropped: [] },
    head: { files: [{ path: PATH, text: input.head }], dropped: [] },
  };
  const io = await import("../src/index.js");
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran").toBe(true);

  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources: sources,
    ...(pythonTestIndex === undefined ? {} : { pythonTestIndex }),
  });
  expectValidReport(report);
  return report;
}

const ti03Of = (report: Report) =>
  report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map((s) => ({ severity: s.severity, path: s.path, line: s.line }));

const ALIASED = `import pytest as pt

from cart import total


def test_total():
    assert total([2, 3]) == 5


def test_empty():
    assert total([]) == 0
`;

/** A new `def test_new():` under an added `@pt.mark.skip`, appended to the modified file: the decorator is line 14. */
const NEW_TEST: Input & { line: number } = {
  base: ALIASED,
  head: `${ALIASED}\n\n@pt.mark.skip\ndef test_new():\n    assert True\n`,
  diff: `${[
    `diff --git a/${PATH} b/${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${PATH}`,
    `+++ b/${PATH}`,
    "@@ -11,0 +12,5 @@ def test_empty():",
    "+",
    "+",
    "+@pt.mark.skip",
    "+def test_new():",
    "+    assert True",
  ].join("\n")}\n`,
  line: 14,
};

/** py/cart_checks.py renamed to py/test_cart.py, adding `@pt.mark.skip` (line 6) above the unchanged `def test_total():`. */
const OLD = "py/cart_checks.py";
const RENAMED: Input & { line: number } = {
  head: `import pytest as pt

from cart import total


@pt.mark.skip
def test_total():
    assert total([2, 3]) == 5


def test_empty():
    assert total([]) == 0
`,
  diff: `${[
    `diff --git a/${OLD} b/${PATH}`,
    "similarity index 90%",
    `rename from ${OLD}`,
    `rename to ${PATH}`,
    "index 1111111..2222222 100644",
    `--- a/${OLD}`,
    `+++ b/${PATH}`,
    "@@ -5,0 +6 @@ from cart import total",
    "+@pt.mark.skip",
  ].join("\n")}\n`,
  line: 6,
};

describe("CORE-356: aliased skips in added, new and renamed-in Python tests, decided with the Python index", () => {
  it(
    "AC-4: an added py/test_cart.py under import pytest as pt with @pt.mark.skip above def test_total(): gives exactly one warn TI03 at the decorator's line; a new def test_new(): under an added @pt.mark.skip in a modified file gives exactly one warn TI03 there; and a file renamed from a non-test path into py/test_cart.py with @pt.mark.skip added above an unchanged test gives exactly one block TI03 there",
    async () => {
      requirePython();
      const added = loadAdded("warn-pytest-alias-added-file");
      const lines = linesOf(added.head);
      expect(lines[0], "the added file starts with import pytest as pt").toBe("import pytest as pt");
      const def = lines.indexOf("def test_total():");
      expect(def, "the added file holds def test_total():").toBeGreaterThan(0);
      expect(lines[def - 1], "@pt.mark.skip directly above def test_total():").toBe("@pt.mark.skip");
      expect(
        lines.filter((l) => l.includes("skip") || l.includes("xfail")),
        "the only skip in the added file",
      ).toEqual(["@pt.mark.skip"]);
      expect(ti03Of(await run(added)), "added file: exactly one warn TI03 at the decorator").toEqual([
        { severity: "warn", path: PATH, line: def },
      ]);

      expect(linesOf(NEW_TEST.head)[NEW_TEST.line - 1], "the new test's decorator line").toBe("@pt.mark.skip");
      expect(linesOf(NEW_TEST.head)[NEW_TEST.line], "the new def under it").toBe("def test_new():");
      expect(ti03Of(await run(NEW_TEST)), "new test: exactly one warn TI03 at the decorator").toEqual([
        { severity: "warn", path: PATH, line: NEW_TEST.line },
      ]);

      expect(linesOf(RENAMED.head)[RENAMED.line - 1], "the renamed file's decorator line").toBe("@pt.mark.skip");
      expect(linesOf(RENAMED.head)[RENAMED.line], "the unchanged def under it").toBe("def test_total():");
      expect(ti03Of(await run(RENAMED)), "renamed-in: exactly one block TI03 at the decorator").toEqual([
        { severity: "block", path: PATH, line: RENAMED.line },
      ]);
    },
    SLOW,
  );

  it(
    "AC-5: an added py/test_cart.py that binds import os as pt and carries @pt.mark.skip above a test, and one that binds import pytest as pt and carries no skip, give no TI03 signal in mode block",
    async () => {
      requirePython();
      const os = loadAdded("pass-pytest-alias-added-file-os");
      const osLines = linesOf(os.head);
      expect(osLines[0], "os: the added file starts with import os as pt").toBe("import os as pt");
      expect(os.head, "os: no import pytest as pt").not.toMatch(/^import pytest as pt$/m);
      const decorated = osLines.findIndex(
        (l, i) => l === "@pt.mark.skip" && /^def test_\w+\(/.test(osLines[i + 1] ?? ""),
      );
      expect(decorated, "os: @pt.mark.skip directly above a def test_").toBeGreaterThanOrEqual(0);

      const noSkip = loadAdded("pass-pytest-alias-added-file-no-skip");
      expect(linesOf(noSkip.head)[0], "no-skip: the added file starts with import pytest as pt").toBe(
        "import pytest as pt",
      );
      expect(noSkip.head, "no-skip: no skip, xfail or pytestmark").not.toMatch(
        /skip|xfail|pytestmark|expectedFailure/i,
      );
      expect(noSkip.head, "no-skip: it holds a test").toMatch(/^def test_\w+\(/m);

      expect(ti03Of(await run(os)), "import os as pt: no TI03").toEqual([]);
      expect(ti03Of(await run(noSkip)), "no skip: no TI03").toEqual([]);
    },
    SLOW,
  );
});
