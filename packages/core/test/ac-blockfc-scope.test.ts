import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and unavailableTestSources() are loaded inside the test body: the AC test is written before the block-mode
// rule exists (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run while the file
// loads. The first run (no compared test file) is the control; the second, in the same test, must give the error.

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

/** A `--unified=0` diff that changes one line of the source file `src/app.ts`. */
const SOURCE_EDIT = `${[
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -2 +2 @@ export function add(a: number, b: number) {",
  "-  return a + b;",
  "+  return b + a;",
].join("\n")}\n`;

/** A diff that adds the new test file `src/app.test.ts`. */
const ADDS_TEST = `${[
  "diff --git a/src/app.test.ts b/src/app.test.ts",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/src/app.test.ts",
  "@@ -0,0 +1,6 @@",
  '+import { expect, it } from "vitest";',
  '+import { add } from "./app.js";',
  "+",
  '+it("adds", () => {',
  "+  expect(add(1, 2)).toBe(3);",
  "+});",
].join("\n")}\n`;

/** A `--unified=0` diff that adds one assertion to the existing test file `src/old.test.ts`. */
const MODIFIES_TEST = `${[
  "diff --git a/src/old.test.ts b/src/old.test.ts",
  "index 4444444..5555555 100644",
  "--- a/src/old.test.ts",
  "+++ b/src/old.test.ts",
  '@@ -4,0 +5 @@ it("keeps", () => {',
  "+  expect(add(2, 2)).toBe(4);",
].join("\n")}\n`;

async function run(diff: string): Promise<Report> {
  const { check, unavailableTestSources } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["src/app.test.ts", "src/app.ts", "src/old.test.ts"],
    testIntegrityMode: { input: "block" },
    testSources: unavailableTestSources("the base commit is not in the checkout"),
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const unavailable = (report: Report) => report.messages.filter((m) => m.code === CODE);

describe("block mode with unavailable test sources fails only when a compared test file is touched", () => {
  it("AC-4: a source edit plus an added test file gives no TEST_INTEGRITY_INDEX_UNAVAILABLE and no fail; adding a modified existing test file gives it at level error", async () => {
    const first = await run(SOURCE_EDIT + ADDS_TEST);
    expect(unavailable(first), `no ${CODE} message without a modified test file`).toEqual([]);
    expect(first.verdict).not.toBe("fail");

    const second = await run(SOURCE_EDIT + ADDS_TEST + MODIFIES_TEST);
    expect(unavailable(second), `one ${CODE} message with a modified test file`).toHaveLength(1);
    expect(unavailable(second)[0]?.level).toBe("error");
  });
});
