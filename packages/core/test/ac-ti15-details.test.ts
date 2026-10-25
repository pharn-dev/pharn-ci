import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI15 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, and every literal below, built from parts so this file adds none of them as written. */
const ID = ["TI", "15"].join("");
const j = (...parts: string[]) => parts.join("");

/** A modified file that adds `lines` from line `at`. */
function addLines(path: string, at: number, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

/** A test file adding `expect(f(<lit>))` at line 8 and a source file comparing against it at line 12. */
const pair = (test: string, source: string, written: string) =>
  addLines(test, 8, [`  expect(f(${written})).toBe(1);`]) + addLines(source, 12, [`  if (s === ${written}) return 1;`]);

/** The escape the criterion names: U+0020–U+007E as itself except `\` and `"`, anything else as `\uXXXX`. */
function escapePieces(text: string): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const char = text[i] as string;
    if (char === "\\") pieces.push("\\\\");
    else if (char === '"') pieces.push('\\"');
    else if (unit >= 0x20 && unit <= 0x7e) pieces.push(char);
    else pieces.push(`\\u${unit.toString(16).padStart(4, "0")}`);
  }
  return pieces;
}

/** The bodies of the double-quoted segments of a detail, reading `\` as escaping the next character. */
function quotedSegments(detail: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < detail.length) {
    if (detail[i] !== '"') {
      i++;
      continue;
    }
    let body = "";
    i++;
    while (i < detail.length && detail[i] !== '"') {
      if (detail[i] === "\\" && i + 1 < detail.length) {
        body += detail.slice(i, i + 2);
        i += 2;
      } else {
        body += detail[i];
        i++;
      }
    }
    out.push(body);
    i++;
  }
  return out;
}

/** Printable ASCII, plus the one-character ellipsis a cut may end with: no raw character of a literal survives. */
const ELLIPSIS = String.fromCharCode(0x2026);
const E_ACUTE = String.fromCharCode(0xe9);
const U_UMLAUT = String.fromCharCode(0xfc);
const PRINTABLE = new RegExp(`^[\\x20-\\x7e${ELLIPSIS}]*$`);
const UNICODE = j("caf", E_ACUTE, "-", U_UMLAUT);
/** How the detail must write UNICODE: each non-ASCII code unit as a backslash, `u` and four hex digits. */
const UNICODE_ESCAPED = ["caf", "u00e9-", "u00fc"].join("\\");
/** Written in the diffed file as `'say "hi" \\ now'`: a double quote and a (written-escaped) backslash. */
const QUOTED = String.raw`say "hi" \\ now`;
/** 100 code units, a non-ASCII one every fourth, so a cut near 60 lands among escapes. */
const LONG = Array.from({ length: 100 }, (_, i) => (i % 4 === 3 ? E_ACUTE : String.fromCharCode(97 + (i % 26)))).join(
  "",
);
const TWIN = j("twin", "-value");
const FAR = j("far", "-away-value");
const LONG_TEST = `tests/${"deep/".repeat(56)}long.test.ts`;

