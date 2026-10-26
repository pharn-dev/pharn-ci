import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Skylos nine, part 2: the notes column of the docs/PRECISION.md section 3 table says what each cell does not show:
// that the aliased pytest skip is caught too, which forms TI09 does not read, that TI15 exists and misses the
// hard-coded answer, and why the pytest always-true-matcher counts as caught while mock.ANY is missed. The document is
// read inside the test body.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SECTION_HEADING = "## 3. Skylos nine: what pharn-ci catches";

const lines = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The `## ` section with this exact heading: its heading line and the lines up to the next `## ` heading. */
function h2Section(text: string, heading: string): string[] {
  const all = lines(text);
  const start = all.indexOf(heading);
  if (start === -1) throw new Error(`docs/PRECISION.md has no "${heading}" heading`);
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return [heading, ...(end === -1 ? rest : rest.slice(0, end))];
}

/** The notes cell of each body row of the section's first table, by the row's case name. */
function notes(section: string[]): Map<string, string> {
  const start = section.findIndex((line) => line.trimStart().startsWith("|"));
  if (start === -1) throw new Error("the section has no table");
  const rest = section.slice(start);
  const end = rest.findIndex((line) => !line.trimStart().startsWith("|"));
  const rows = (end === -1 ? rest : rest.slice(0, end)).slice(2);
  const out = new Map<string, string>();
  for (const row of rows) {
    const cells = row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    out.set((cells[0] ?? "").replace(/^`(.*)`$/, "$1"), cells[3] ?? "");
  }
  return out;
}

describe("docs/PRECISION.md section 3: the notes column", () => {
  it("AC-9: the added-skip, deselect-setting, hard-coded-answer and always-true-matcher notes say what the cells do not, and the section holds no 2 of 9, 4 of 9 or 5 of 9", () => {
    const section = h2Section(readFileSync(`${ROOT}docs/PRECISION.md`, "utf8"), SECTION_HEADING);
    const byCase = notes(section);

    const skip = byCase.get("added-skip") ?? "";
    expect(skip, "added-skip: names the aliased @mark.skip").toContain("@mark.skip");
    expect(skip, "added-skip: says it is caught").toMatch(/\bcaught\b|\bcatches\b/i);

    const deselect = byCase.get("deselect-setting") ?? "";
    expect(deselect, "deselect-setting: names testpaths").toContain("testpaths");
    expect(
      deselect.includes("collect_ignore") || deselect.includes("PYTEST_ADDOPTS") || /(^|[\s`(])-c\b/.test(deselect),
      "deselect-setting: names collect_ignore, PYTEST_ADDOPTS or -c",
    ).toBe(true);

    expect(byCase.get("hard-coded-answer") ?? "", "hard-coded-answer: names TI15").toMatch(/\bTI15\b/);

    const matcher = byCase.get("always-true-matcher") ?? "";
    expect(matcher, "always-true-matcher: names mock.ANY").toContain("mock.ANY");
    expect(matcher, "always-true-matcher: says mock.ANY is missed").toMatch(
      /mock\.ANY[^|]*\bmiss|\bmiss[^|]*mock\.ANY/i,
    );
    expect(matcher, "always-true-matcher: names TI06").toMatch(/\bTI06\b/);
    expect(matcher, "always-true-matcher: names the == change").toContain("==");
    expect(matcher, "always-true-matcher: names the truthiness check").toMatch(/truth/i);
    expect(matcher, "always-true-matcher: names the helper's constant True").toContain("True");
    expect(matcher, "always-true-matcher: says TI06 does not catch the constant True").toMatch(/\bnot\b/i);

    const text = section.join("\n");
    for (const figure of ["2 of 9", "4 of 9", "5 of 9"]) expect(text, figure).not.toContain(figure);
  });
});
