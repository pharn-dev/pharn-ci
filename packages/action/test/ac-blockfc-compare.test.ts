import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness } from "./harness.js";

// run() is loaded inside the test body: the AC test is written before the block-mode rule exists (review HIGH 4,
// block-fails-closed-unavailable), so nothing that depends on it may run while the file loads. With `localGit: false`
// the PR base does not resolve (a depth-1 checkout), so the diff comes from the compare API, and the test sources
// cannot be read on either side.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const TEST_FILE = "src/math.test.ts";

interface Message {
  code: string;
  level: string;
  text: string;
}

/** The golden PR diff plus a `--unified=0` hunk that adds one assertion to the existing test file. */
const DIFF = `${fixture("golden/pr.diff")}${[
  `diff --git a/${TEST_FILE} b/${TEST_FILE}`,
  "index 7777777..8888888 100644",
  `--- a/${TEST_FILE}`,
  `+++ b/${TEST_FILE}`,
  '@@ -4,0 +5 @@ it("adds", () => {',
  "+  expect(add(2, 2)).toBe(4);",
].join("\n")}\n`;

describe("the Action in block mode on a shallow checkout", () => {
  it("AC-7: a compare-API diff that modifies a test file fails the step and report.json holds TEST_INTEGRITY_INDEX_UNAVAILABLE at level error", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({
      inputs: { "test-integrity": "block" },
      localGit: false,
      lsFiles: [...fixture("golden/files.txt").trim().split("\n"), TEST_FILE].sort(),
    });
    h.deps.api = {
      ...h.deps.api,
      async compareDiff(basehead: string) {
        h.apiCalls.push(`compare ${basehead}`);
        return DIFF;
      },
    };
    await run(h.deps);

    expect(
      h.apiCalls.some((c) => c.startsWith("compare ")),
      "the diff came from the compare API",
    ).toBe(true);
    const text = h.written[h.outputs["report-path"] ?? ""];
    expect(text, "report.json was written").toBeDefined();
    const report = JSON.parse(text as string) as { verdict: string; messages: Message[] };
    expectValidReport(report);

    const unavailable = report.messages.filter((m) => m.code === CODE);
    expect(unavailable, `one ${CODE} message`).toHaveLength(1);
    expect(unavailable[0]?.level).toBe("error");
    expect(report.verdict).toBe("fail");
    expect(h.failed, "the step is marked failed").toHaveLength(1);
  });
});