describe("TI15: the detail escapes, cuts and names, and the per-file cap", () => {
  it("AC-9: details escape non-ASCII, quote and backslash, cut a long literal to 60 with an ellipsis on an escape boundary, name the first test file or fall back past 300 characters, and 25 matches give 20 signals on the lowest lines", async () => {
    const details: string[] = [];

    // Non-ASCII characters are written as \uXXXX.
    const unicode = signalsOf(await runDiff(pair("src/cafe.test.ts", "src/cafe.ts", `"${UNICODE}"`)), ID);
    expect(unicode).toHaveLength(1);
    const unicodeDetail = unicode[0]?.detail ?? "";
    details.push(unicodeDetail);
    expect(UNICODE_ESCAPED).toBe(escapePieces(UNICODE).join(""));
    expect(UNICODE_ESCAPED.length).toBe(3 + 6 + 1 + 6);
    expect(unicodeDetail.toLowerCase()).toContain(UNICODE_ESCAPED);

    // A double quote and a backslash are written as \" and \\.
    const quoted = signalsOf(await runDiff(pair("src/say.test.ts", "src/say.ts", `'${QUOTED}'`)), ID);
    expect(quoted).toHaveLength(1);
    const quotedDetail = quoted[0]?.detail ?? "";
    details.push(quotedDetail);
    expect(quotedDetail).toContain(escapePieces(QUOTED).join(""));
    expect(quotedDetail).toContain(String.raw`say \"hi\" \\\\ now`);

    // The 100-character literal is cut to at most 60 characters, ending in an ellipsis, never inside an escape.
    expect(LONG.length).toBe(100);
    const long = signalsOf(await runDiff(pair("src/long.test.ts", "src/long.ts", `"${LONG}"`)), ID);
    expect(long).toHaveLength(1);
    const longDetail = long[0]?.detail ?? "";
    details.push(longDetail);
    const pieces = escapePieces(LONG);
    const full = pieces.join("");
    expect(longDetail).not.toContain(full);
    const boundaries = new Set<number>([0]);
    let length = 0;
    for (const piece of pieces) {
      length += piece.length;
      boundaries.add(length);
    }
    const cut = quotedSegments(longDetail)
      .map((body) => {
        const ellipsis = body.endsWith("...") ? 3 : body.endsWith(ELLIPSIS) ? 1 : 0;
        return { body, kept: body.slice(0, body.length - ellipsis), ellipsis };
      })
      .filter((s) => s.ellipsis > 0 && s.kept.length > 0 && full.startsWith(s.kept));
    expect(cut, longDetail).toHaveLength(1);
    const [segment] = cut;
    expect(segment?.body.length, longDetail).toBeLessThanOrEqual(60);
    expect(boundaries.has(segment?.kept.length ?? -1), `cut splits an escape: ${longDetail}`).toBe(true);

    // A literal two test files add names the first of them in code-unit order.
    const twin =
      addLines("src/b.test.ts", 8, [`  expect(f("${TWIN}")).toBe(1);`]) +
      addLines("src/a.test.ts", 8, [`  expect(f("${TWIN}")).toBe(1);`]) +
      addLines("src/twin.ts", 12, [`  if (s === "${TWIN}") return 1;`]);
    const twinSignals = signalsOf(await runDiff(twin), ID);
    expect(twinSignals).toHaveLength(1);
    const twinDetail = twinSignals[0]?.detail ?? "";
    details.push(twinDetail);
    expect(twinDetail).toContain("src/a.test.ts");
    expect(twinDetail).not.toContain("src/b.test.ts");

    // A test path that would push the detail past 300 characters is replaced by "a test file in this change".
    expect(LONG_TEST.length).toBeGreaterThan(280);
    const far = signalsOf(await runDiff(pair(LONG_TEST, "src/far.ts", `"${FAR}"`)), ID);
    expect(far).toHaveLength(1);
    const farDetail = far[0]?.detail ?? "";
    details.push(farDetail);
    expect(farDetail).toContain("a test file in this change");
    expect(farDetail).not.toContain(LONG_TEST);
    expect(farDetail).toContain(FAR);

    // 25 matching condition literals in one source file give exactly 20 signals, on its lowest lines.
    const values = Array.from({ length: 25 }, (_, i) => j("lit-value-", String(i + 1).padStart(2, "0")));
    const many =
      addLines(
        "src/many.test.ts",
        8,
        values.map((v) => `  expect(f("${v}")).toBe(1);`),
      ) +
      addLines(
        "src/many.ts",
        10,
        values.map((v, i) => `  if (s === "${v}") return ${i};`),
      );
    const manySignals = signalsOf(await runDiff(many), ID);
    details.push(...manySignals.map((s) => s.detail));
    expect(manySignals.map((s) => `${s.path}:${s.line}`)).toEqual(
      Array.from({ length: 20 }, (_, i) => `src/many.ts:${10 + i}`),
    );

    for (const detail of details) {
      expect(detail.length, detail).toBeGreaterThan(0);
      expect(detail.length, detail).toBeLessThanOrEqual(300);
      expect(detail, detail).toMatch(PRINTABLE);
    }
  });
});
