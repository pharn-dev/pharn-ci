import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ti17-always-true-matcher-2, AC-22. docs/LIMITS.md and README.md are read inside the test body: the build edits them
// after this test is written.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");

/** The lines of the markdown section that starts with `heading`, up to the next heading of the same or higher level. */
function sectionOf(lines: string[], heading: string): string[] {
  const start = lines.indexOf(heading);
  expect(start, `the heading ${heading}`).toBeGreaterThan(-1);
  const level = (heading.match(/^#+/) ?? [""])[0].length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => {
    const m = /^(#+) /.exec(l);
    return m !== null && (m[1] as string).length <= level;
  });
  return end === -1 ? rest : rest.slice(0, end);
}

const cellsOf = (row: string) =>
  row
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

describe("docs/LIMITS.md and README.md describe TI17", () => {
  it("AC-22: LIMITS has a What TI17 misses subsection in place of the proposal that says TI17 warns and never blocks by default and names each miss; the parity and signal tables have a TI17 row; the message-code table has TEST_INTEGRITY_TI17; the Roadmap links #test-integrity and no longer names the always-passing matcher", () => {
    const limitsText = read("docs/LIMITS.md");
    expect(limitsText, "no proposal left").not.toContain(`${ID} proposal`);
    const limits = limitsText.split("\n");
    const notCaught = sectionOf(limits, "## What test integrity does not catch");
    const heading = `### What ${ID} misses`;
    expect(notCaught, "the subsection sits in What test integrity does not catch").toContain(heading);
    const subheadings = notCaught.filter((l) => l.startsWith("### "));
    expect(subheadings.at(-1), "in place of the proposal: the last subsection").toBe(heading);

    const misses = sectionOf(notCaught, heading).join(" ").replace(/\s+/g, " ");
    expect(misses, "TI17 warns").toMatch(/\bwarn/);
    expect(misses, "and never blocks by default").toMatch(/never blocks?/);
    expect(misses, "miss: defined outside the diff").toMatch(/outside the diff/);
    expect(misses, "miss: defined in another file").toMatch(/(another|other) file/);
    expect(misses, "miss: a constant computed indirectly").toMatch(/indirect/);
    expect(misses, "miss: anything not on added lines").toMatch(/added lines?/);
    expect(misses, "miss: a wildcard that replaces nothing the change removes").toMatch(/wildcard/);
    expect(misses, "miss: a wildcard that replaces nothing the change removes").toMatch(/remove/);
    expect(misses, "miss: the kept-text caps").toContain("5000");
    expect(misses, "miss: the kept-text caps").toContain("400");

    const parity = sectionOf(limits, "## Python parity");
    const parityRow = parity.find((l) => l.startsWith(`| ${ID} `));
    expect(parityRow, "the Python parity table has a TI17 row").toBeDefined();
    const parityCells = cellsOf(parityRow as string);
    expect(parityCells).toHaveLength(3);
    expect(parityCells[1], "JS/TS names a fixture").toMatch(/caught — `[^`]+`/);
    expect(parityCells[2], "Python names a fixture").toMatch(/caught — `[^`]+`/);

    const readme = read("README.md").split("\n");
    const integrity = sectionOf(readme, "## Test integrity");
    const signalRow = integrity.find((l) => l.startsWith(`| ${ID} |`));
    expect(signalRow, "the README signal table has a TI17 row").toBeDefined();
    const signalCells = cellsOf(signalRow as string);
    expect(signalCells).toHaveLength(5);
    expect(signalCells[2], "severity in mode block").toBe("`warn`");
    expect(signalCells[3], "JS/TS").toBe("yes");
    expect(signalCells[4], "Python").toBe("yes");

    expect(
      readme.some((l) => l.startsWith(`| \`${CODE}\``)),
      "the README message-code table has a TEST_INTEGRITY_TI17 row",
    ).toBe(true);

    const roadmap = sectionOf(readme, "## Roadmap").join(" ").replace(/\s+/g, " ");
    expect(roadmap, "the Roadmap still links Test integrity").toContain("(#test-integrity)");
    expect(roadmap, "the Roadmap no longer names the always-passing matcher").not.toMatch(/matcher that always passes/);
  });
});
