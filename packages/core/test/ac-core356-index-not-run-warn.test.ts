import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-356 (AC-8). Mode warn, and a Python index that did not run: check() gets the test sources but no
// pythonTestIndex, which gives the per-file `python-not-found` reason (an explicit `{ available: false }` index stops
// the comparison as a whole with a sentence that names no file; PLAN.md, Risks). A modified py/test_cart.py gains
// `@pt.mark.skip` above an unchanged test under `import pytest as pt`. After CORE-356 an aliased spelling is resolved
// only from the Python index, so for a side the index did not index it is not read (SPEC, Assumptions, last bullet):
// no TI03 signal, while the verdict stays warn and the index-unavailable message names the file. check() is loaded
// inside the test body, so nothing the build changes runs while the file loads.

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
  });
  expectValidReport(report);
  return report;
}

describe("CORE-356: in mode warn, with no Python index, an aliased skip is not resolved and the file is named", () => {
  it("AC-8: in mode warn with a Python index that did not run (python-not-found), a modified py/test_cart.py gaining @pt.mark.skip above an unchanged test under import pytest as pt gives the verdict warn, a TEST_INTEGRITY_INDEX_UNAVAILABLE message naming the file, and no TI03 signal (the alias is not resolved for a side the index did not index)", async () => {
    expect(HEAD.split("\n")[5], "the decorator at line 6").toBe("@pt.mark.skip");
    expect(HEAD.split("\n")[6], "above the unchanged def").toBe("def test_total():");

    const report = await run();
    expect(report.verdict, "the verdict").toBe("warn");
    const messages = report.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text, "it names the file with the reason").toContain(`\`${PATH}\` (\`python-not-found\`)`);
    expect(messages[0]?.level, "a warning").toBe("warn");
    expect(
      report.testIntegrity.signals.filter((s) => String(s.id) === "TI03"),
      "no TI03: the aliased spelling is not resolved without the index",
    ).toEqual([]);
  });
});
