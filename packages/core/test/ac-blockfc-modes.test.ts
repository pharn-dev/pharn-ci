import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and unavailableTestSources() are loaded inside the test body: the AC test is written before the block-mode
// rule exists (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run while the file
// loads. The warn run is the control; the block run, in the same test, must give the error.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

interface Message {
  code: string;
  level: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
}

/** A `--unified=0` diff that adds one assertion to the existing test file `src/app.test.ts`. */
const MODIFIES_TEST = `${[
  "diff --git a/src/app.test.ts b/src/app.test.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.test.ts",
  "+++ b/src/app.test.ts",
  '@@ -4,0 +5 @@ it("adds", () => {',
  "+  expect(add(2, 2)).toBe(4);",
].join("\n")}\n`;

async function run(mode: "warn" | "block"): Promise<Report> {
  const { check, unavailableTestSources } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: MODIFIES_TEST },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["src/app.test.ts", "src/app.ts"],
    testIntegrityMode: { input: mode },
    testSources: unavailableTestSources("the base commit is not in the checkout"),
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const unavailable = (report: Report) => report.messages.filter((m) => m.code === CODE);

describe("the same unavailable test sources in mode warn and in mode block", () => {
  it("AC-2: mode warn keeps TEST_INTEGRITY_INDEX_UNAVAILABLE at level warn with a verdict that is not fail, mode block makes it level error", async () => {
    const warn = await run("warn");
    expect(unavailable(warn), `one ${CODE} message in mode warn`).toHaveLength(1);
    expect(unavailable(warn)[0]?.level).toBe("warn");
    expect(warn.verdict).not.toBe("fail");

    const block = await run("block");
    expect(unavailable(block), `one ${CODE} message in mode block`).toHaveLength(1);
    expect(unavailable(block)[0]?.level).toBe("error");
  });
});
