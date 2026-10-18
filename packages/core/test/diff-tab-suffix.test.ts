import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, stripTabSuffix } from "../src/diff/unified.js";
import { fixture } from "./helpers.js";

// The marker-path tab cut used a regex CodeQL flagged as polynomial (js/polynomial-redos) on diff input. The linear
// replacement must give exactly what the regex gave, line terminators inside the value included.

const REGEX = (raw: string) => raw.replace(/\t.*$/, "");

describe("stripTabSuffix", () => {
  const cases = [
    "",
    "a/foo.ts",
    "a/foo.ts\t2026-01-01 00:00:00",
    "a/with space.ts\t",
    "\t",
    "\t\t\t",
    "a\tb\tc",
    "a\tb\rc",
    "a\tb\rc\td",
    "a\tb c",
    "a b\tc",
    "a\tb\nc",
    "\r\t",
    "\t\r",
    `"a/sp\\303\\251cial.ts"\tx`,
  ];
  it.each(cases)("matches the regex on %j", (raw) => {
    expect(stripTabSuffix(raw)).toBe(REGEX(raw));
  });

  it("matches the regex on every mix of tab, CR, LF, separator and letter up to length 5", () => {
    const alphabet = ["\t", "\r", "\n", " ", "a"];
    const check = (prefix: string): void => {
      expect(stripTabSuffix(prefix)).toBe(REGEX(prefix));
      if (prefix.length < 5) for (const ch of alphabet) check(prefix + ch);
    };
    check("");
  });

  it("stays linear on a long run of tabs", () => {
    // The regex itself takes tens of seconds here, so the expected value is written out: no tab follows the CR.
    const raw = `${"\t".repeat(200_000)}\r`;
    expect(stripTabSuffix(raw)).toBe(raw);
    expect(stripTabSuffix(`${raw}x\ty`)).toBe(`${raw}x`);
  });

  it("leaves parseUnifiedDiff's result on the golden diff unchanged", () => {
    const files = parseUnifiedDiff(fixture("golden/pr.diff"));
    expect(files.map((f) => f.path)).toContain("src/math.ts");
  });
});
