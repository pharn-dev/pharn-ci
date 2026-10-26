import { describe, expect, it } from "vitest";

// The validator is imported inside the test body: the build writes it, after this test.

describe("validatePolicy and parsePolicyJson on hostile values", () => {
  it("AC-5: every hostile value returns ok: false with at least one error, and nothing throws or hangs", async () => {
    const { validatePolicy, parsePolicyJson } = await import("@pharn-ci/core");

    const cyclicKnown: Record<string, unknown> = { version: 1 };
    cyclicKnown.coverage = cyclicKnown;
    const cyclicUnknown: Record<string, unknown> = { version: 1 };
    cyclicUnknown.extra = cyclicUnknown;

    const hostile: [string, unknown][] = [
      ["undefined", undefined],
      ["null", null],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["a function value", () => 1],
      ["a symbol", Symbol("s")],
      ["a bigint", 10n],
      ["a top-level array", []],
      ["a string", "text"],
      ["cyclic under a known key", cyclicKnown],
      ["cyclic under an unknown key", cyclicUnknown],
    ];
    for (const [label, value] of hostile) {
      let result: ReturnType<typeof validatePolicy> | undefined;
      expect(() => {
        result = validatePolicy(value);
      }, label).not.toThrow();
      expect(result?.ok, label).toBe(false);
      if (result !== undefined && !result.ok) expect(result.errors.length, label).toBeGreaterThanOrEqual(1);
      else expect.fail(`${label}: no error list`);
    }

    const notText: [string, unknown][] = [
      ["undefined", undefined],
      ["null", null],
      ["42", 42],
      ["{}", {}],
      ["[]", []],
    ];
    for (const [label, value] of notText) {
      let result: ReturnType<typeof parsePolicyJson> | undefined;
      expect(() => {
        result = parsePolicyJson(value as unknown as string);
      }, label).not.toThrow();
      expect(result?.ok, `parsePolicyJson ${label}`).toBe(false);
    }
  });
});
