import { describe, expect, it } from "vitest";

// findSecretSpans() and scanAgentConfigSecrets() are loaded inside the test body: the AC test is written before the
// redaction module exists, so nothing the build adds may run while the file loads.

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** Calls of `fn` per timed run: a run of a few milliseconds is otherwise decided by one preemption on a loaded host. */
const CALLS_PER_RUN = 4;

/**
 * The median of 3 timed runs of `fn` (each `CALLS_PER_RUN` calls), after one warm-up call; each run must finish within
 * 15 seconds.
 */
function timed(label: string, fn: () => unknown): number {
  fn();
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    for (let call = 0; call < CALLS_PER_RUN; call++) fn();
    const ms = performance.now() - start;
    expect(ms, `${label}: run ${i + 1} returns within 15 s`).toBeLessThan(15_000);
    runs.push(ms);
  }
  return median(runs);
}

describe("A7 pattern matching grows close to linearly", () => {
  it("AC-20: a 512 KiB one-line input takes less than 8 times as long as a 128 KiB one", async () => {
    const { findSecretSpans, scanAgentConfigSecrets } = (await import("../src/index.js")) as unknown as Scanner;
    const small = oneLine(128 * 1024);
    const large = oneLine(512 * 1024);
    expect(findSecretSpans(small), "control: the near-miss text holds no span").toEqual([]);

    const spansSmall = timed("findSecretSpans 128 KiB", () => findSecretSpans(small));
    const spansLarge = timed("findSecretSpans 512 KiB", () => findSecretSpans(large));
    // A floor of 1 ms keeps timer noise on a very fast small run from deciding the ratio.
    expect(spansLarge / Math.max(spansSmall, 1), "findSecretSpans growth").toBeLessThan(8);

    const file = (text: string) => [{ path: ".mcp.json", text }];
    const scanSmall = timed("scanAgentConfigSecrets 128 KiB", () => scanAgentConfigSecrets(file(small)));
    const scanLarge = timed("scanAgentConfigSecrets 512 KiB", () => scanAgentConfigSecrets(file(large)));
    expect(scanLarge / Math.max(scanSmall, 1), "scanAgentConfigSecrets growth").toBeLessThan(8);
  }, 300_000);
});
