import { describe, expect, it } from "vitest";

// Review finding 28: S02 (Anthropic), S06 (Slack) and S07 (Stripe live) had no near-miss case. Each near miss below
// is one step from its pattern (one character short, a wrong prefix letter, a test or publishable Stripe key), and
// each has a control: the full-length token of the same shape gives exactly one span of its id, so the near-miss
// assertions would not pass on a scanner that finds nothing.
//
// No complete secret is written in this file (the repository has a required gitleaks check and GitHub push
// protection). Every token is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

const ANTHROPIC = "sk-" + "ant-";
const SLACK_BOT = "xo" + "xb-";
const STRIPE_LIVE = "sk" + "_live_";

type Span = { id: string; start: number; end: number };

async function load() {
  const core = (await import("../src/index.js")) as unknown as { findSecretSpans(text: string): Span[] };
  return (text: string) => core.findSecretSpans(text).map(({ id, start, end }) => ({ id, start, end }));
}

const line = (token: string) => `id: ${token}\n`;

describe("S02, S06 and S07 near misses", () => {
  it("AC-1: the full-length S02, S06 and S07 tokens each give one span of their id (control)", async () => {
    const spans = await load();
    const controls: Array<[string, string]> = [
      ["S02", ANTHROPIC + cut(20, 1)],
      ["S06", SLACK_BOT + cut(10, 2)],
      ["S07", STRIPE_LIVE + cut(16, 3)],
    ];
    for (const [id, token] of controls) {
      const start = "id: ".length;
      expect(spans(line(token)), id).toEqual([{ id, start, end: start + token.length }]);
    }
  });

  it("AC-2: gives no span for an S02, S06 or S07 near miss", async () => {
    const spans = await load();
    const nearMisses: Array<[string, string]> = [
      ["an Anthropic key one character short", ANTHROPIC + cut(19, 1)],
      ["an Anthropic-like key with anth- for ant-", "sk-" + "anth-" + cut(24, 4)],
      ["a Slack token one character short", SLACK_BOT + cut(9, 2)],
      ["a Slack-like token with an unknown type letter", "xo" + "xz-" + cut(12, 5)],
      ["a Slack-like token with _ for -", "xo" + "xb_" + cut(12, 6)],
      ["a Stripe live key one character short", STRIPE_LIVE + cut(15, 3)],
      ["a Stripe test key", "sk" + "_test_" + cut(24, 7)],
      ["a Stripe publishable live key", "pk" + "_live_" + cut(24, 8)],
    ];
    for (const [label, token] of nearMisses) expect(spans(line(token)), label).toEqual([]);
  });
});
