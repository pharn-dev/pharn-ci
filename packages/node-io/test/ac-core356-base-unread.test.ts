import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestSourceDrop } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import type { Report } from "../../core/src/report.js";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-356 (AC-6, AC-7). A modified py/test_cart.py whose base side is not indexed while its head is: the base text is
// refused by the Python index as `syntax-error` (a Python 2 `print "x"` statement, case B), or the sources dropped the
// base side as `missing` (case C). The head's skips are then compared against a base with no skip. The opposite drop
// (the head side `missing`, the base text held) keeps the TI03 findings and the verdict of base commit 8c21ebed,
// measured there with the alias reader in place (CORE-351 deletion audit, case "C19 head dropped missing"). The real
// interpreter indexes the held side; indexPythonTestSources and check() are loaded inside the test body, so nothing the
// build changes runs while the file loads. With no python3 of 3.8 or newer on PATH the test fails with that reason,
// never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const PATH = "py/test_cart.py";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
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

interface Side {
  text?: string;
  drop?: TestSourceDrop["reason"];
}

const header = [`diff --git a/${PATH} b/${PATH}`, "index 1111111..2222222 100644", `--- a/${PATH}`, `+++ b/${PATH}`];
const diffOf = (...hunk: string[]) => `${[...header, ...hunk].join("\n")}\n`;

async function run(diff: string, base: Side, head: Side): Promise<Report> {
  const side = (s: Side) => ({
    files: s.text === undefined ? [] : [{ path: PATH, text: s.text }],
    dropped: s.drop === undefined ? [] : [{ path: PATH, reason: s.drop }],
  });
  const sources = { base: side(base), head: side(head) };
  const io = await import("../src/index.js");
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran").toBe(true);

  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diff },
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
const indexMessages = (report: Report) =>
  report.messages.filter((m) => m.code === CODE).map((m) => ({ level: m.level, text: m.text }));

const linesOf = (text: string) => text.split("\n");

// Case B: the base ends in a Python 2 `print "x"` statement the index refuses; the head prints with a call.
const TESTS = `import pytest

from cart import total


def test_total():
    assert total([2, 3]) == 5


def test_empty():
    assert total([]) == 0
`;
const PY2_BASE = `${TESTS}

def legacy():
    print "x"
`;
const PY3_HEAD = `${TESTS}

def legacy():
    print("x")
`;
/** The head with `del test_empty` added at module level (line 18). */
const DEL_HEAD = `${PY3_HEAD}

del test_empty
`;
const PRINT_HUNK = ["@@ -15 +15 @@ def legacy():", '-    print "x"', '+    print("x")'];
const DEL_DIFF = diffOf(
  "@@ -15 +15,4 @@ def legacy():",
  '-    print "x"',
  '+    print("x")',
  "+",
  "+",
  "+del test_empty",
);
const DEL_LINE = 18;

// Case B with an unconditional skip the head keeps on the unchanged def test_total() (the def is line 7).
const SKIPPED = TESTS.replace("def test_total():", "@pytest.mark.skip\ndef test_total():");
const SKIPPED_PY2_BASE = `${SKIPPED}

def legacy():
    print "x"
`;
const SKIPPED_PY3_HEAD = `${SKIPPED}

def legacy():
    print("x")
`;
const SKIPPED_DIFF = diffOf("@@ -16 +16 @@ def legacy():", '-    print "x"', '+    print("x")');
const SKIPPED_DEF_LINE = 7;

// Case C, base side missing: the head is TESTS with `del test_empty` added at module level (line 14).
const C_HEAD = `${TESTS}

del test_empty
`;
const C_DIFF = diffOf("@@ -11,0 +12,3 @@ def test_empty():", "+", "+", "+del test_empty");
const C_DEL_LINE = 14;

// Case C, head side missing: an aliased skip added (line 6) above the unchanged def test_total() under import pytest
// as pt. At base commit 8c21ebed: verdict fail, one TI03, block, at line 6.
const ALIASED = TESTS.replace("import pytest\n", "import pytest as pt\n");
const ALIASED_HEAD = ALIASED.replace("def test_total():", "@pt.mark.skip\ndef test_total():");
const ALIASED_DIFF = diffOf("@@ -5,0 +6 @@ from cart import total", "+@pt.mark.skip");
const HEAD_MISSING_AT_8C21EBED = { verdict: "fail", ti03: [{ severity: "block", path: PATH, line: 6 }] };

