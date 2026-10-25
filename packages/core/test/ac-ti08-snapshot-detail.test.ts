import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI08 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, built from parts so this file holds no literal a new source condition could compare against. */
const ID = ["TI", "08"].join("");

/** A modified file with one changed line. */
function modify(path: string): string {
  return `${[
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -3 +3 @@",
    '-exports[`view renders 1`] = `"old"`;',
    '+exports[`view renders 1`] = `"new"`;',
  ].join("\n")}\n`;
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Twelve snapshot names in mixed case: code-unit order puts upper case before lower case, which a locale-aware sort
 * would not. Each path is `<dir>/<name>.snap`, so no path is a substring of another.
 */
const NAMES = [
  "delta",
  "Bravo",
  "alpha",
  "Zulu",
  "echo",
  "Charlie",
  "foxtrot",
  "golf",
  "Hotel",
  "india",
  "Juliett",
  "kilo",
];

const SHORT = NAMES.map((n) => `src/__snapshots__/${n}.snap`);
/** About 150 characters each: the directory runs long, the names stay distinct. */
const LONG_DIR = `src/${"component-library/".repeat(7)}__snapshots__`;
const LONG = NAMES.map((n) => `${LONG_DIR}/${n}.snap`);

describe("TI08 (a): the detail names the count and the first counted paths", () => {
  it("AC-2: the short-path detail names 12 and exactly the first three paths in code-unit order; the long-path detail fits 300 characters, names 12 and only a leading run of those three", async () => {
    for (const path of LONG) {
      expect(path.length, path).toBeGreaterThanOrEqual(140);
      expect(path.length, path).toBeLessThanOrEqual(160);
    }

    const short = signalsOf(await runDiff(SHORT.map(modify).join("")), ID);
    expect(short).toHaveLength(1);
    const shortDetail = short[0]?.detail ?? "";
    expect(shortDetail.length).toBeLessThanOrEqual(300);
    expect(shortDetail).toMatch(/\b12\b/);
    const sortedShort = [...SHORT].sort(byCodeUnit);
    const firstThree = sortedShort.slice(0, 3);
    expect(firstThree).toEqual([
      "src/__snapshots__/Bravo.snap",
      "src/__snapshots__/Charlie.snap",
      "src/__snapshots__/Hotel.snap",
    ]);
    const named = sortedShort.filter((p) => shortDetail.includes(p));
    expect(named, shortDetail).toEqual(firstThree);
    const at = firstThree.map((p) => shortDetail.indexOf(p));
    expect(at, shortDetail).toEqual([...at].sort((a, b) => a - b));

    const long = signalsOf(await runDiff(LONG.map(modify).join("")), ID);
    expect(long).toHaveLength(1);
    const longDetail = long[0]?.detail ?? "";
    expect(longDetail.length, longDetail).toBeLessThanOrEqual(300);
    expect(longDetail).toMatch(/\b12\b/);
    const sortedLong = [...LONG].sort(byCodeUnit);
    const namedLong = sortedLong.filter((p) => longDetail.includes(p));
    expect(namedLong, longDetail).toEqual(sortedLong.slice(0, namedLong.length));
    expect(namedLong.length, longDetail).toBeLessThanOrEqual(3);
    const atLong = namedLong.map((p) => longDetail.indexOf(p));
    expect(atLong, longDetail).toEqual([...atLong].sort((a, b) => a - b));
  });
});
