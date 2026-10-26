import { describe, expect, it } from "vitest";
import { measureGrowth, threadCpuMs } from "./growth.js";

// findSecretSpans() and scanAgentConfigSecrets() are loaded inside the test body: the AC test is written before the
// redaction module exists, so nothing the build adds may run while the file loads.
// Growth is measured on this thread's CPU time with measureGrowth (growth.ts), after a warm-up call of each input; the
// slowest single call must finish within 15 s of CPU time.

type Span = { id: string; start: number; end: number };
interface Scanner {
  findSecretSpans(text: string): Span[];
  scanAgentConfigSecrets(files: readonly { path: string; text: string }[]): unknown[];
}

const COLON_SLASHES = ":" + "//";

/**
 * One unit of near-miss text: every pattern's anchor (prefixes too short or preceded by a key character, a public-key
 * BEGIN line, a URL with no password, short or env-referenced query values, secret-named keys with short, env or path
 * values, separators of every key/value form) and nothing that is a span. Repeated on one line, it makes the matcher
 * meet an anchor every few characters.
 */
const UNIT = [
  "sk-ab xghp_short gho_ ghs_x github_pat_x sk-ant-x sk-proj-x AIzaX AKIA12 ASIAx xoxb-ab sk_live_ab rk_live_x",
  "-----BEGIN PUBLIC KEY----- -----END PUBLIC KEY-----",
  `https${COLON_SLASHES}host.internal.io/a?token=$` + "{T}&api_key=short&secret=abc ftp" + COLON_SLASHES + "u@h",
  '"token": "short", "password": "$' + '{PW}", "secret_file": "/run/x", api_key: abc, key = "v", KEY=v',
  'export AUTH="x" --token=ab --api-key cd "--secret", "ef" Bearer Basic token :: == ,, "" ',
].join(" ");

/** `bytes` characters of near-miss text on one line. */
function oneLine(bytes: number): string {
  return UNIT.repeat(Math.ceil(bytes / UNIT.length)).slice(0, bytes);
}

/**
 * How the CPU time of `large` grows over `small` (measureGrowth, growth.ts), after one warm-up call of each that must
 * return a list; the slowest single call, read on this thread's CPU time, must finish within 15 s.
 */
async function growthOf(label: string, small: () => unknown, large: () => unknown) {
  for (const [side, fn] of [
    ["small", small],
    ["large", large],
  ] as const) {
    expect(Array.isArray(fn()), `${label}: the ${side} input's warm-up call returns a list`).toBe(true);
  }
  let slowest = 0;
  const timedCall = (fn: () => unknown) => () => {
    const start = threadCpuMs();
    fn();
    slowest = Math.max(slowest, threadCpuMs() - start);
  };
  const growth = await measureGrowth(timedCall(small), timedCall(large));
  expect(slowest, `${label}: the slowest call finishes within 15 s of CPU time`).toBeLessThan(15_000);
  return growth;
}

describe("A7 pattern matching grows close to linearly", () => {
  it("AC-20: a 512 KiB one-line input takes less than 8 times as long as a 128 KiB one", async () => {
    const { findSecretSpans, scanAgentConfigSecrets } = (await import("../src/index.js")) as unknown as Scanner;
    const small = oneLine(128 * 1024);
    const large = oneLine(512 * 1024);
    expect(findSecretSpans(small), "control: the near-miss text holds no span").toEqual([]);

    const spans = await growthOf(
      "findSecretSpans",
      () => findSecretSpans(small),
      () => findSecretSpans(large),
    );
    expect(spans.ratio, `findSecretSpans growth: ${spans.detail}`).toBeLessThan(8);

    const file = (text: string) => [{ path: ".mcp.json", text }];
    const smallFile = file(small);
    const largeFile = file(large);
    const scan = await growthOf(
      "scanAgentConfigSecrets",
      () => scanAgentConfigSecrets(smallFile),
      () => scanAgentConfigSecrets(largeFile),
    );
    expect(scan.ratio, `scanAgentConfigSecrets growth: ${scan.detail}`).toBeLessThan(8);
  }, 300_000);
});
