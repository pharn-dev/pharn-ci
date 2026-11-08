import { describe, expect, it } from "vitest";
import { codePointName, isRtlLetter, scanInvisible } from "../src/injection/unicode.js";

// PI01's code point checks, one character class at a time. Every invisible character is built from its code point
// (`cp`), so this file holds none.

const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const plain = { bomAllowed: false, locale: false };

describe("PI01 code point checks", () => {
  it("names each flagged character by a fixed name and its code point", () => {
    const cases: [number, string][] = [
      [0x200b, "zero-width space U+200B"],
      [0x2060, "word joiner U+2060"],
      [0x2061, "invisible function application U+2061"],
      [0x2062, "invisible times U+2062"],
      [0x2063, "invisible separator U+2063"],
      [0x2064, "invisible plus U+2064"],
      [0xfeff, "zero-width no-break space U+FEFF"],
      [0x202a, "left-to-right embedding U+202A"],
      [0x202b, "right-to-left embedding U+202B"],
      [0x202c, "pop directional formatting U+202C"],
      [0x202d, "left-to-right override U+202D"],
      [0x202e, "right-to-left override U+202E"],
      [0x2066, "left-to-right isolate U+2066"],
      [0x2067, "right-to-left isolate U+2067"],
      [0x2068, "first strong isolate U+2068"],
      [0x2069, "pop directional isolate U+2069"],
      [0x00ad, "soft hyphen U+00AD"],
      [0x180e, "Mongolian vowel separator U+180E"],
      [0x200e, "left-to-right mark U+200E"],
      [0x200f, "right-to-left mark U+200F"],
      [0x061c, "Arabic letter mark U+061C"],
      [0x200c, "zero-width non-joiner U+200C"],
      [0x200d, "zero-width joiner U+200D"],
    ];
    for (const [code, name] of cases) {
      expect(scanInvisible(`a${cp(code)}b`, plain), name).toEqual({ first: name, count: 1 });
    }
  });

  it("leaves ASCII, accented Latin, CJK and ordinary emoji alone", () => {
    const latin = `caf${cp(0xe9)} na${cp(0xef)}ve`;
    for (const text of ["plain ASCII line", latin, cp(0x65e5, 0x672c, 0x8a9e), cp(0x1f600, 0x20, 0x1f44d)]) {
      expect(scanInvisible(text, plain), text).toBeNull();
    }
  });

  it("accepts a byte order mark only at the very start of a file's first line", () => {
    const bom = cp(0xfeff);
    expect(scanInvisible(`${bom}# Title`, { bomAllowed: true, locale: false })).toBeNull();
    expect(scanInvisible(`${bom}# Title`, plain)?.first).toBe("zero-width no-break space U+FEFF");
    expect(scanInvisible(`# ${bom}Title`, { bomAllowed: true, locale: false })?.count).toBe(1);
  });

  it("names tag characters as a block, and accepts them only inside a subdivision flag ended by the cancel tag", () => {
    const flag = cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0077, 0xe006c, 0xe0073, 0xe007f);
    expect(scanInvisible(`Wales ${flag}`, plain)).toBeNull();
    const unterminated = cp(0x1f3f4, 0xe0067, 0xe0062);
    expect(scanInvisible(unterminated, plain)).toEqual({ first: "tag character U+E0000-U+E007F", count: 2 });
    const smuggled = `ok${cp(0xe0041, 0xe0042, 0xe0043)}`;
    expect(scanInvisible(smuggled, plain)).toEqual({ first: "tag character U+E0000-U+E007F", count: 3 });
  });

  it("accepts ZWNJ and ZWJ between letters or marks of a non-Latin script, and between emoji parts", () => {
    const zwnj = cp(0x200c);
    const zwj = cp(0x200d);
    expect(scanInvisible(`${cp(0x0645, 0x06cc)}${zwnj}${cp(0x062e, 0x0648)}`, plain), "Persian").toBeNull();
    expect(scanInvisible(`${cp(0x0915, 0x094d)}${zwj}${cp(0x0937)}`, plain), "Devanagari").toBeNull();
    expect(scanInvisible(`${cp(0x1f469, 0x1f3fd)}${zwj}${cp(0x1f4bb)}`, plain), "skin tone").toBeNull();
    expect(scanInvisible(`${cp(0x1f3f3, 0xfe0f)}${zwj}${cp(0x1f308)}`, plain), "rainbow flag").toBeNull();
    // Between Latin letters, at the start or end of a line, or between a letter and an emoji: flagged.
    expect(scanInvisible(`a${zwj}b`, plain)?.first).toBe("zero-width joiner U+200D");
    expect(scanInvisible(`${zwnj}${cp(0x0645)}`, plain)?.first).toBe("zero-width non-joiner U+200C");
    expect(scanInvisible(`${cp(0x0645)}${zwnj}`, plain)?.first).toBe("zero-width non-joiner U+200C");
    expect(scanInvisible(`${cp(0x0645)}${zwj}${cp(0x1f600)}`, plain)?.first).toBe("zero-width joiner U+200D");
  });

  it("accepts the directional marks on a line with right-to-left letters, or in a locale file", () => {
    const rlm = cp(0x200f);
    expect(scanInvisible(`${cp(0x05e9, 0x05dc, 0x05d5, 0x05dd)} ${rlm}v1${rlm}`, plain)).toBeNull();
    expect(scanInvisible(`version ${rlm}v1`, plain)?.first).toBe("right-to-left mark U+200F");
    expect(scanInvisible(`version ${rlm}v1`, { bomAllowed: false, locale: true })).toBeNull();
    // An override is never legitimate, right-to-left text or not, locale file or not.
    expect(scanInvisible(`${cp(0x05e9)} ${cp(0x202e)}x`, { bomAllowed: false, locale: true })?.first).toBe(
      "right-to-left override U+202E",
    );
  });

  it("accepts the soft hyphen in a locale file only", () => {
    expect(scanInvisible(`co${cp(0xad)}operate`, { bomAllowed: false, locale: true })).toBeNull();
    expect(scanInvisible(`co${cp(0xad)}operate`, plain)?.first).toBe("soft hyphen U+00AD");
  });

  it("counts every flagged character of the line and names the first", () => {
    expect(scanInvisible(`${cp(0x202e)}a${cp(0x2066)}b${cp(0x2069)}c${cp(0x200b)}`, plain)).toEqual({
      first: "right-to-left override U+202E",
      count: 4,
    });
  });

  it("formats code points with at least four upper-case digits and knows the right-to-left blocks", () => {
    expect(codePointName(0xad)).toBe("U+00AD");
    expect(codePointName(0xe007f)).toBe("U+E007F");
    expect(isRtlLetter(0x05d0)).toBe(true);
    expect(isRtlLetter(0x0627)).toBe(true);
    expect(isRtlLetter(0x0041)).toBe(false);
  });
});
