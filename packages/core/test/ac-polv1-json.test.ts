import { describe, expect, it } from "vitest";

// The parser is imported inside the test body: the build writes it, after this test.

const SENTINEL = "SENTINEL_77ab";

describe("parsePolicyJson on unparseable text and a BOM", () => {
  it("AC-10: unparseable text gives one error at the root with one fixed message; a leading BOM is accepted", async () => {
    const { parsePolicyJson } = await import("@pharn-ci/core");

    const messages: string[] = [];
    for (const text of ['{"version":1,}', `{"version": ${SENTINEL}}`]) {
      const result = parsePolicyJson(text);
      expect(result.ok, text).toBe(false);
      if (result.ok) continue;
      expect(result.errors, text).toHaveLength(1);
      expect(result.errors[0]?.path, text).toBe("");
      const message = result.errors[0]?.message ?? "";
      expect(message, text).not.toContain(SENTINEL);
      messages.push(message);
    }
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);

    expect(parsePolicyJson(`﻿{"version":1}`).ok).toBe(true);
  });
});
