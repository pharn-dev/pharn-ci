import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// fix-hints (H6), AC-12. The shared helper (packages/core/test/without-fix.ts) and check() are loaded inside the test
// body. (CORE-132: the schema comparison with an old commit, and the test that read the increment's edits with git and
// re-ran the edited tests in a child vitest, were history pins and are removed. What stays is the check that
// withoutFix, which the whole-report tests still use, takes out the fix objects and nothing else.)

interface Helper {
  withoutFix<T>(value: T): T;
}

async function helper(): Promise<Helper> {
  const loaded = await import("./without-fix.js");
  expect(typeof loaded.withoutFix, "withoutFix is exported").toBe("function");
  return loaded as Helper;
}

// Core's index loads cold, which can take seconds on a loaded host.
describe("the shared withoutFix helper", { timeout: 60_000 }, () => {
  it("AC-12: withoutFix takes the fix objects out of a report and leaves its input as it was", async () => {
    const { withoutFix } = await helper();

    const { check } = await import("./text-coverage.js");
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

    // The expected result, built without the helper: the same report with the `fix` of each message and each finding
    // deleted, and every other field kept.
    type Item = Record<string, unknown>;
    const expected = JSON.parse(text) as Record<string, unknown> & { messages: Item[] };
    const findings = (key: string, list: string) =>
      ((expected[key] as Record<string, unknown> | undefined)?.[list] as Item[] | undefined) ?? [];
    for (const item of [
      ...expected.messages,
      ...findings("testIntegrity", "signals"),
      ...findings("policy", "violations"),
      ...findings("setupHealth", "stale"),
      ...findings("injection", "signals"),
      ...findings("dependencies", "signals"),
    ]) {
      delete item.fix;
    }
    expect(JSON.stringify(expected), "the control has no fix left").not.toContain('"fix"');
    expect(withoutFix(report), "only the fix objects are taken out").toEqual(expected);
    expect(JSON.stringify(report), "withoutFix leaves its input as it was").toBe(text);

    // Only a fix object (string kind and hint) is taken out; any other value under a fix key stays.
    expect(withoutFix({ fix: "a string", nested: [{ a: 1, fix: { kind: "none", hint: "Check the run." } }] })).toEqual({
      fix: "a string",
      nested: [{ a: 1 }],
    });
  });
});
