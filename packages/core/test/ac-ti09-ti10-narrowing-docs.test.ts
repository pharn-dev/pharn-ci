import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CORE-70: docs/LIMITS.md says what TI09 and TI10 now catch and still miss, and CHANGELOG.md names the fix.

const ROOT = new URL("../../../", import.meta.url);

/** The lines after the first line equal to `heading`, up to the first line that matches `end`. */
function sectionAfter(markdown: string, heading: string, end: RegExp): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`no heading "${heading}"`);
  const rest = lines.slice(start + 1);
  const stop = rest.findIndex((line) => end.test(line));
  return (stop === -1 ? rest : rest.slice(0, stop)).join("\n");
}

describe("CORE-70: the docs", () => {
  it("AC-15: LIMITS names the new TI09 keys and TI10 forms, drops the one-line limit, and CHANGELOG has a Fixed: line for TI09 and TI10 under Changed", () => {
    const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
    const limits = read("docs/LIMITS.md");

    const ti09 = sectionAfter(limits, "### What TI09 misses", /^#{1,6} /);
    for (const piece of [
      "`dir`",
      "`testNamePattern`",
      "`root`",
      "`roots`",
      "`modulePathIgnorePatterns`",
      "python_functions",
    ]) {
      expect(ti09, `What TI09 misses names ${piece}`).toContain(piece);
    }
    expect(ti09).toMatch(/new at head/);
    expect(ti09).toMatch(/narrowing key/);
    expect(ti09).toContain("`warn`");

    const ti10 = sectionAfter(limits, "### What TI10 misses", /^#{1,6} /);
    for (const piece of ["`|`", "`&`", "subshell", "`--exclude`", "`--testPathIgnorePatterns`"]) {
      expect(ti10, `What TI10 misses names ${piece}`).toContain(piece);
    }
    expect(ti10).not.toContain("one-line object");

    // The changelog keeps Added, Changed and Security under Unreleased (ac-release030-changelog-shape.test.ts); a fix
    // is a "Fixed:" item under Changed.
    const unreleased = sectionAfter(read("CHANGELOG.md"), "## [Unreleased]", /^## \[/).split("\n");
    expect(
      unreleased.some((line) => line.trim() === "### Fixed"),
      "no ### Fixed heading under Unreleased",
    ).toBe(false);
    const changed = unreleased.findIndex((line) => line.trim() === "### Changed");
    expect(changed, "a ### Changed heading under Unreleased").toBeGreaterThanOrEqual(0);
    const after = unreleased.slice(changed + 1);
    const next = after.findIndex((line) => line.startsWith("###"));
    const body = next === -1 ? after : after.slice(0, next);
    expect(
      body.some((line) => line.startsWith("- Fixed: ") && line.includes("TI09") && line.includes("TI10")),
      "a Changed item starting Fixed: that names TI09 and TI10",
    ).toBe(true);
  });
});
