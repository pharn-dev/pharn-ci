import { describe, expect, it } from "vitest";
import {
  buildJunitResultsXml,
  buildUploadBundle,
  buildUploadMeta,
  check,
  parseJunitSources,
  parseJunitXml,
  type Report,
  withUploadOutcome,
  xmlAttribute,
} from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Flaky tests (A6): the normalised junit/results.xml the upload carries, rebuilt from the parsed cases (never the file
// itself), redacted and cut; and flaky.uploaded, true only for a stored archive that held it.
//
// No complete secret is written in this file (gitleaks, GitHub push protection): every secret is assembled at test time
// from a prefix and a run cut from ALPHABET, as ac-upload-redaction.test.ts does.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** `n` distinct characters of `from`, stepping 7 places from `seed`. */
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
  ].join("\n");
  return { text, secrets: [s01, s02, s03, s04, s05, s06, s07, s08a, s08b, s09, s10] };
}

/** XML text escaping for the seeded text outside an attribute. */
const xmlText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const META_REPORT_META = {
  event: "pull_request" as const,
  repository: "acme/widgets",
  headSha: "a".repeat(40),
  scope: "ci/check",
  runId: 1,
  runAttempt: 1,
  upload: { status: "skipped" as const },
};

function reportWith(junitFiles: { path: string; text: string }[]): Report {
  return check({
    version: "0.8.0",
    coverage: { text: "SF:src/a.ts\nDA:1,1\nend_of_record\n", format: "lcov" },
    diff: { parsed: [] },
    threshold: null,
    repoFiles: ["src/a.ts"],
    junit: parseJunitSources({ files: junitFiles }),
    meta: META_REPORT_META,
  });
}

describe("buildJunitResultsXml", () => {
  it("rebuilds basic.xml as the golden minimal JUnit document", () => {
    const results = parseJunitSources({ files: [{ path: "basic.xml", text: fixture("junit/basic.xml") }] });
    expect(buildJunitResultsXml(results)).toBe(fixture("junit/results.golden.xml"));
  });

  it("is itself JUnit pharn-ci reads back to the same ids and statuses", () => {
    const results = parseJunitSources({
      files: [
        { path: "basic.xml", text: fixture("junit/basic.xml") },
        { path: "nested.xml", text: fixture("junit/nested.xml") },
      ],
    });
    const again = parseJunitXml(buildJunitResultsXml(results), 1000);
    expect(again.ok && again.cases.map((c) => [c.id, c.status])).toEqual(results.cases.map((c) => [c.id, c.status]));
  });

  it("carries no system-out, system-err, properties or stack trace past the message", () => {
    const results = parseJunitSources({ files: [{ path: "basic.xml", text: fixture("junit/basic.xml") }] });
    const xml = buildJunitResultsXml(results);
    expect(xml).not.toContain("must never be kept");
    expect(xml).not.toContain("system-");
    expect(xml).not.toContain("property");
    expect(xml).not.toContain("math.test.ts:12:5");
  });

  it("cuts each failure message to min(messageMaxBytes, 2048) bytes", () => {
    const long = "é".repeat(3000);
    const xml = `<testsuite><testcase name="a"><failure message="${long}"/></testcase></testsuite>`;
    const results = parseJunitSources({ files: [{ path: "a.xml", text: xml }] });
    const message = (out: string) => /message="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(Buffer.byteLength(message(buildJunitResultsXml(results)), "utf8")).toBeLessThanOrEqual(2048);
    expect(
      Buffer.byteLength(message(buildJunitResultsXml(results, { messageMaxBytes: 300 })), "utf8"),
    ).toBeLessThanOrEqual(300);
    expect(
      Buffer.byteLength(message(buildJunitResultsXml(results, { messageMaxBytes: 65_536 })), "utf8"),
    ).toBeLessThanOrEqual(2048);
    expect(() => buildJunitResultsXml(results, { messageMaxBytes: 10 })).toThrow(RangeError);
  });

  it("escapes attributes and replaces what XML cannot carry", () => {
    expect(xmlAttribute('a&b<c>d"e\tf\ng\rh')).toBe("a&amp;b&lt;c&gt;d&quot;e&#9;f&#10;g&#13;h");
    expect(xmlAttribute("x\u0001y￾z\uD800")).toBe("x�y�z�");
    expect(xmlAttribute("\u{1F600}")).toBe("\u{1F600}");
  });

  it("leaves none of the S01 to S10 secrets of a seeded JUnit file in the results, in the report or in the meta", () => {
    const { text, secrets } = seeded();
    const junit = fixture("junit/secrets.xml.tmpl")
      .replaceAll("SEEDED_ATTR", xmlAttribute(text))
      .replaceAll("SEEDED_TEXT", xmlText(text))
      .replaceAll("SEEDED_CDATA", text);
    const results = parseJunitSources({ files: [{ path: "secrets.xml", text: junit }] });
    expect(results.parsed).toBe(1);
    // The parser kept them (the report never carries a message), so the redaction is what removes them.
    expect(JSON.stringify(results)).toContain(secrets[0]);
    const xml = buildJunitResultsXml(results);
    for (const secret of secrets) expect(xml).not.toContain(secret);
    expect(xml).toContain("[redacted:S01]");
    expect(xml).toContain("[redacted:S08]");
    expect(xml).toContain("[redacted]");

    const report = reportWith([{ path: "secrets.xml", text: junit }]);
    const meta = buildUploadMeta(report, { version: "0.8.0", createdAt: "2026-11-08T00:00:00.000Z", commentUrl: null });
    if (meta === null) throw new Error("no meta");
    const bundle = buildUploadBundle(report, meta, { junit: true });
    for (const secret of secrets) {
      expect(bundle.reportJson).not.toContain(secret);
      expect(bundle.metaJson).not.toContain(secret);
    }
  });
});

describe("flaky.uploaded", () => {
  const report = reportWith([{ path: "failing.xml", text: fixture("junit/failing.xml") }]);
  const meta = buildUploadMeta(report, { version: "0.8.0", createdAt: "2026-11-08T00:00:00.000Z", commentUrl: null });

  it("is true in the bundle only when the archive holds the results", () => {
    if (meta === null) throw new Error("no meta");
    expect(report.flaky?.uploaded).toBe(false);
    const withJunit = JSON.parse(buildUploadBundle(report, meta, { junit: true }).reportJson) as Report;
    expect(withJunit.flaky?.uploaded).toBe(true);
    expectValidReport(withJunit);
    const without = JSON.parse(buildUploadBundle(report, meta).reportJson) as Report;
    expect(without.flaky?.uploaded).toBe(false);
  });

  it("is set by an ok outcome that stored the results, and by nothing else", () => {
    const stored = withUploadOutcome(report, { status: "ok", runUrl: "https://pharn.dev/r/1", junit: true });
    expect(stored.flaky?.uploaded).toBe(true);
    expect(stored.meta?.upload).toEqual({ status: "ok", runUrl: "https://pharn.dev/r/1" });
    expectValidReport(stored);
    expect(withUploadOutcome(report, { status: "ok", runUrl: "https://pharn.dev/r/1" }).flaky?.uploaded).toBe(false);
    expect(withUploadOutcome(report, { status: "failed", reason: "put:network" }).flaky?.uploaded).toBe(false);
    expect(withUploadOutcome(report, { status: "too_large", maxBytes: null }).flaky?.uploaded).toBe(false);
    // The input is not changed.
    expect(report.flaky?.uploaded).toBe(false);
  });
});
