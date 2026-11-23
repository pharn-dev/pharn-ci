import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file cut at 5000
// changed lines fails block, so nothing the build changes may run while the file loads. The 5001-line diff is built
// here, not committed as a fixture.

const CODE = "TEST_INTEGRITY_TEXT_TRUNCATED";
const PATH = "src/long.test.ts";

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

describe("CORE-69: a modified test file whose diff is cut at 5000 changed lines", () => {
  it("AC-5: a modified src/long.test.ts with more than 5000 changed lines and readable text on both sides gives one TEST_INTEGRITY_TEXT_TRUNCATED error naming it, and the verdict is fail", async () => {
    const added = Array.from({ length: 5001 }, (_, i) => `// line ${i + 1}`);
    const head = `${BASE}${added.join("\n")}\n`;
    const diff = `${[
      `diff --git a/${PATH} b/${PATH}`,
      "index 1111111..2222222 100644",
      `--- a/${PATH}`,
      `+++ b/${PATH}`,
      `@@ -10,0 +11,${added.length} @@`,
      ...added.map((l) => `+${l}`),
    ].join("\n")}\n`;

    const { check } = await import("./text-coverage.js");
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
        head: { files: [{ path: PATH, text: head }], dropped: [] },
      },
    });
    expectValidReport(report);
    const r = report;

    expect(
      r.messages.filter((m) => m.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE"),
      "both sides index",
    ).toEqual([]);
    const messages = r.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text).toContain(PATH);
    expect(messages[0]?.level).toBe("error");
    expect(r.verdict).toBe("fail");
  });
});
