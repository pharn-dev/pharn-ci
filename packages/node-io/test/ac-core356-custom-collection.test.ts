import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Report } from "../../core/src/report.js";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-356 (AC-2, AC-3). A repository whose pytest.ini sets `python_functions = check_*` (kept for the record as the
// case's pytest.ini.txt, outside base/ and head/, and listed in files.txt) and a modified py/test_cart.py whose
// `def check_empty():` the change does not touch. The case directories are written by the build, so each test first
// checks that the case holds the shape its criterion names. Each case runs through check() in mode block with the real
// Python index; indexPythonTestSources and check() are loaded inside the test body, so nothing the build changes runs
// while the file loads. With no python3 of 3.8 or newer on PATH the test fails with that reason, never skips.

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

interface Case {
  dir: string;
  diff: string;
  base: string;
  head: string;
  files: string[];
  ini: string;
}

function loadCase(dir: string): Case {
  const root = `${FIXTURES}test-integrity/TI03/${dir}/`;
  const read = (p: string) => {
    if (!existsSync(`${root}${p}`)) throw new Error(`the case ${dir} has no ${p}`);
    return readFileSync(`${root}${p}`, "utf8");
  };
  return {
    dir,
    diff: read("change.diff"),
    base: read(`base/${PATH}.txt`),
    head: read(`head/${PATH}.txt`),
    files: read("files.txt")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
    ini: read("pytest.ini.txt"),
  };
}

const linesOf = (text: string) => text.split("\n").map((l) => l.replace(/\r$/, ""));
const diffLines = (diff: string) => linesOf(diff);

/** The shape every custom-collection case shares: the ini, files.txt, and an unchanged `def check_empty():`. */
function checkCommonShape(c: Case): void {
  expect(
    linesOf(c.ini).map((l) => l.trim()),
    `${c.dir}: pytest.ini.txt sets python_functions`,
  ).toContain("python_functions = check_*");
  expect(c.files, `${c.dir}: files.txt lists pytest.ini`).toContain("pytest.ini");
  expect(c.files, `${c.dir}: files.txt lists the test file`).toContain(PATH);
  expect(c.diff, `${c.dir}: the diff modifies ${PATH}`).toContain(`+++ b/${PATH}`);
  expect(c.diff, `${c.dir}: a modified file, not an added one`).not.toContain("new file mode");
  expect(linesOf(c.base), `${c.dir}: base holds def check_empty():`).toContain("def check_empty():");
  expect(linesOf(c.head), `${c.dir}: head holds def check_empty():`).toContain("def check_empty():");
  const touched = diffLines(c.diff).filter((l) => /^[+-]\s*def check_empty\(/.test(l));
  expect(touched, `${c.dir}: the change does not touch def check_empty():`).toEqual([]);
}

/** The 1-based line of the decorator directly above `def check_empty():` in a text, after checking it is there. */
function decoratorLine(text: string, decorator: string, where: string): number {
  const lines = linesOf(text);
  const def = lines.indexOf("def check_empty():");
  expect(lines[def - 1], `${where}: ${decorator} directly above def check_empty():`).toBe(decorator);
  return def;
}

async function run(c: Case): Promise<Report> {
  const sources = {
    base: { files: [{ path: PATH, text: c.base }], dropped: [] },
    head: { files: [{ path: PATH, text: c.head }], dropped: [] },
  };
  const io = await import("../src/index.js");
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, `${c.dir}: the Python index ran`).toBe(true);

  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [...c.files].sort(),
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

describe("CORE-356: an aliased skip above a def that custom pytest collection runs", () => {
  it(
    "AC-2: with python_functions = check_* and import pytest as pt, adding @pt.mark.skip above the unchanged def check_empty(): in mode block gives exactly one TI03 signal, severity block, at the decorator's line, and the verdict fail",
    async () => {
      requirePython();
      const c = loadCase("block-pytest-alias-custom-collection");
      checkCommonShape(c);
      expect(linesOf(c.base)[0], "base starts with import pytest as pt").toBe("import pytest as pt");
      expect(linesOf(c.head)[0], "head starts with import pytest as pt").toBe("import pytest as pt");
      expect(c.base, "base: no skip yet").not.toContain("@pt.mark.skip");
      expect(diffLines(c.diff), "the change adds @pt.mark.skip").toContain("+@pt.mark.skip");
      const line = decoratorLine(c.head, "@pt.mark.skip", `${c.dir} head`);

      const report = await run(c);
      expect(ti03Of(report), "exactly one TI03, block, at the decorator").toEqual([
        { severity: "block", path: PATH, line },
      ]);
      expect(report.verdict, "the verdict").toBe("fail");
    },
    SLOW,
  );

  it(
    "AC-3: the same change under import os as pt, and @pytest.mark.skip respelled @pt.mark.skip under import pytest as pt above the unchanged def check_empty():, give no TI03 signal",
    async () => {
      requirePython();
      const os = loadCase("pass-pytest-alias-custom-collection-os");
      checkCommonShape(os);
      expect(linesOf(os.base)[0], "os: base starts with import os as pt").toBe("import os as pt");
      expect(linesOf(os.head)[0], "os: head starts with import os as pt").toBe("import os as pt");
      expect(os.head, "os: no import pytest as pt").not.toMatch(/^import pytest as pt$/m);
      expect(diffLines(os.diff), "os: the change adds @pt.mark.skip").toContain("+@pt.mark.skip");
      decoratorLine(os.head, "@pt.mark.skip", `${os.dir} head`);

      const respelled = loadCase("pass-pytest-alias-custom-collection-respelled");
      checkCommonShape(respelled);
      expect(linesOf(respelled.head), "respelled: head binds import pytest as pt").toContain("import pytest as pt");
      expect(diffLines(respelled.diff), "respelled: the change removes @pytest.mark.skip").toContain(
        "-@pytest.mark.skip",
      );
      expect(diffLines(respelled.diff), "respelled: the change adds @pt.mark.skip").toContain("+@pt.mark.skip");
      decoratorLine(respelled.base, "@pytest.mark.skip", `${respelled.dir} base`);
      decoratorLine(respelled.head, "@pt.mark.skip", `${respelled.dir} head`);

      expect(ti03Of(await run(os)), "import os as pt: no TI03").toEqual([]);
      expect(ti03Of(await run(respelled)), "respelled: no TI03").toEqual([]);
    },
    SLOW,
  );
});
