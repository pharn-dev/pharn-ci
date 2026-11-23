import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-69. check() is loaded inside the test body: the AC test is written before a modified test file that the change
// makes unreadable at HEAD fails block, so nothing the build changes may run while the file loads. An added test file
// that cannot be read keeps warning; the same 600 KB text as the head of a modified file is the control, in the same
// test, that fails before the build. The 600 KB text is built here, not committed as a fixture.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const PATH = "src/new.test.ts";

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
].join("\n");

async function run(diff: string, testSources: unknown): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [PATH, "src/cart.ts"],
    testIntegrityMode: { input: "block" },
    testSources,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("CORE-69: an added test file that cannot be read keeps warning", () => {
  it("AC-11: a diff that only adds a 600 KB src/new.test.ts gives one TEST_INTEGRITY_INDEX_UNAVAILABLE warning naming it, no error, and the verdict warn", async () => {
    const head = `${BASE}/* ${"x".repeat(600_000)} */\n`;
    expect(head.length).toBeGreaterThan(600_000);

    // Control: the same text as the head of a modified src/new.test.ts whose merge base indexes is an error in block.
    const modifiedDiff = `${[
      `diff --git a/${PATH} b/${PATH}`,
      "index 1111111..2222222 100644",
      `--- a/${PATH}`,
      `+++ b/${PATH}`,
      "@@ -7,0 +8 @@",
      "+/* padding */",
    ].join("\n")}\n`;
    const modified = await run(modifiedDiff, {
      base: { files: [{ path: PATH, text: BASE }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    });
    const modifiedMessages = modified.messages.filter((m) => m.code === CODE);
    expect(modifiedMessages, "the modified-file control names it").toHaveLength(1);
    expect(modifiedMessages[0]?.level, "the modified-file control is an error").toBe("error");

    const addedDiff = `${[
      `diff --git a/${PATH} b/${PATH}`,
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      `+++ b/${PATH}`,
      "@@ -0,0 +1,2 @@",
      '+import { expect, it } from "vitest";',
      "+/* padding */",
    ].join("\n")}\n`;
    const report = await run(addedDiff, {
      base: { files: [], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    });
    const messages = report.messages.filter((m) => m.code === CODE);
    expect(messages, `one ${CODE} message`).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toContain(PATH);
    expect(
      report.messages.filter((m) => m.level === "error"),
      "no error",
    ).toEqual([]);
    expect(report.verdict).toBe("warn");
  });
});
