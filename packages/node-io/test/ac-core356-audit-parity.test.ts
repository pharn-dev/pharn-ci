import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PythonIndexFile, TestSourceDrop } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-356 (AC-1). The CORE-351 deletion audit, pinned: every TI03 fixture case whose diff touches py/test_cart.py at
// base commit 8c21ebed (30 directories, listed here, not read from the directory, because the build adds new ones),
// and the constructed cases C1 to C22 of that audit, built here the same way the audit built them (a `-U0` diff of
// base to head made by `git diff --no-index`). Each runs through check() in mode block with the real Python index.
// The verdict and the TI03 signals (severity and line) of each case are literals measured at 8c21ebed, with the
// hand-written alias reader (packages/core/src/signals/pythonAliases.ts) in place. Since the build moves alias
// resolution into the Python index, the test also requires the index entry of each constructed case's held text to
// carry the alias pair the case's imports bind (only the build makes that true). indexPythonTestSources and check()
// are loaded inside the test body, so nothing the build changes runs while the file loads. With no python3 of 3.8 or
// newer on PATH the test fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const TI03 = `${FIXTURES}test-integrity/TI03/`;
const PATH = "py/test_cart.py";
const SLOW = 600_000;

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

interface Side {
  text?: string;
  drop?: TestSourceDrop["reason"];
}
interface Case {
  label: string;
  diff: string;
  path: string;
  basePath?: string;
  base: Side;
  head: Side;
  /** The alias pair the held text's imports bind, which the index entry must carry (constructed cases only). */
  alias?: [string, string];
}

