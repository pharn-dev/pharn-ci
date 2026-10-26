import { describe, expect, it } from "vitest";

// The validator is imported inside the test body: the build writes it, after this test.

const SENTINEL = "SENTINEL_9f3c";

describe("validatePolicy never echoes input in an error", () => {
  it("AC-8: no message holds the sentinel, and unknown keys are escaped, truncated and scrubbed in their path", async () => {
    const { validatePolicy } = await import("@pharn-ci/core");

    const documents: [string, unknown][] = [
      ["wrong type", { version: 1, coverage: { threshold: SENTINEL } }],
      ["out of grammar (glob)", { version: 1, coverage: { exclude: [`../${SENTINEL}`] } }],
      ["out of grammar (login)", { version: 1, agents: { extra_logins: [`${SENTINEL}!`] } }],
      ["bad enum", { version: 1, setup: { consistency: SENTINEL } }],
      ["unknown key", { version: 1, extra: SENTINEL }],
    ];
    for (const [label, doc] of documents) {
      const result = validatePolicy(doc);
      expect(result.ok, label).toBe(false);
      if (result.ok) continue;
      expect(result.errors.length, label).toBeGreaterThanOrEqual(1);
      for (const error of result.errors) expect(error.message, label).not.toContain(SENTINEL);
    }

    const pathsOf = (key: string): string[] => {
      const result = validatePolicy({ version: 1, [key]: true });
      return result.ok ? [] : result.errors.map((e) => e.path);
    };
    expect(pathsOf("a/b~c")).toContain("/a~1b~0c");
    expect(pathsOf("k".repeat(100))).toContain(`/${"k".repeat(64)}…`);
    expect(pathsOf("x\u0001y\u007f")).toContain("/x?y?");
  });
});
