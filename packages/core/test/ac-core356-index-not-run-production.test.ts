import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-356 (AC-8, grill G1-5). The production shape of a Python index that did not run: the CLI and the Action pass
// `{ available: false, reason: "python-not-found" }` after trying to start an interpreter. With a modified `.py` test
// file that stops the comparison as a whole, and the TEST_INTEGRITY_INDEX_UNAVAILABLE message is the whole-run one,
// naming the reason rather than the file. In mode warn the verdict stays warn, and an aliased skip is not resolved
// (no TI03), as in the absent-index variant (ac-core356-index-not-run-warn.test.ts).

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "py/test_cart.py";

const BASE = `import pytest as pt

from cart import total


def test_total():
    assert total([2, 3]) == 5


def test_empty():
    assert total([]) == 0
`;
const HEAD = BASE.replace("def test_total():", "@pt.mark.skip\ndef test_total():");

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -5,0 +6 @@ from cart import total",
  "+@pt.mark.skip",
].join("\n")}\n`;

async function run(): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "warn" },
    testSources: {
      base: { files: [{ path: PATH, text: BASE }], dropped: [] },
      head: { files: [{ path: PATH, text: HEAD }], dropped: [] },
    },
    pythonTestIndex: { available: false, reason: "python-not-found" },
  });
  expectValidReport(report);
  return report;
}

describe("CORE-356: in mode warn, with the production python-not-found index, the run is named as not compared", () => {
  it("AC-8 (production shape): mode warn and pythonTestIndex { available: false, reason: python-not-found } give the verdict warn, one whole-run TEST_INTEGRITY_INDEX_UNAVAILABLE warning with the reason, and no TI03 signal", async () => {
    const report = await run();
    expect(report.verdict, "the verdict").toBe("warn");
    const messages = report.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.level, "a warning").toBe("warn");
    expect(messages[0]?.text, "the whole-run reason").toContain("python-not-found");
    expect(
      report.testIntegrity.signals.filter((s) => String(s.id) === "TI03"),
      "no TI03: the aliased spelling is not resolved without the index",
    ).toEqual([]);
  });
});
