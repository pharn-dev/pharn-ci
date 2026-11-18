import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a reported python-not-found index
// with a modified `.py` test file becomes the whole-run form, so nothing the build changes may run while the file loads.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "tests/test_c.py";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

const PY_BASE =
  "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n\n\ndef test_empty():\n    assert total([]) == 0\n";
const PY_HEAD = "from cart import total\n\n\ndef test_adds():\n    assert total([2, 3]) == 5\n";

/** A `--unified=0` diff that removes `test_empty` from tests/test_c.py. */
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

describe("CORE-69: no python3 while a Python test file is modified", () => {
  it("AC-4: a modified tests/test_c.py with readable text and a Python index reported unavailable as python-not-found gives one TEST_INTEGRITY_INDEX_UNAVAILABLE error saying TI02 and TI05 did not run, and the verdict is fail", async () => {
    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: DIFF },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: [PATH, "src/cart.ts"],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [{ path: PATH, text: PY_BASE }], dropped: [] },
        head: { files: [{ path: PATH, text: PY_HEAD }], dropped: [] },
      },
      pythonTestIndex: { available: false, reason: "python-not-found", detail: "python3: command not found" },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const r = report as unknown as Report;

    const messages = r.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text).toContain("python-not-found");
    expect(messages[0]?.text).toContain("TI02 and TI05 did not run");
    expect(messages[0]?.level).toBe("error");
    expect(r.verdict).toBe("fail");
  });
});
