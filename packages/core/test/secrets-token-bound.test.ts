import { describe, expect, it } from "vitest";
import { findSecretSpans, MAX_TOKEN_BODY_CHARS } from "../src/secrets/spans.js";

// CORE-43: each prefixed secret shape (S01, S02, S03, S06, S07) reads at most MAX_TOKEN_BODY_CHARS body characters in
// one regular-expression match, which keeps the scan linear. A token longer than that is still read to the end of its
// run, so it is one span, redacted whole, exactly as the open quantifiers found it before; the bound changes time, not
// spans. Tokens are built from a fixed alphabet, so no real secret is written here.

const BODY = 2_000;

/** `length` characters of the body class, cycling through letters and digits (no digit when `digits` is false). */
function body(length: number, digits = true): string {
  const alphabet = digits ? "abcdefghijklmnopqrstuvwxyz0123456789" : "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[i % alphabet.length];
  return out;
}

const SHAPES: [id: string, prefix: string][] = [
  ["S01", "ghp_"],
  ["S01", "github_pat_"],
  ["S02", "sk-ant-"],
  ["S03", "sk-proj-"],
  ["S03", "sk-"],
  ["S06", "xoxb-"],
  ["S07", "sk_live_"],
];

describe("prefixed secret shapes read a bounded body per match (CORE-43)", () => {
  it("bounds a match at 512 body characters", () => {
    expect(MAX_TOKEN_BODY_CHARS).toBe(512);
  });

  for (const [id, prefix] of SHAPES) {
    it(`${id} ${prefix}: a ${BODY}-character body is one span to the end of the run`, () => {
      const token = `${prefix}${body(BODY)}`;
      const text = `key ${token} next`;
      expect(findSecretSpans(text)).toEqual([{ id, start: 4, end: 4 + token.length }]);
    });
  }

  it("S03 sk-: a body whose only digit lies past the bound is still a span, as before", () => {
    const token = `sk-${body(MAX_TOKEN_BODY_CHARS + 100, false)}7`;
    expect(findSecretSpans(`"${token}"`)).toEqual([{ id: "S03", start: 1, end: 1 + token.length }]);
  });

  it("a long run after a key character is no span, and a token after the run is still found", () => {
    const run = `a${"xoxb-".repeat(400)}`;
    const token = `xoxb-${body(40)}`;
    const text = `${run} ${token}`;
    expect(findSecretSpans(text)).toEqual([{ id: "S06", start: run.length + 1, end: text.length }]);
  });
});
