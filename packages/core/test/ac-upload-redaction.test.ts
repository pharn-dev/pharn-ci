import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// buildUploadBundle(), buildUploadMeta() and the item-26 redaction helpers are loaded from @pharn-ci/core inside each
// test body: the AC tests are written before the upload module exists, so nothing the build adds may run while this
// file loads.
//
// No complete secret is written in this file (gitleaks, GitHub push protection): every secret is assembled at test
// time from a prefix and a run cut from ALPHABET, as packages/core/test/ac-secrets-redact.test.ts does.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `n` distinct characters of `from`, stepping 7 places from `seed` (7 is coprime with 62 and 36). */
function cut(n: number, seed: number, from = ALPHABET): string {
  let s = "";
  for (let i = 0; i < n; i++) s += from[(seed + i * 7) % from.length];
  return s;
}

const keyLine = (kind: "BEGIN" | "END") => `-----${kind} RSA PRIVATE` + " KEY-----";
const COLON_SLASHES = ":" + "//";

/** One text holding every S01 to S10 shape, and the secret values that must not survive redaction. */
function seeded(): { text: string; secrets: string[] } {
  const s01 = "ghp" + "_" + cut(36, 1);
  const s02 = "sk-" + "ant-" + "api03-" + cut(32, 4);
  const s03 = "sk-" + "proj-" + cut(30, 5);
  const s04 = "AI" + "za" + cut(35, 7);
  const s05 = "AK" + "IA" + cut(16, 8, UPPER_DIGITS);
  const s06 = "xo" + "xb-" + cut(12, 9) + "-" + cut(12, 10);
  const s07 = "sk" + "_live_" + cut(24, 11);
  const s08a = cut(60, 15);
  const s08b = cut(40, 16);
  const s09 = cut(16, 12);
  const s10 = cut(28, 14);
  const text = [
    `alpha ${s01} bravo`,
    `charlie ${s02} delta`,
    `echo ${s03} foxtrot`,
    `golf ${s04} hotel`,
    `india ${s05} juliet`,
    `kilo ${s06} lima`,
    `mike ${s07} november`,
    `oscar https${COLON_SLASHES}deploy:${s09}@db.internal.io/app papa`,
    `quebec {"api` + `Key": "${s10}"} romeo`,
    `${keyLine("BEGIN")}\n${s08a}\n${s08b}\n${keyLine("END")}`,
    "tango uniform",
  ].join("\n");
  return { text, secrets: [s01, s02, s03, s04, s05, s06, s07, s08a, s08b, s09, s10] };
}

type Json = Record<string, unknown>;

interface UploadCore {
  buildUploadMeta(
    report: unknown,
    extra: { version: string; createdAt: string; commentUrl: string | null },
  ): Json | null;
  buildUploadBundle(
    report: unknown,
    meta: unknown,
    options?: { messageMaxBytes?: number },
  ): {
    reportJson: string;
    metaJson: string;
  };
  truncateUtf8(text: string, maxBytes: number): string;
  redactSecrets(text: string): string;
}

const load = async () => (await import("@pharn-ci/core")) as unknown as UploadCore;

const EXTRA = { version: "0.0.0-test", createdAt: "2026-10-26T12:00:00.000Z", commentUrl: null };
const utf8 = (text: string) => Buffer.byteLength(text, "utf8");
const LONG = "x".repeat(5000);

/** fixtures/golden/report.json with the seeded secret in every kind of place AC-3 names, plus a 5000-byte message. */
function seededReport(secret: string): Json {
  const golden = JSON.parse(read("fixtures/golden/report.json")) as Json;
  const diffCoverage = structuredClone(golden.diffCoverage) as { files: Json[] };
  (diffCoverage.files[0] as Json).path = `src/${secret}.ts`;
  return {
    ...golden,
    diffCoverage,
    messages: [
      ...(golden.messages as Json[]),
      { level: "warn", code: "TEST_INTEGRITY_TEXT_TRUNCATED", text: `seeded: ${secret}` },
      { level: "info", code: "COVERAGE_PATHS_PARTIALLY_UNMATCHED", text: LONG },
    ],
    testIntegrity: {
      ...(golden.testIntegrity as Json),
      signals: [
        {
          id: "TI09",
          severity: "warn",
          path: "vitest.config.ts",
          line: 6,
          detail: `detail ${secret}`,
          base: 'include: ["src/**/*.test.ts"]',
          head: `include: ["${secret}"]`,
        },
        { id: "TI10", severity: "warn", path: "package.json", line: null, detail: "y".repeat(3000) },
      ],
      testChanges: [{ name: `test ${secret}`, path: "src/a.test.ts", change: "removed" }],
    },
    meta: {
      event: "pull_request",
      repository: "acme/widgets",
      repositoryId: 42,
      prNumber: 7,
      headSha: "b".repeat(40),
      baseSha: "a".repeat(40),
      mergeBase: null,
      scope: `ci/${secret}`,
      runId: 9,
      runAttempt: 1,
      actor: `actor ${secret}`,
      upload: { status: "skipped" },
      prAuthor: { login: "claude[bot]", type: "Bot" },
      prLabels: ["agent", `label ${secret}`],
      coAuthors: [],
      agentHint: "claude-code",
      isAgentPr: true,
    },
  };
}

