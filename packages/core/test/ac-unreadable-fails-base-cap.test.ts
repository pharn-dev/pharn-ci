import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file dropped at the
// merge base by the read cap and refused at HEAD as too large fails block, so nothing the build changes may run while
// the file loads. A base drop for over-file-cap is one the change itself can cause, so it does not exempt the file.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "src/c.test.ts";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

describe("CORE-69: a modified test file dropped at the merge base by the read cap", () => {
  it("AC-8: a modified src/c.test.ts dropped at the merge base as over-file-cap and at HEAD as too-large gives one TEST_INTEGRITY_INDEX_UNAVAILABLE error naming it, and the verdict is fail", async () => {
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
        base: { files: [], dropped: [{ path: PATH, reason: "over-file-cap" }] },
        head: { files: [], dropped: [{ path: PATH, reason: "too-large" }] },
      },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const r = report as unknown as Report;

    const messages = r.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text).toContain(PATH);
    expect(messages[0]?.level).toBe("error");
    expect(r.verdict).toBe("fail");
  });
});
