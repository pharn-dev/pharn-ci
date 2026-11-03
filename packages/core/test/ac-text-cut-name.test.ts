import { describe, expect, it } from "vitest";

// cutName is loaded inside the test body, the AC-test convention for a target the build changes.

/** A high surrogate not followed by a low one, or a low surrogate not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("test index: the 500-unit name cut", () => {
  it("AC-4: a 501-unit test name whose units 499 and 500 are one surrogate pair is cut to 499 code units with no lone surrogate", async () => {
    const name = `${"a".repeat(499)}😀`;
    expect(name.length, "the name is 501 code units").toBe(501);
    expect(name.codePointAt(499), "units 499 and 500 are one surrogate pair").toBe(0x1f600);

    const { cutName } = (await import("../src/testIndex/text.js")) as unknown as {
      cutName: (name: string) => string;
    };
    const kept = cutName(name);
    expect(LONE_SURROGATE.test(kept), "the kept name holds no lone surrogate").toBe(false);
    expect(kept.length, "the kept name is 499 code units").toBe(499);
    expect(kept).toBe("a".repeat(499));
  }, 120_000);
});