/** A `-U0` diff of base to head with the given paths in its headers, made by `git diff --no-index` on temp files. */
function makeDiff(baseText: string, headText: string, path: string, oldPath = path): string {
  const dir = mkdtempSync(join(tmpdir(), "pharn-core356-audit-"));
  try {
    const a = join(dir, "a");
    const b = join(dir, "b");
    writeFileSync(a, baseText);
    writeFileSync(b, headText);
    const run = spawnSync(
      "git",
      ["-c", "core.quotePath=false", "diff", "--no-index", "--no-color", "--no-ext-diff", "-U0", a, b],
      { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } },
    );
    if (run.status !== 1) throw new Error(`git diff --no-index failed: ${run.status} ${run.stderr}`);
    const body = run.stdout.slice(run.stdout.indexOf("\n@@") + 1);
    if (oldPath !== path) {
      return `diff --git a/${oldPath} b/${path}\nsimilarity index 90%\nrename from ${oldPath}\nrename to ${path}\nindex 1111111..2222222 100644\n--- a/${oldPath}\n+++ b/${path}\n${body}`;
    }
    return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${body}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ALIASED = `import pytest as pt

from cart import total


def test_total():
    assert total([2, 3]) == 5


def test_empty():
    assert total([]) == 0
`;
const insertAt = (text: string, lineNo: number, add: string) => {
  const lines = text.split("\n");
  lines.splice(lineNo - 1, 0, add);
  return lines.join("\n");
};
const PT: [string, string] = ["pt", "pytest"];

/** The constructed cases C1 to C22 of the CORE-351 deletion audit, in its order. */
function constructed(): Case[] {
  const out: Case[] = [];
  const pair = (
    label: string,
    base: string,
    head: string,
    alias: [string, string],
    sides?: { base?: Side; head?: Side },
  ) =>
    out.push({
      label,
      diff: makeDiff(base, head, PATH),
      path: PATH,
      base: sides?.base ?? { text: base },
      head: sides?.head ?? { text: head },
      alias,
    });
  const lineOf = (text: string, line: string) => text.split("\n").indexOf(line) + 1;

  pair("C1 alias skip on existing test", ALIASED, insertAt(ALIASED, 6, "@pt.mark.skip"), PT);
  {
    const base = ALIASED.replace("def test_empty", "def check_empty");
    pair("C2 alias skip on non-default-collected def check_*", base, insertAt(base, 10, "@pt.mark.skip"), PT);
  }
  {
    const base = `${ALIASED}\n\ndef helper():\n    return 1\n`;
    pair("C3 alias skip on helper def", base, insertAt(base, lineOf(base, "def helper():"), "@pt.mark.skip"), PT);
  }
  {
    const base = `${ALIASED}\n\nclass Checks:\n    def test_inner(self):\n        assert total([1]) == 1\n`;
    const at = lineOf(base, "    def test_inner(self):");
    pair("C4 alias skip on method of non-Test class", base, insertAt(base, at, "    @pt.mark.skip"), PT);
  }
  {
    const base = ALIASED.replace(
      "    assert total([2, 3]) == 5",
      "    def inner():\n        return 5\n    assert total([2, 3]) == inner()",
    );
    pair("C5 alias skip on nested def in test body", base, insertAt(base, 7, "    @pt.mark.skip"), PT);
  }
  {
    const base = insertAt(ALIASED, 6, "@pytest.mark.skip").replace(
      "import pytest as pt",
      "import pytest\nimport pytest as pt",
    );
    const at = lineOf(base, "@pytest.mark.skip");
    pair("C6 alias xfail added to an already-skipped test", base, insertAt(base, at, "@pt.mark.xfail"), PT);
  }
  pair("C7 module pytestmark alias, existing tests", ALIASED, insertAt(ALIASED, 4, "pytestmark = pt.mark.skip"), PT);
  {
    const base = "import pytest as pt\n\n\ndef helper():\n    return 1\n";
    pair("C8 module pytestmark alias, no tests", base, insertAt(base, 3, "pytestmark = pt.mark.skip"), PT);
  }
  {
    const head = insertAt(
      ALIASED.replace("test_total", "test_sum").replace("test_empty", "test_none"),
      4,
      "pytestmark = pt.mark.skip",
    );
    pair("C9 module pytestmark alias, all tests renamed", ALIASED, head, PT);
  }
  {
    const base = `import pytest as pt\n\nfrom cart import total\n\n\nclass TestCart:\n    def test_total(self):\n        assert total([2, 3]) == 5\n`;
    pair("C10 alias skip on existing Test class", base, insertAt(base, 6, "@pt.mark.skip"), PT);
  }
  {
    const base = ALIASED.replace("import pytest as pt", "from pytest import mark as m");
    pair("C11 from pytest import mark as m", base, insertAt(base, 6, "@m.skip"), ["m", "pytest.mark"]);
    const ub = ALIASED.replace("import pytest as pt", "from unittest import skip as sk, expectedFailure as ef");
    pair("C12 unittest skip alias", ub, insertAt(ub, 6, '@sk("r")'), ["sk", "unittest.skip"]);
    pair("C13 unittest expectedFailure alias", ub, insertAt(ub, 6, "@ef"), ["ef", "unittest.expectedFailure"]);
  }
  pair("C14 pt.skip( in a test body", ALIASED, insertAt(ALIASED, 7, '    pt.skip("r")'), PT);
  {
    const base = `${ALIASED}\n\ndef helper():\n    return 1\n`;
    pair(
      "C15 pt.skip( in a helper body",
      base,
      insertAt(base, lineOf(base, "def helper():") + 1, '    pt.skip("r")'),
      PT,
    );
  }
  {
    const base = insertAt(ALIASED, 6, "@pt.mark.skipif(A)");
    pair("C16 alias skipif added next to an existing skipif", base, insertAt(base, 6, "@pt.mark.skipif(B)"), PT);
  }
  pair(
    "C17 alias skip on NEW test (accepted)",
    ALIASED,
    `${ALIASED}\n\n@pt.mark.skip\ndef test_new():\n    assert True\n`,
    PT,
  );
  {
    const base = `${ALIASED}\n\ndef old():\n    print "x"\n`;
    const head = insertAt(base.replace('print "x"', 'print("x")'), 6, "@pt.mark.skip");
    pair("C18 base syntax-error (indexer), head indexes", base, head, PT);
  }
  for (const drop of ["missing", "unsafe-path"] as const) {
    const head = insertAt(ALIASED, 6, "@pt.mark.skip");
    pair(`C19 base dropped ${drop}, head text`, ALIASED, head, PT, { base: { drop } });
    pair(`C19 head dropped ${drop}, base text`, ALIASED, head, PT, { head: { drop } });
  }
  for (const drop of ["over-total-cap", "over-file-cap", "too-large", "binary"] as const) {
    const head = insertAt(ALIASED, 6, "@pt.mark.skip");
    pair(`C20 base dropped ${drop}, head text`, ALIASED, head, PT, { base: { drop } });
    pair(`C20 head dropped ${drop}, base text`, ALIASED, head, PT, { head: { drop } });
  }
  {
    const head = insertAt(ALIASED, 6, "@pt.mark.skip");
    out.push({
      label: "C21 renamed non-test path -> test path",
      diff: makeDiff(ALIASED, head, PATH, "py/cart_checks.py"),
      path: PATH,
      basePath: "py/cart_checks.py",
      base: {},
      head: { text: head },
      alias: PT,
    });
  }
  {
    const head = insertAt(ALIASED, 6, "@pt.mark.skip");
    out.push({
      label: "C22 renamed test path -> test path",
      diff: makeDiff(ALIASED, head, PATH, "py/test_old_cart.py"),
      path: PATH,
      basePath: "py/test_old_cart.py",
      base: { text: ALIASED },
      head: { text: head },
      alias: PT,
    });
  }
  return out;
}

/** The 30 TI03 fixture directories whose diff touches py/test_cart.py at base commit 8c21ebed. */
const FIXTURE_DIRS = [
  "block-pytest-alias-group-skip",
  "block-pytest-alias-group-skip-literal",
  "block-pytest-alias-pt-skip",
  "block-pytest-alias-pt-skip-literal",
  "block-pytest-alias-rebound",
  "block-pytest-shadow-mark",
  "block-pytest-shadow-module",
  "block-unittest-alias-from",
  "block-unittest-alias-from-literal",
  "block-unittest-alias-module",
  "block-unittest-alias-module-literal",
  "block-unittest-expected-failure",
  "pass-pytest-alias-assignment",
  "pass-pytest-alias-docstring",
  "pass-pytest-alias-in-function",
  "pass-pytest-alias-in-if",
  "pass-pytest-alias-in-try",
  "pass-pytest-alias-other-module",
  "pass-pytest-alias-replaced",
  "pass-pytest-alias-respelled",
  "pass-pytest-alias-star",
  "warn-pytest-alias-m-xfail",
  "warn-pytest-alias-m-xfail-literal",
  "warn-pytest-alias-mark-skipif",
  "warn-pytest-alias-mark-skipif-literal",
  "warn-pytest-alias-pt-skipif",
  "warn-pytest-alias-pt-skipif-literal",
  "warn-pytest-alias-skip-xfail-calls",
  "warn-pytest-xfail-call",
  "warn-unittest-expected-failure-new-test",
];

function fixtureCase(name: string): Case {
  const root = `${TI03}${name}/`;
  const basePath = `${root}base/${PATH}.txt`;
  return {
    label: `F ${name}`,
    diff: readFileSync(`${root}change.diff`, "utf8"),
    path: PATH,
    base: existsSync(basePath) ? { text: readFileSync(basePath, "utf8") } : {},
    head: { text: readFileSync(`${root}head/${PATH}.txt`, "utf8") },
  };
}

/**
 * Each case's verdict and TI03 signals as `severity@line`, measured at base commit 8c21ebed (python3 3.13.2) with
 * pythonAliases.ts in place: check() in mode block, threshold null, the real Python index over the held texts.
 */
const EXPECTED: Record<string, string> = {
  "F block-pytest-alias-group-skip": "fail block@9",
  "F block-pytest-alias-group-skip-literal": "fail block@9",
  "F block-pytest-alias-pt-skip": "fail block@6",
  "F block-pytest-alias-pt-skip-literal": "fail block@6",
  "F block-pytest-alias-rebound": "fail block@7",
  "F block-pytest-shadow-mark": "fail block@6",
  "F block-pytest-shadow-module": "fail block@6",
  "F block-unittest-alias-from": "fail block@9,warn@13,warn@17,block@21",
  "F block-unittest-alias-from-literal": "fail block@9,warn@13,warn@17,block@21",
  "F block-unittest-alias-module": "fail block@10",
  "F block-unittest-alias-module-literal": "fail block@10",
  "F block-unittest-expected-failure": "fail block@10",
  "F pass-pytest-alias-assignment": "warn ",
  "F pass-pytest-alias-docstring": "warn ",
  "F pass-pytest-alias-in-function": "warn ",
  "F pass-pytest-alias-in-if": "warn ",
  "F pass-pytest-alias-in-try": "warn ",
  "F pass-pytest-alias-other-module": "warn ",
  "F pass-pytest-alias-replaced": "warn ",
  "F pass-pytest-alias-respelled": "warn ",
  "F pass-pytest-alias-star": "warn ",
  "F warn-pytest-alias-m-xfail": "warn warn@7",
  "F warn-pytest-alias-m-xfail-literal": "warn warn@7",
  "F warn-pytest-alias-mark-skipif": "warn warn@7",
  "F warn-pytest-alias-mark-skipif-literal": "warn warn@7",
  "F warn-pytest-alias-pt-skipif": "warn warn@7",
  "F warn-pytest-alias-pt-skipif-literal": "warn warn@7",
  "F warn-pytest-alias-skip-xfail-calls": "fail block@7,block@12",
  "F warn-pytest-xfail-call": "fail block@7",
  "F warn-unittest-expected-failure-new-test": "warn warn@12",
  "C1 alias skip on existing test": "fail block@6",
  "C2 alias skip on non-default-collected def check_*": "fail block@10",
  "C3 alias skip on helper def": "fail block@14",
  "C4 alias skip on method of non-Test class": "fail block@15",
  "C5 alias skip on nested def in test body": "fail block@7",
  "C6 alias xfail added to an already-skipped test": "fail block@7",
  "C7 module pytestmark alias, existing tests": "fail block@4",
  "C8 module pytestmark alias, no tests": "fail block@3",
  "C9 module pytestmark alias, all tests renamed": "fail block@4,block@7,block@11",
  "C10 alias skip on existing Test class": "fail block@6",
  "C11 from pytest import mark as m": "fail block@6",
  "C12 unittest skip alias": "fail block@6",
  "C13 unittest expectedFailure alias": "fail block@6",
  "C14 pt.skip( in a test body": "fail block@7",
  "C15 pt.skip( in a helper body": "warn warn@15",
  "C16 alias skipif added next to an existing skipif": "warn warn@6",
  "C17 alias skip on NEW test (accepted)": "warn warn@14",
  "C18 base syntax-error (indexer), head indexes": "fail block@6",
  "C19 base dropped missing, head text": "fail block@6",
  "C19 head dropped missing, base text": "fail block@6",
  "C19 base dropped unsafe-path, head text": "fail block@6",
  "C19 head dropped unsafe-path, base text": "fail block@6",
  "C20 base dropped over-total-cap, head text": "fail block@6",
  "C20 head dropped over-total-cap, base text": "fail block@6",
  "C20 base dropped over-file-cap, head text": "fail block@6",
  "C20 head dropped over-file-cap, base text": "fail block@6",
  "C20 base dropped too-large, head text": "fail block@6",
  "C20 head dropped too-large, base text": "fail block@6",
  "C20 base dropped binary, head text": "fail block@6",
  "C20 head dropped binary, base text": "fail block@6",
  "C21 renamed non-test path -> test path": "fail block@6",
  "C22 renamed test path -> test path": "fail block@6",
};

const SEVERITY_ORDER = ["block", "warn"];

/** Runs one case in mode block with the real Python index; gives its line for the table and the index's entries. */
async function run(c: Case): Promise<{ row: string; base: PythonIndexFile[]; head: PythonIndexFile[] }> {
  const io = await import("../src/index.js");
  const basePath = c.basePath ?? c.path;
  const side = (p: string, s: Side) => ({
    files: s.text === undefined ? [] : [{ path: p, text: s.text }],
    dropped: s.drop === undefined ? [] : [{ path: p, reason: s.drop }],
  });
  const testSources = { base: side(basePath, c.base), head: side(c.path, c.head) };
  const pythonTestIndex = await io.indexPythonTestSources(testSources);
  if (pythonTestIndex === undefined || !pythonTestIndex.available) {
    throw new Error(`${c.label}: the Python index did not run (${JSON.stringify(pythonTestIndex)})`);
  }

  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [c.path, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources,
    pythonTestIndex,
  });
  expectValidReport(report);
  const ti03 = report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map((s) => ({ severity: s.severity, line: s.line ?? 0 }))
    .sort((a, b) => a.line - b.line || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
    .map((s) => `${s.severity}@${s.line}`)
    .join(",");
  return { row: `${report.verdict} ${ti03}`, base: pythonTestIndex.base, head: pythonTestIndex.head };
}

/** The alias pairs an index entry carries, or undefined when it carries none. */
function aliasesOf(file: PythonIndexFile | undefined): unknown {
  if (file === undefined) return undefined;
  return "aliases" in file ? file.aliases : undefined;
}

describe("CORE-356: TI03 on Python keeps every verdict the CORE-351 deletion audit pinned, with aliases from the index", () => {
  it(
    "AC-1: every TI03 fixture case touching py/test_cart.py and every constructed case C1 to C22 gives, in mode block with the real Python index, the verdict and the TI03 severities and lines of base commit 8c21ebed, and the index entry of each constructed case's held text carries the alias pair its imports bind",
    async () => {
      requirePython();
      const cases = [...FIXTURE_DIRS.map(fixtureCase), ...constructed()];
      expect(cases.map((c) => c.label).sort(), "the pinned case list").toEqual(Object.keys(EXPECTED).sort());

      const measured: Record<string, string> = {};
      const missingAliases: string[] = [];
      for (const c of cases) {
        const { row, base, head } = await run(c);
        measured[c.label] = row;
        if (c.alias === undefined) continue;
        // The entry of the side whose text the sources held and the index parsed: the head, else the base.
        const headEntry = head.find((f) => f.path === c.path);
        const baseEntry = base.find((f) => f.path === (c.basePath ?? c.path));
        const entry = headEntry?.result.parsed ? headEntry : baseEntry;
        const pairs = aliasesOf(entry);
        const has =
          Array.isArray(pairs) && pairs.some((p) => Array.isArray(p) && p[0] === c.alias?.[0] && p[1] === c.alias?.[1]);
        if (!has) missingAliases.push(`${c.label}: ${JSON.stringify(c.alias)} not in ${JSON.stringify(pairs)}`);
      }

      expect(measured, "each case's verdict and TI03 signals equal those of base commit 8c21ebed").toEqual(EXPECTED);
      expect(missingAliases, "the index entry carries the alias pair the case's imports bind").toEqual([]);
    },
    SLOW,
  );
});
