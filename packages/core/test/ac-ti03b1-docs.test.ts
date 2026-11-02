import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The docs are read inside the test body: this AC test is written before the docs are updated.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The text under a `##`–`####` heading that includes `heading`, up to the next such heading. */
function sectionOf(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^#{2,4} /.test(line) && line.includes(heading));
  if (start === -1) throw new Error(`no section "${heading}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,4} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("TI03 skip evasions: docs", () => {
  it("AC-12: LIMITS names the line-by-line fallback without the test index, the pytestmark limits, and CHANGELOG Unreleased names TI03 and the in-body pytest.skip() change", () => {
    const misses = sectionOf(read("docs/LIMITS.md"), "What TI03 misses");
    expect(misses, "the fallback without the test index").toMatch(/without the test index/i);
    expect(misses.toLowerCase(), "the fallback reads line by line").toContain("line by line");
    expect(misses, "pytestmark is named").toContain("pytestmark");
    expect(misses, "a pytestmark set in conftest.py is not read").toContain("conftest.py");
    expect(misses, "nor one set through an assignment chain").toMatch(/assignment chain/i);
    expect(misses, "a multi-line pytestmark list").toMatch(/multi-line/i);
    expect(misses, "is read from its first line only").toMatch(/first line only/i);

    const changelog = read("CHANGELOG.md");
    const start = changelog.indexOf("## [Unreleased]");
    expect(start, "an Unreleased section").toBeGreaterThan(-1);
    const end = changelog.indexOf("\n## [", start + 1);
    const unreleased = changelog.slice(start, end === -1 ? undefined : end);
    expect(unreleased, "Unreleased names TI03").toContain("TI03");
    expect(unreleased, "Unreleased names the in-body pytest.skip() change").toContain("pytest.skip()");
  });
});
