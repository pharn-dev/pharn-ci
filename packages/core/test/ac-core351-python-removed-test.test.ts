import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-351 (AC-5), the regression the ticket names: a pull request that removes a Python test while the Python index
// times out or writes too much output must fail in mode block. check() is loaded inside the test body: the AC test is
// written before the build, so nothing the build changes may run while the file loads.

const PATH = "tests/test_c.py";

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

/** Removes test_empty from tests/test_c.py. */
const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -6,4 +5,0 @@",
  "-",
  "-",
  "-def test_empty():",
  "-    assert total([]) == 0",
].join("\n")}\n`;

async function run(reason: "timeout" | "output-too-large"): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/app.ts", "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: PY_BASE }], dropped: [] },
      head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
    },
    pythonTestIndex: { available: false, reason },
  });
  expectValidReport(report);
  return report;
}

describe("CORE-351: removing a Python test while the Python index did not run fails in mode block", () => {
  it.each(["timeout", "output-too-large"] as const)(
    "AC-5: a diff that removes test_empty from tests/test_c.py with the Python index unavailable as %s gives the verdict fail",
    async (reason) => {
      const report = await run(reason);
      expect(report.verdict, "the verdict").toBe("fail");
    },
  );
});
