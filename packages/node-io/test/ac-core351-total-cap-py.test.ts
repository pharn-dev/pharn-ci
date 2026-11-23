import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TestSourceDrop, TestSourceObject } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// CORE-351 (AC-12), the regression the ticket names, for Python: a pull request that modifies enough large `.py` test
// files pushes one of them past the 16 MiB running total of the sources reader, and removes a test from that one. The
// read plan is computed from object sizes (no 16 MiB input is built or committed): 34 modified test files of 500,000
// bytes each on the head side, so the 34th in path order (tests/test_33.py) is dropped as over-total-cap while its
// base side (files of 400,000 bytes) is read. The texts the plan keeps are small stand-ins, indexed by node-io with the
// real python3; then check() runs. planTestSourceReads, indexPythonTestSources and check() are loaded inside the test
// body: the AC test is written before the build, so nothing the build changes may run while the file loads. With no
// python3 of 3.8 or newer on PATH the test fails with that reason, never skips.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const COUNT = 34;
const PATHS = Array.from({ length: COUNT }, (_, i) => `tests/test_${String(i).padStart(2, "0")}.py`);
const DROPPED = "tests/test_33.py";
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

const LINES = [
  "from cart import total",
  "",
  "",
  "def test_adds():",
  "    assert total([2, 3]) == 5",
  "",
  "",
  "def test_empty():",
  "    assert total([]) == 0",
];
const BASE = `${LINES.join("\n")}\n`;
/** A kept file's head: one assertion added after line 5. */
const HEAD_TOUCHED = `${[...LINES.slice(0, 5), "    assert total([1]) == 1", ...LINES.slice(5)].join("\n")}\n`;
/** The dropped file's head: test_empty removed. */
const HEAD_REMOVED = `${LINES.slice(0, 5).join("\n")}\n`;

function diffOf(path: string): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  const body =
    path === DROPPED
      ? ["@@ -6,4 +5,0 @@", "-", "-", `-${LINES[7]}`, `-${LINES[8]}`]
      : ["@@ -5,0 +6 @@ def test_adds():", "+    assert total([1]) == 1"];
  return [...head, ...body].join("\n");
}
const DIFF = `${PATHS.map(diffOf).join("\n")}\n`;

const objects = (size: number) =>
  new Map<string, TestSourceObject | null>(PATHS.map((path) => [path, { type: "blob", size }]));

type Side = { files: { path: string; text: string }[]; dropped: TestSourceDrop[] };

describe("CORE-351: a modified .py test file the sources reader dropped past the 16 MiB total fails in mode block", () => {
  it(
    "AC-12: the plan drops tests/test_33.py as over-total-cap on the head side, the diff removes a test from it, and the Python index is built from the kept files: the TEST_INTEGRITY_INDEX_UNAVAILABLE error names it with over-total-cap and the verdict is fail",
    async () => {
      requirePython();
      const { planTestSourceReads } = await import("../../core/src/testSources.js");
      const side = (size: number, text: (path: string) => string): Side => {
        const plan = planTestSourceReads(PATHS, objects(size));
        return { files: plan.read.map((path) => ({ path, text: text(path) })), dropped: plan.dropped };
      };
      const base = side(400_000, () => BASE);
      const head = side(500_000, (path) => (path === DROPPED ? HEAD_REMOVED : HEAD_TOUCHED));
      expect(head.dropped, "the head plan drops only the 34th file, as over-total-cap").toEqual([
        { path: DROPPED, reason: "over-total-cap" },
      ]);
      expect(base.dropped, "the base plan reads every file").toEqual([]);

      const testSources = { base, head };
      const io = await import("../src/index.js");
      const pythonTestIndex = await io.indexPythonTestSources(testSources);
      expect(pythonTestIndex?.available, "the Python index ran").toBe(true);

      const { check } = await import("../../core/test/text-coverage.js");
      const report = check({
        version: "0.1.0",
        coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
        diff: { text: DIFF },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: null,
        repoFiles: [...PATHS, "src/app.ts", "src/cart.py"].sort(),
        testIntegrityMode: { input: "block" },
        testSources,
        ...(pythonTestIndex === undefined ? {} : { pythonTestIndex }),
      });
      expectValidReport(report);

      const naming = report.messages.filter((m) => m.code === CODE && m.text.includes(`\`${DROPPED}\``));
      expect(naming, `one ${CODE} message names ${DROPPED}`).toHaveLength(1);
      expect(naming[0]?.text, "it names the file with over-total-cap").toContain(`\`${DROPPED}\` (\`over-total-cap\`)`);
      expect(naming[0]?.level, "the message is an error in mode block").toBe("error");
      expect(report.verdict, "the verdict").toBe("fail");
    },
    SLOW,
  );
});
