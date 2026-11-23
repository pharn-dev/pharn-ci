import { describe, expect, it } from "vitest";
import type { Report } from "../src/report.js";
import type { TestSources } from "../src/testSources.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and unavailableTestSources() are loaded inside the test body: the AC test is written before the block-mode
// rule exists (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run while the file
// loads. The per-file run (a head side dropped as too large) is the control; the both-sides-unavailable run, in the
// same test, must give the error.

const CODE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
const TEST_FILE = "src/app.test.ts";

const BASE_TEXT =
  'import { expect, it } from "vitest";\nimport { add } from "./app.js";\n\nit("adds", () => {\n  expect(add(1, 2)).toBe(3);\n});\n';

/** A `--unified=0` diff that adds one assertion to the existing test file `src/app.test.ts`. */
const MODIFIES_TEST = `${[
  `diff --git a/${TEST_FILE} b/${TEST_FILE}`,
  "index 1111111..2222222 100644",
  `--- a/${TEST_FILE}`,
  `+++ b/${TEST_FILE}`,
  '@@ -4,0 +5 @@ it("adds", () => {',
  "+  expect(add(2, 2)).toBe(4);",
].join("\n")}\n`;

async function run(testSources: TestSources): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: MODIFIES_TEST },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: [TEST_FILE, "src/app.ts"],
    testIntegrityMode: { input: "block" },
    testSources,
  });
  expectValidReport(report);
  return report;
}

const unavailable = (report: Report) => report.messages.filter((m) => m.code === CODE);

describe("block mode: the per-file unavailable form against the whole-run form", () => {
  it("AC-5: a readable base with a head dropped as too large is level error (CORE-69), the same file dropped as too large on both sides stays level warn, and both sides unavailable makes it level error", async () => {
    // CORE-69: the change made the file unreadable at HEAD while it was readable at the merge base, so block fails.
    const perFile = await run({
      base: { files: [{ path: TEST_FILE, text: BASE_TEXT }], dropped: [] },
      head: { files: [], dropped: [{ path: TEST_FILE, reason: "too-large" }] },
    });
    expect(unavailable(perFile), `one ${CODE} message for the per-file form`).toHaveLength(1);
    expect(unavailable(perFile)[0]?.level).toBe("error");
    expect(unavailable(perFile)[0]?.text).toContain(TEST_FILE);

    // The per-file warning is still pinned: a file too large on both sides was not made unreadable by the change.
    const bothSides = await run({
      base: { files: [], dropped: [{ path: TEST_FILE, reason: "too-large" }] },
      head: { files: [], dropped: [{ path: TEST_FILE, reason: "too-large" }] },
    });
    expect(unavailable(bothSides), `one ${CODE} message for the both-sides form`).toHaveLength(1);
    expect(unavailable(bothSides)[0]?.level).toBe("warn");
    expect(unavailable(bothSides)[0]?.text).toContain(TEST_FILE);

    const { unavailableTestSources } = await import("@pharn-ci/core");
    const wholeRun = await run(unavailableTestSources("the base commit is not in the checkout"));
    expect(unavailable(wholeRun), `one ${CODE} message for the whole-run form`).toHaveLength(1);
    expect(unavailable(wholeRun)[0]?.level).toBe("error");
  });
});
