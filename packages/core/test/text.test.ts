import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { byCodeUnit, cutCodeUnits, isUnsafeCode, replaceUnsafeChars, utf8ByteLength } from "../src/text.js";
import { buildUploadTar } from "../src/upload/tar.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

/** The set text.ts names, written out here as inclusive ranges so a change to it shows up as a failing test. */
const EXPECTED_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const inExpected = (code: number) => EXPECTED_RANGES.some(([from, to]) => code >= from && code <= to);

const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Characters to probe the comment renderer with: every range above, the code units next to each range (U+007E is left
 * out: the renderer backslash-escapes it, which is not stripping), and other
 * format, invisible and space characters (soft hyphen, Arabic letter mark, Mongolian vowel separator, word joiner and
 * the invisible operators, the deprecated format characters, no-break spaces, interlinear annotation marks).
 */
const PROBES: readonly number[] = [
  ...range(0x0000, 0x001f),
  0x0020,
  ...range(0x007f, 0x00a0),
  0x00ad,
  0x034f,
  0x061c,
  0x180e,
  ...range(0x2000, 0x2010),
  ...range(0x2027, 0x2030),
  ...range(0x205f, 0x206f),
  0x3000,
  ...range(0xfefe, 0xff00),
  ...range(0xfff9, 0xfffb),
];

describe("text.ts: the control, invisible and bidirectional character set", () => {
  it("isUnsafeCode holds for exactly the named ranges over every UTF-16 code unit", () => {
    const wrong: string[] = [];
    for (let code = 0; code <= 0xffff; code++) if (isUnsafeCode(code) !== inExpected(code)) wrong.push(hex(code));
    expect(wrong).toEqual([]);
  });

  it("replaceUnsafeChars replaces each character of the set one for one and leaves every other code unit alone", () => {
    let all = "";
    let safe = "";
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      all += String.fromCharCode(code);
      if (!inExpected(code)) safe += String.fromCharCode(code);
    }
    // Control: text without a character of the set comes back byte-identical, emoji and other scripts included.
    const plain = `${safe} café 😀 日本語`;
    expect(replaceUnsafeChars(plain, " ")).toBe(plain);
    expect(replaceUnsafeChars(plain, "�")).toBe(plain);

    const replaced = replaceUnsafeChars(all, "�");
    expect(replaced.length, "one code unit for one").toBe(all.length);
    for (let i = 0; i < all.length; i++) {
      const code = all.charCodeAt(i);
      if (inExpected(code)) expect(replaced[i], hex(code)).toBe("�");
      else if (replaced.charCodeAt(i) !== code) expect.fail(`${hex(code)} was changed`);
    }
    expect(replaceUnsafeChars("a‮b⁦c﻿", " ")).toBe("a b c ");
  });

  it("every character the comment renderer strips from message text today is in the set", () => {
    // The renderer (render/markdown.ts) has its own copy of the set. A DIFF_UNAVAILABLE message carries its detail as
    // given, so each probe goes into the comment through the renderer's message-text path, between two markers.
    const token = (code: number) => `qz${code.toString(16)}x${String.fromCharCode(code)}xk`;
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" },
      diff: { unavailable: PROBES.map(token).join(" ") },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: 80,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
    });
    expectValidReport(report);
    const markdown = renderMarkdown(report);
    // Every marker reaches the comment, so a missing token means the renderer changed the character between them.
    for (const code of PROBES) expect(markdown, hex(code)).toContain(`qz${code.toString(16)}x`);

    const stripped = PROBES.filter((code) => !markdown.includes(token(code)));
    expect(
      stripped.filter((code) => !isUnsafeCode(code)).map(hex),
      "stripped by the comment, not by report.json",
    ).toEqual([]);
    // Control: the probe sees what the renderer strips (the invisible and bidirectional characters among them) and
    // what it keeps (their neighbours), so the comparison above is not empty by accident.
    for (const code of [0x0009, 0x200b, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff]) {
      expect(stripped, `${hex(code)} is stripped by the comment`).toContain(code);
    }
    for (const code of [0x200a, 0x2010, 0x2030, 0x2065, 0x206a, 0xfefe, 0xff00]) {
      expect(stripped, `${hex(code)} is kept by the comment`).not.toContain(code);
    }
  });
});