/** Every [path, value] leaf that is not a string, in traversal order, and every object key path. */
function shape(
  value: unknown,
  path = "$",
  out: { keys: string[]; leaves: Array<[string, unknown]> } = { keys: [], leaves: [] },
) {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) shape(v, `${path}[${i}]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      out.keys.push(`${path}.${key}`);
      shape(v, `${path}.${key}`, out);
    }
  } else if (typeof value !== "string") out.leaves.push([path, value]);
  return out;
}

const isExcerpt = (path: string) => /^\$\.testIntegrity\.signals\[\d+\]\.(base|head)$/.test(path);

// Core's index loads cold, which can take seconds on a loaded host.
describe("the upload bundle's redaction and caps", { timeout: 60_000 }, () => {
  it("AC-3: no seeded secret survives in either text, excerpts are dropped, the long message is cut, the rest is unchanged and the inputs are not mutated", async () => {
    const { buildUploadBundle, buildUploadMeta, redactSecrets } = await load();
    const { text, secrets } = seeded();
    // Control: item 26's redaction removes every seeded value from the seeded text.
    const redacted = redactSecrets(text);
    for (const secret of secrets) expect(redacted, "control").not.toContain(secret);

    const report = seededReport(text);
    const meta = buildUploadMeta(report, EXTRA);
    expect(meta).not.toBeNull();
    const reportBefore = structuredClone(report);
    const metaBefore = structuredClone(meta);

    const { reportJson, metaJson } = buildUploadBundle(report, meta);
    for (const secret of secrets) {
      expect(reportJson.includes(secret), "report.json holds a seeded secret").toBe(false);
      expect(metaJson.includes(secret), "meta.json holds a seeded secret").toBe(false);
    }

    const uploaded = JSON.parse(reportJson) as Json;
    for (const signal of (uploaded.testIntegrity as { signals: Json[] }).signals) {
      expect(Object.hasOwn(signal, "base")).toBe(false);
      expect(Object.hasOwn(signal, "head")).toBe(false);
    }

    const long = (uploaded.messages as Array<{ text: string }>).at(-1)?.text ?? "";
    expect(utf8(long)).toBeLessThanOrEqual(2048);
    expect(long).toMatch(/…\[\+\d+ bytes\]$/);

    // Keys, numbers, booleans and nulls are unchanged (the dropped excerpts aside).
    const before = shape(reportBefore);
    const after = shape(uploaded);
    expect(after.keys).toEqual(before.keys.filter((p) => !isExcerpt(p)));
    expect(after.leaves).toEqual(before.leaves);
    const metaShape = shape(JSON.parse(metaJson));
    expect(metaShape.keys).toEqual(shape(metaBefore).keys);
    expect(metaShape.leaves).toEqual(shape(metaBefore).leaves);

    expect(report).toEqual(reportBefore);
    expect(meta).toEqual(metaBefore);
  });

  it("AC-4: a cap of 100 cuts every message text and signal detail to 100 bytes, 4096 applies 2048, and 31 throws a RangeError", async () => {
    const { buildUploadBundle, buildUploadMeta, truncateUtf8, redactSecrets } = await load();
    const { text } = seeded();
    const report = seededReport(text);
    const meta = buildUploadMeta(report, EXTRA);

    const at100 = JSON.parse(buildUploadBundle(report, meta, { messageMaxBytes: 100 }).reportJson) as Json;
    const messages100 = at100.messages as Array<{ text: string }>;
    const signals100 = (at100.testIntegrity as { signals: Array<{ detail: string }> }).signals;
    expect(messages100.length).toBeGreaterThan(0);
    for (const m of messages100) expect(utf8(m.text)).toBeLessThanOrEqual(100);
    for (const s of signals100) expect(utf8(s.detail)).toBeLessThanOrEqual(100);
    expect(messages100.at(-1)?.text).toBe(truncateUtf8(LONG, 100));
    expect(signals100.at(-1)?.detail).toBe(truncateUtf8("y".repeat(3000), 100));
    expect(signals100[0]?.detail).toBe(truncateUtf8(redactSecrets(`detail ${text}`), 100));

    const at4096 = JSON.parse(buildUploadBundle(report, meta, { messageMaxBytes: 4096 }).reportJson) as Json;
    const atDefault = JSON.parse(buildUploadBundle(report, meta).reportJson) as Json;
    expect((at4096.messages as Array<{ text: string }>).at(-1)?.text).toBe(truncateUtf8(LONG, 2048));
    expect((at4096.testIntegrity as { signals: Array<{ detail: string }> }).signals.at(-1)?.detail).toBe(
      truncateUtf8("y".repeat(3000), 2048),
    );
    expect(at4096).toEqual(atDefault);

    expect(() => buildUploadBundle(report, meta, { messageMaxBytes: 31 })).toThrow(RangeError);
  });

  it("AC-4: a report without meta yields a report copy with no meta", async () => {
    const { buildUploadBundle, buildUploadMeta } = await load();
    const withMeta = seededReport("plain");
    const meta = buildUploadMeta(withMeta, EXTRA);
    const { meta: _meta, ...noMeta } = withMeta;
    const { reportJson } = buildUploadBundle(noMeta, meta);
    expect(Object.hasOwn(JSON.parse(reportJson) as Json, "meta")).toBe(false);
  });
});
