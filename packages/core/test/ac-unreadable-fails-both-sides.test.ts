import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file that the change
// makes unreadable at HEAD fails block, so nothing the build changes may run while the file loads. A file that was
// already too large at the merge base keeps warning; the same diff with a readable merge base is the control, in the
// same test, that fails before the build.

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

const DIFF = `${[
  `diff --git a/${PATH} b/${PATH}`,
  "index 1111111..2222222 100644",
  `--- a/${PATH}`,
  `+++ b/${PATH}`,
  "@@ -5,0 +6 @@",
  "+  expect(total([1])).toBe(1);",
].join("\n")}\n`;

async function run(testSources: unknown): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: DIFF },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("CORE-69: a modified test file already unreadable at the merge base keeps warning", () => {
  it("AC-12: a modified src/a.test.ts dropped as too-large on both sides gives one TEST_INTEGRITY_INDEX_UNAVAILABLE warning naming it with too-large, no error, and the verdict warn", async () => {
    // Control: a readable merge base with the head dropped as too-large is an error in block.
    const control = await run({
      base: { files: [{ path: PATH, text: BASE }], dropped: [] },
      head: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
    });
    const controlMessages = control.messages.filter((m) => m.code === CODE);
    expect(controlMessages, "the control names it").toHaveLength(1);
    expect(controlMessages[0]?.level, "the control is an error").toBe("error");

    const report = await run({
      base: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
      head: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
    });
    const messages = report.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toContain(PATH);
    expect(messages[0]?.text).toContain("too-large");
    expect(
      report.messages.filter((m) => m.level === "error"),
      "no error",
    ).toEqual([]);
    expect(report.verdict).toBe("warn");
  });
});