describe("CORE-356: a Python test file whose base side the index did not read compares the head against a base with no skip", () => {
  it(
    "AC-6: with the base refused as syntax-error and the head indexed, an added del test_empty gives a block TI03 at its line, the TEST_INTEGRITY_INDEX_UNAVAILABLE message stays warn and the verdict is fail; an unconditional skip the head keeps on an unchanged test gives a block TI03 at its def line; and a head with no skip gives no TI03 and the verdict warn",
    async () => {
      requirePython();
      // The inputs hold what the criterion names.
      expect(linesOf(DEL_HEAD)[DEL_LINE - 1], "the del line").toBe("del test_empty");
      expect(linesOf(SKIPPED_PY3_HEAD)[SKIPPED_DEF_LINE - 2], "the kept skip").toBe("@pytest.mark.skip");
      expect(linesOf(SKIPPED_PY3_HEAD)[SKIPPED_DEF_LINE - 1], "its def").toBe("def test_total():");
      expect(linesOf(SKIPPED_PY2_BASE)[15], "the Python 2 print in the skipped base").toBe('    print "x"');
      expect(linesOf(PY2_BASE)[14], "the Python 2 print in the base").toBe('    print "x"');

      const deleted = await run(DEL_DIFF, { text: PY2_BASE }, { text: DEL_HEAD });
      const delMessages = indexMessages(deleted);
      expect(delMessages, "one index-unavailable message").toHaveLength(1);
      expect(delMessages[0]?.text, "it names the file and the base's refusal").toContain(
        `\`${PATH}\` (\`syntax-error\`)`,
      );
      expect(delMessages[0]?.level, "it stays a warning").toBe("warn");
      expect(ti03Of(deleted), "a block TI03 at the del line").toContainEqual({
        severity: "block",
        path: PATH,
        line: DEL_LINE,
      });
      expect(deleted.verdict, "del test_empty: the verdict").toBe("fail");

      const kept = await run(SKIPPED_DIFF, { text: SKIPPED_PY2_BASE }, { text: SKIPPED_PY3_HEAD });
      expect(ti03Of(kept), "a block TI03 at the kept skip's def line").toContainEqual({
        severity: "block",
        path: PATH,
        line: SKIPPED_DEF_LINE,
      });

      const none = await run(diffOf(...PRINT_HUNK), { text: PY2_BASE }, { text: PY3_HEAD });
      expect(ti03Of(none), "no skip at head: no TI03").toEqual([]);
      expect(
        indexMessages(none).map((m) => m.level),
        "the index-unavailable warning",
      ).toEqual(["warn"]);
      expect(none.verdict, "no skip at head: the verdict").toBe("warn");
    },
    SLOW,
  );

  it(
    "AC-7: with the base side dropped as missing and the head held and indexed, an added del test_empty gives a block TI03 at its line; with the head side dropped as missing and the base held, an aliased skip added above an unchanged test gives the TI03 signals and the verdict of base commit 8c21ebed",
    async () => {
      requirePython();
      expect(linesOf(C_HEAD)[C_DEL_LINE - 1], "the del line").toBe("del test_empty");
      expect(linesOf(ALIASED_HEAD)[5], "the aliased decorator at line 6").toBe("@pt.mark.skip");
      expect(linesOf(ALIASED_HEAD)[6], "above the unchanged def").toBe("def test_total():");

      const baseMissing = await run(C_DIFF, { drop: "missing" }, { text: C_HEAD });
      expect(ti03Of(baseMissing), "base missing: a block TI03 at the del line").toContainEqual({
        severity: "block",
        path: PATH,
        line: C_DEL_LINE,
      });

      const headMissing = await run(ALIASED_DIFF, { text: ALIASED }, { drop: "missing" });
      expect(
        { verdict: headMissing.verdict, ti03: ti03Of(headMissing) },
        "head missing: the TI03 signals and verdict of base commit 8c21ebed",
      ).toEqual(HEAD_MISSING_AT_8C21EBED);
    },
    SLOW,
  );
});
