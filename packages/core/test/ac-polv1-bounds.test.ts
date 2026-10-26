import { describe, expect, it } from "vitest";

// The validator is imported inside the test body: the build writes it, after this test. No timing assertion: the
// bounded-work claim is checked by error counts and by each call returning.

describe("validatePolicy and parsePolicyJson bound their work", () => {
  it("AC-6: a huge list, an over-long string, an over-long text and 100,000-level nesting each give a bounded result", async () => {
    const { validatePolicy, parsePolicyJson, POLICY_MAX_CHARS, POLICY_MAX_ERRORS } = await import("@pharn-ci/core");
    expect(typeof POLICY_MAX_CHARS).toBe("number");
    expect(typeof POLICY_MAX_ERRORS).toBe("number");

    const hugeList = validatePolicy({ version: 1, coverage: { exclude: new Array(1_000_000).fill("a/**") } });
    expect(hugeList.ok).toBe(false);
    if (!hugeList.ok) expect(hugeList.errors.map((e) => e.path)).toEqual(["/coverage/exclude"]);

    const longString = validatePolicy({ version: 1, setup: { allowed_mcp_servers: ["n".repeat(129)] } });
    expect(longString.ok).toBe(false);
    if (!longString.ok) expect(longString.errors.map((e) => e.path)).toEqual(["/setup/allowed_mcp_servers/0"]);

    const longText = parsePolicyJson(" ".repeat(POLICY_MAX_CHARS + 1));
    expect(longText.ok).toBe(false);
    if (!longText.ok) expect(longText.errors.map((e) => e.path)).toEqual([""]);

    const deepTexts = [
      `{"version":1,"coverage":${"[".repeat(100000)}${"]".repeat(100000)}}`,
      `${"[".repeat(100000)}${"]".repeat(100000)}`,
    ];
    for (const text of deepTexts) {
      let result: ReturnType<typeof parsePolicyJson> | undefined;
      expect(() => {
        result = parsePolicyJson(text);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result !== undefined && !result.ok) {
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.errors.length).toBeLessThanOrEqual(POLICY_MAX_ERRORS);
      } else expect.fail("no error list for a deep text");
    }
  });
});
