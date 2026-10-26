import { describe, expect, it } from "vitest";

// The validator is imported inside the test body: the build writes it, after this test.

/** A valid version plus `count` distinct unknown top-level keys `u0`, `u1`, …: exactly `count` independent errors. */
function withUnknownKeys(count: number): Record<string, unknown> {
  const doc: Record<string, unknown> = { version: 1 };
  for (let i = 0; i < count; i++) doc[`u${i}`] = true;
  return doc;
}

describe("validatePolicy caps its error list", () => {
  it("AC-9: more than POLICY_MAX_ERRORS errors end in one 'more errors not listed' entry; exactly that many are all listed", async () => {
    const { validatePolicy, POLICY_MAX_ERRORS } = await import("@pharn-ci/core");
    expect(POLICY_MAX_ERRORS).toBe(50);

    const over = validatePolicy(withUnknownKeys(POLICY_MAX_ERRORS + 7));
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.errors).toHaveLength(POLICY_MAX_ERRORS);
      expect(over.errors.at(-1)).toEqual({ path: "", message: "8 more errors not listed" });
    }

    const exact = validatePolicy(withUnknownKeys(POLICY_MAX_ERRORS));
    expect(exact.ok).toBe(false);
    if (!exact.ok) {
      expect(exact.errors).toHaveLength(POLICY_MAX_ERRORS);
      for (const error of exact.errors) {
        expect(error.path).not.toBe("");
        expect(error.message.endsWith("more errors not listed")).toBe(false);
      }
    }
  });
});
