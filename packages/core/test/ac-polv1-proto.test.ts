import { describe, expect, it } from "vitest";

// The parser is imported inside the test body: the build writes it, after this test.

const TEXT =
  '{"version":1,"__proto__":{"polluted":1},"constructor":{"polluted":1},' +
  '"coverage":{"__proto__":{"polluted":1},"constructor":{"polluted":1}}}';

describe("parsePolicyJson and prototype keys", () => {
  it("AC-7: __proto__ and constructor keys are unknown-key errors and pollute nothing", async () => {
    const { parsePolicyJson } = await import("@pharn-ci/core");

    const result = parsePolicyJson(TEXT);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.path)).toEqual([
        "/__proto__",
        "/constructor",
        "/coverage/__proto__",
        "/coverage/constructor",
      ]);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });
});
