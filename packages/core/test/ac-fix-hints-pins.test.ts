import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// fix-hints (H6), AC-12. The shared helper (packages/core/test/v090-codes.ts) and check() are loaded inside the test
// body. (CORE-132: the schema comparison with an old commit, and the test that read the increment's edits with git and
// re-ran the edited tests in a child vitest, were history pins and are removed. What stays is the check that
// withoutFix, which the whole-report tests still use, takes out the fix objects and nothing else.)

interface Helper {
  withoutFix<T>(value: T): T;
}

async function helper(): Promise<Helper> {
  const loaded = (await import("./v090-codes.js")) as unknown as Partial<Helper>;
  expect(typeof loaded.withoutFix, "withoutFix is exported").toBe("function");
  return loaded as Helper;
}

describe("the shared withoutFix helper", () => {
  it("AC-12: withoutFix takes the fix objects out of a report and leaves its input as it was", async () => {
    const { withoutFix } = await helper();

    const { check } = (await import("../src/index.js")) as unknown as { check(input: unknown): unknown };
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    const text = JSON.stringify(report);
    expect(text, "the golden report carries fix").toContain('"fix"');
    expect(JSON.stringify(withoutFix(report)), "no fix object is left").not.toContain('"fix"');
    expect(JSON.stringify(report), "withoutFix leaves its input as it was").toBe(text);

    // Only a fix object (string kind and hint) is taken out; any other value under a fix key stays.
    expect(withoutFix({ fix: "a string", nested: [{ a: 1, fix: { kind: "none", hint: "Check the run." } }] })).toEqual({
      fix: "a string",
      nested: [{ a: 1 }],
    });
  });
});