describe("text.ts: byCodeUnit", () => {
  it("orders strings the way Array.prototype.sort does without a comparator, astral and BMP characters included", () => {
    const mixed = ["b", "😀", "￿", "A", "a", "é", "", "a😀", "a￿", "ab", "\ud83d", "\ude00", "日本語", "😀😀", "ａ"];
    expect([...mixed].sort(byCodeUnit)).toEqual([...mixed].sort());
    expect(byCodeUnit("😀", "￿"), "a surrogate sorts before U+FFFF, unlike code point order").toBe(-1);
    expect(byCodeUnit("a", "a")).toBe(0);
    expect(byCodeUnit("", "a")).toBe(-1);
  });
});

describe("text.ts: utf8ByteLength", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["é", 2],
    ["日", 3],
    ["😀", 4],
    ["a😀é日", 10],
    ["\ud83d", 3],
    ["\ude00", 3],
    ["a\ud83d", 4],
    ["\ud83db", 4],
    ["\ude00\ud83d", 6],
  ])("counts %j as %i bytes", (text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes);
  });

  it("agrees with the size the upload tar writes for the same text", () => {
    const fixtures = [
      "",
      "abc",
      "é",
      "日本語",
      "😀",
      "a😀é日",
      "\ud83d",
      "\ude00",
      "x\ud83d",
      "\ud83dx",
      "😀".repeat(200),
    ];
    for (const text of fixtures) {
      const tar = buildUploadTar([{ name: "a.txt", text }]);
      const size = Number.parseInt(new TextDecoder().decode(tar.subarray(124, 135)), 8);
      expect(size, JSON.stringify(text)).toBe(utf8ByteLength(text));
    }
  });
});

describe("text.ts: cutCodeUnits", () => {
  it("returns text that fits, even exactly at the limit, as it is", () => {
    expect(cutCodeUnits("abcd", 4)).toBe("abcd");
    expect(cutCodeUnits("abcd", 4, { marker: false })).toBe("abcd");
    expect(cutCodeUnits("ab😀", 4)).toBe("ab😀");
    expect(cutCodeUnits("", 0)).toBe("");
  });

  it("keeps the … inside the limit and, without the marker, cuts at the limit", () => {
    expect(cutCodeUnits("abcdef", 4)).toBe("abc…");
    expect(cutCodeUnits("abcdef", 4, { marker: false })).toBe("abcd");
    expect(cutCodeUnits("abcdef", 4).length).toBe(4);
  });

  it("never ends inside a pair: it steps back one unit, with or without the marker", () => {
    // limit 4 with the marker keeps 3 units: "ab" + high surrogate would split the pair.
    expect(cutCodeUnits("ab😀cd", 4)).toBe("ab…");
    // limit 3 without the marker keeps 3 units, the third a high surrogate.
    expect(cutCodeUnits("ab😀cd", 3, { marker: false })).toBe("ab");
    // The pair fits whole when the cut falls after it.
    expect(cutCodeUnits("ab😀cd", 5)).toBe("ab😀…");
  });

  it("keeps a lone low surrogate at the cut, since it splits no pair", () => {
    expect(cutCodeUnits("ab\ude00cd", 4)).toBe("ab\ude00…");
    expect(cutCodeUnits("ab\ude00cd", 3, { marker: false })).toBe("ab\ude00");
  });

  it("clamps the limit: 0 or less keeps nothing, so the marker cut is … alone (the one case longer than the limit)", () => {
    expect(cutCodeUnits("abc", 0)).toBe("…");
    expect(cutCodeUnits("abc", 1)).toBe("…");
    expect(cutCodeUnits("😀😀", 1)).toBe("…");
    expect(cutCodeUnits("abc", -5)).toBe("…");
    expect(cutCodeUnits("abc", 0, { marker: false })).toBe("");
    expect(cutCodeUnits("abc", -5, { marker: false })).toBe("");
    expect(cutCodeUnits("😀", 1, { marker: false }), "a pair is not split, so nothing is kept").toBe("");
  });
});
