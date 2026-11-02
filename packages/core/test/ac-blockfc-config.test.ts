import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and unavailableTestSources() are loaded inside the test body: the AC test is written before the block-mode
// rule exists (review HIGH 4, block-fails-closed-unavailable), so nothing that depends on it may run while the file
// loads.

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

/** A `--unified=0` diff that changes one line of the dedicated test-runner config `vitest.config.ts`. */
const MODIFIES_CONFIG = `${[
  "diff --git a/vitest.config.ts b/vitest.config.ts",
  "index 1111111..2222222 100644",
  "--- a/vitest.config.ts",
  "+++ b/vitest.config.ts",
  "@@ -5 +5 @@ export default defineConfig({",
  '-    include: ["src/**/*.test.ts"],',
  '+    include: ["src/**/*.test.ts", "lib/**/*.test.ts"],',
].join("\n")}\n`;

describe("block mode with test sources unavailable and a touched test-runner config", () => {
  it("AC-6: a diff that modifies vitest.config.ts gives TEST_INTEGRITY_INDEX_UNAVAILABLE at level error and verdict fail", async () => {
    const { check, unavailableTestSources } = await import("@pharn-ci/core");
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      diff: { text: MODIFIES_CONFIG },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["src/app.ts", "vitest.config.ts"],
      testIntegrityMode: { input: "block" },
      testSources: unavailableTestSources("the base commit is not in the checkout"),
    } as unknown as Parameters<typeof check>[0]) as unknown as Report;
    expectValidReport(report);

    const unavailable = report.messages.filter((m) => m.code === CODE);
    expect(unavailable, `one ${CODE} message`).toHaveLength(1);
    expect(unavailable[0]?.level).toBe("error");
    expect(report.verdict).toBe("fail");
  });
});
