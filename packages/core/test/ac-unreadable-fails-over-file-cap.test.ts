import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file that the change
// pushes past the 200-file read cap at HEAD fails block, so nothing the build changes may run while the file loads.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "src/a.test.ts";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

const BASE = [
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
  "",
].join("\n");

describe("CORE-69: a modified test file dropped at HEAD by the read cap", () => {
  it("AC-3: a modified src/a.test.ts read at the merge base and dropped at HEAD as over-file-cap gives one TEST_INTEGRITY_INDEX_UNAVAILABLE error naming it with over-file-cap, and the verdict is fail", async () => {
    const diff = `${[
      `diff --git a/${PATH} b/${PATH}`,
      "index 1111111..2222222 100644",
      `--- a/${PATH}`,
      `+++ b/${PATH}`,
      "@@ -5,0 +6 @@",
      "+  expect(total([1])).toBe(1);",
    ].join("\n")}\n`;

    const { check } = await import("../src/check.js");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: diff },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: [PATH, "src/cart.ts"],
      testIntegrityMode: { input: "block" },
      testSources: {
        base: { files: [{ path: PATH, text: BASE }], dropped: [] },
        head: { files: [], dropped: [{ path: PATH, reason: "over-file-cap" }] },
      },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const r = report as unknown as Report;

    const messages = r.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text).toContain(PATH);
    expect(messages[0]?.text).toContain("over-file-cap");
    expect(messages[0]?.level).toBe("error");
    expect(r.verdict).toBe("fail");
  });
});
