import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file that the change
// makes unreadable at HEAD fails block, so nothing the build changes may run while the file loads. The 530 KB comment
// is built here, not committed as a fixture.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "src/big.test.ts";

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

describe("CORE-69: a modified test file padded past the size cap at HEAD", () => {
  it("AC-2: a modified src/big.test.ts whose head adds a comment of about 530 KB gives one TEST_INTEGRITY_INDEX_UNAVAILABLE error naming it with too-large, and the verdict is fail", async () => {
    const head = `${BASE}/* ${"x".repeat(530_000)} */\n`;
    expect(head.length, "the head text is over the test index's 524288-character cap").toBeGreaterThan(524_288);
    const core = (await import("../src/testIndex/indexTestFile.js")) as unknown as {
      indexTestFile(path: string, text: string): { parsed: boolean; reason?: string };
    };
    expect(core.indexTestFile(PATH, BASE).parsed, "the base text indexes").toBe(true);
    expect(core.indexTestFile(PATH, head), "the head text is refused as too large").toEqual({
      parsed: false,
      reason: "too-large",
    });

    const diff = `${[
      `diff --git a/${PATH} b/${PATH}`,
      "index 1111111..2222222 100644",
      `--- a/${PATH}`,
      `+++ b/${PATH}`,
      "@@ -10,0 +11 @@",
      "+/* padding */",
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
        head: { files: [{ path: PATH, text: head }], dropped: [] },
      },
    } as unknown as Parameters<typeof check>[0]);
    expectValidReport(report);
    const r = report as unknown as Report;

    const messages = r.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.text).toContain(PATH);
    expect(messages[0]?.text).toContain("too-large");
    expect(messages[0]?.level).toBe("error");
    expect(r.verdict).toBe("fail");
  });
});
