import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-6). check() is loaded inside the test body: the AC test is written before the build, so nothing the
// build changes may run while the file loads. The new error is per file, never a whole-run stop: with the Python index
// timed out, the modified `.py` test file is not compared (and, in mode block, is the per-file error AC-1 asks for),
// while the TypeScript test file of the same run is still compared, so the test it removes is still a TI02 finding.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PY = "tests/test_c.py";
const TS = "src/cart.test.ts";

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n    assert total([1]) == 1\n";

const TS_LINES = [
  'import { expect, it } from "vitest";',
  'import { total } from "./cart.js";',
  "",
  'it("adds the prices", () => {',
  "  expect(total([2, 3])).toBe(5);",
  "});",
  "",
  'it("rejects a negative price", () => {',
  '  expect(() => total([-1])).toThrow("negative price");',
  "});",
];
const TS_BASE = `${TS_LINES.join("\n")}\n`;
const TS_HEAD = `${TS_LINES.slice(0, 6).join("\n")}\n`;

const DIFF = `${[
  `diff --git a/${TS} b/${TS}`,
  "index 4444444..5555555 100644",
  `--- a/${TS}`,
  `+++ b/${TS}`,
  "@@ -7,4 +6,0 @@",
  "-",
  `-${TS_LINES[7]}`,
  `-${TS_LINES[8]}`,
  `-${TS_LINES[9]}`,
  `diff --git a/${PY} b/${PY}`,
  "index 1111111..2222222 100644",
  `--- a/${PY}`,
  `+++ b/${PY}`,
  "@@ -5,0 +6 @@ def test_adds():",
  "+    assert total([1]) == 1",
].join("\n")}\n`;

describe("CORE-351: a Python index that did not run leaves the JS and TS test files compared", () => {
  it("AC-6: with the Python index unavailable as timeout, the TypeScript test file that loses a test still gives its TI02 finding, the .py file is the per-file error, and the verdict is fail", async () => {
    const { check } = await import("./text-coverage.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: DIFF },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: [PY, TS, "src/app.ts", "src/cart.ts"],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: {
          files: [
            { path: TS, text: TS_BASE },
            { path: PY, text: PY_BASE },
          ],
          dropped: [],
        },
        head: {
          files: [
            { path: TS, text: TS_HEAD },
            { path: PY, text: PY_HEAD },
          ],
          dropped: [],
        },
      },
      pythonTestIndex: { available: false, reason: "timeout" },
    });
    expectValidReport(report);

    const ti02 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI02" && s.path === TS);
    expect(ti02.length, "the TypeScript file still gives a TI02 finding").toBeGreaterThan(0);

    const messages = report.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text, "it names the .py file with timeout").toContain(`\`${PY}\` (\`timeout\`)`);
    expect(messages[0]?.text, "it does not name the compared TypeScript file").not.toContain(TS);
    expect(messages[0]?.text, "the per-file form, not a whole-run stop").not.toContain("did not run");
    expect(messages[0]?.level, "the per-file message is an error in mode block").toBe("error");

    expect(report.verdict, "the verdict").toBe("fail");
  });
});
