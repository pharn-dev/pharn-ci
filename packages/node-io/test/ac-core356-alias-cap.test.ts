import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Report } from "../../core/src/report.js";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-356 (grill G1-1). The Python index reports a file's top-level import bindings into pytest or unittest as
// `aliases`, and TI03 resolves aliased skip spellings with them. A file with more than 1000 such bindings, or one whose
// kept name or target is longer than 500 characters, is refused as `too-large` instead of having bindings dropped, so
// a pull request cannot pad a test file to hide an aliased skip above a def pytest does not collect by default:
// CORE-351's head rule makes the refusal an error in mode block. Bindings into any other module are not kept, so
// padding with them changes nothing. The real interpreter runs; with no python3 of 3.8 or newer on PATH the test fails
// with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const PATH = "py/test_cart.py";
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const SLOW = 120_000;

const PYTHON = (() => {
  const run = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 8), sys.version.split()[0])"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  const [ok, version] = (run.stdout ?? "").trim().split(" ");
  return { ok: run.status === 0 && ok === "True", version: version ?? "", error: run.error?.message ?? "" };
})();

function requirePython(): void {
  if (!PYTHON.ok) {
    throw new Error(
      `this test needs python3 3.8 or newer on PATH and found ${PYTHON.version === "" ? `none (${PYTHON.error || "python3 did not run"})` : `python3 ${PYTHON.version}`}`,
    );
  }
}

/** A `-U0` diff of base to head for PATH (git diff --no-index on temporary files). */
function diffOf(base: string, head: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pharn-core356-cap-"));
  writeFileSync(join(dir, "a"), base);
  writeFileSync(join(dir, "b"), head);
  let out = "";
  try {
    out = execFileSync(
      "git",
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "-U0", join(dir, "a"), join(dir, "b")],
      { encoding: "utf8" },
    );
  } catch (error) {
    out = (error as { stdout: string }).stdout;
  }
  const body = out.slice(out.indexOf("\n@@") + 1);
  return `diff --git a/${PATH} b/${PATH}\nindex 1111111..2222222 100644\n--- a/${PATH}\n+++ b/${PATH}\n${body}`;
}

async function run(base: string, head: string): Promise<Report> {
  const sources = {
    base: { files: [{ path: PATH, text: base }], dropped: [] },
    head: { files: [{ path: PATH, text: head }], dropped: [] },
  };
  const io = await import("../src/index.js");
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran").toBe(true);
  const { check } = await import("../../core/test/text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: diffOf(base, head) },
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

/** A test file whose `check_empty` is a def pytest does not collect by default; the skip goes on line 10. */
const BASE = `import pytest as pt

from cart import total


def test_total():
    assert total([2, 3]) == 5


def check_empty():
    assert total([]) == 0
`;
const SKIP_LINE = 10;
const withSkip = (text: string) => text.replace("def check_empty():", "@pt.mark.skip\ndef check_empty():");
/** `count` top-level imports appended after the tests, so the skip keeps its line. */
const padded = (text: string, count: number, line: (n: number) => string) =>
  `${text}\n${Array.from({ length: count }, (_, n) => line(n)).join("\n")}\n`;

describe("CORE-356: the index's alias bindings fail closed past their cap", () => {
  it(
    "G1-1: a head padded with 1001 more pytest aliases is refused as too-large and the run fails with the file named; 1001 non-pytest imports change nothing; one over-long alias name is refused too",
    async () => {
      requirePython();

      // The reference: the aliased skip above the uncollected def is one block TI03 at its line.
      const plain = await run(BASE, withSkip(BASE));
      expect(ti03Of(plain), "unpadded: one block TI03 at the decorator").toEqual([
        { severity: "block", path: PATH, line: SKIP_LINE },
      ]);
      expect(indexMessages(plain), "unpadded: the file was indexed").toEqual([]);

      // 1. The head gains 1001 pytest aliases: the index refuses it, and mode block fails with the file named.
      const pytestPadded = await run(
        BASE,
        padded(withSkip(BASE), 1001, (n) => `import pytest as p${n}`),
      );
      expect(pytestPadded.verdict, "pytest-padded head: the run fails").toBe("fail");
      const pytestMessages = indexMessages(pytestPadded);
      expect(pytestMessages.length, "one index-unavailable message").toBe(1);
      expect(pytestMessages[0]?.level, "an error in mode block").toBe("error");
      expect(pytestMessages[0]?.text, "names the file").toContain(PATH);
      expect(pytestMessages[0]?.text, "with the reason too-large").toContain("too-large");

      // 2. The head gains 1001 imports of other modules: nothing is refused, and TI03 is what it was unpadded.
      const otherPadded = await run(
        BASE,
        padded(withSkip(BASE), 1001, (n) => `import os as o${n}`),
      );
      expect(indexMessages(otherPadded), "other-padded head: no index message").toEqual([]);
      expect(ti03Of(otherPadded), "other-padded head: the same TI03 as unpadded").toEqual(ti03Of(plain));
      expect(otherPadded.verdict).toBe(plain.verdict);

      // 3. One pytest alias whose local name is longer than 500 characters: the file is refused, never cut.
      const io = await import("../src/index.js");
      const long = `import pytest as ${"a".repeat(501)}\n\n\ndef test_total():\n    assert True\n`;
      const refused = await io.indexPythonTests([{ path: PATH, text: long }]);
      if (!refused.available) throw new Error(`the Python index is unavailable: ${refused.reason}`);
      expect(refused.files[0]?.result, "an over-long alias name: refused as too-large").toEqual({
        parsed: false,
        reason: "too-large",
      });
      const ok = await io.indexPythonTests([{ path: PATH, text: `import pytest as ${"a".repeat(500)}\n` }]);
      if (!ok.available) throw new Error(`the Python index is unavailable: ${ok.reason}`);
      expect(ok.files[0]?.result.parsed, "a 500-character alias name: indexed").toBe(true);
    },
    SLOW,
  );
});
