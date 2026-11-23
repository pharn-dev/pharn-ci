import { describe, expect, it } from "vitest";
import type { Report, TestIntegrityMode } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-19). check() is loaded inside the test body: the AC test is written before a file renamed from a
// non-test path into a `.py` test path is read as an added test file, so nothing the build changes may run while the
// file loads. The renamed file's head text is in the sources; the Python index timed out, so its tests could not be
// read, and it is named in the added-files sentence of TEST_INTEGRITY_INDEX_UNAVAILABLE: an error in mode block, a
// warning in mode warn.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const OLD = "py/cart_checks.py";
const NEW = "py/test_cart.py";
const ADDED_SENTENCE = "The tests in these added test files could not be read, so they are not checked:";

const HEAD =
  "import pytest\n\nfrom cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n    assert total([1]) == 1\n";

const DIFF = `${[
  `diff --git a/${OLD} b/${NEW}`,
  "similarity index 90%",
  `rename from ${OLD}`,
  `rename to ${NEW}`,
  "index 1111111..2222222 100644",
  `--- a/${OLD}`,
  `+++ b/${NEW}`,
  "@@ -7,0 +8 @@ def test_adds():",
  "+    assert total([1]) == 1",
].join("\n")}\n`;

async function run(mode: TestIntegrityMode): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [NEW, "py/cart.py", "src/app.ts"].sort(),
    testIntegrityMode: { input: mode },
    testSources: {
      base: { files: [], dropped: [] },
      head: { files: [{ path: NEW, text: HEAD }], dropped: [] },
    },
    pythonTestIndex: { available: false, reason: "timeout" },
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: a file renamed into a .py test path whose tests the Python index did not read", () => {
  it("AC-19: renaming py/cart_checks.py to py/test_cart.py with the Python index unavailable as timeout names it as an added test file in the TEST_INTEGRITY_INDEX_UNAVAILABLE message, an error with the verdict fail in mode block and a warning in mode warn", async () => {
    const block = await run("block");
    const blockMessages = block.messages.filter((m) => m.code === CODE);
    expect(blockMessages, `block: one ${CODE} message`).toHaveLength(1);
    expect(blockMessages[0]?.text, "block: it names the renamed file as an added test file").toContain(
      `${ADDED_SENTENCE} \`${NEW}\` (\`timeout\`)`,
    );
    expect(blockMessages[0]?.level, "block: the message is an error").toBe("error");
    expect(block.verdict, "block: the verdict").toBe("fail");

    const warn = await run("warn");
    const warnMessages = warn.messages.filter((m) => m.code === CODE);
    expect(warnMessages, `warn: one ${CODE} message`).toHaveLength(1);
    expect(warnMessages[0]?.text, "warn: it names the renamed file as an added test file").toContain(
      `${ADDED_SENTENCE} \`${NEW}\` (\`timeout\`)`,
    );
    expect(warnMessages[0]?.level, "warn: the message is a warning").toBe("warn");
  });
});
