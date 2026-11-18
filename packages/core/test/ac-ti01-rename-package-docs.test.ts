import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The repository files are read inside each test body, so the file loads whatever their content is. AC-10 reads the
// "What TI01 misses" item of docs/LIMITS.md; AC-11 reads the Unreleased section of CHANGELOG.md.

const readRepoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** The `- **What TI01 misses.**` item: from that line to the next line starting `- ` or `#`. */
function ti01MissesItem(limits: string): string {
  const lines = limits.split("\n");
  const start = lines.findIndex((line) => line.startsWith("- **What TI01 misses.**"));
  if (start === -1) throw new Error('docs/LIMITS.md has no "- **What TI01 misses.**" item');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("- ") || line.startsWith("#"));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** Lower-cased, backticks removed, runs of whitespace folded to one space. */
const normalize = (text: string) => text.toLowerCase().replaceAll("`", "").replace(/\s+/g, " ");

/** The list items (a `- ` line with its indented continuation lines joined) under `### Changed` in `## [Unreleased]`. */
function unreleasedChangedItems(changelog: string): string[] | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => line.startsWith("## ["));
  const section = end === -1 ? after : after.slice(0, end);

  const changed = section.findIndex((line) => line.trim() === "### Changed");
  if (changed === -1) return null;
  const tail = section.slice(changed + 1);
  const next = tail.findIndex((line) => line.startsWith("### "));
  const group = next === -1 ? tail : tail.slice(0, next);

  const items: string[] = [];
  for (const line of group) {
    if (line.startsWith("- ")) items.push(line);
    else if (/^\s+\S/.test(line) && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

describe("docs: CORE-51 TI01 rename and package exemption", () => {
  it("AC-10: the TI01 entry of docs/LIMITS.md states the basename rename rule and the narrowed package exemption", () => {
    const item = normalize(ti01MissesItem(readRepoFile("docs/LIMITS.md")));

    expect(item).toContain("matches no test basename pattern");
    expect(item).toContain("counts as renamed away");
    expect(item).toContain("even when it stays in a test, tests or __tests__ directory");
    expect(item).toContain("only deleted js/ts and python source files of the package make a deleted test file info");
    expect(item).toContain("only when no js/ts or python file remains under the package directory at head");
  });

  // The repo keeps fixes under ### Changed as items that start "Fixed:" (ac-release030-changelog-shape pins the
  // Unreleased headings), so the line is looked for there.
  it("AC-11: CHANGELOG.md's Unreleased ### Changed group has a Fixed: line naming TI01 and both fixes", () => {
    const items = unreleasedChangedItems(readRepoFile("CHANGELOG.md"));

    expect(items, "## [Unreleased] has a ### Changed heading").not.toBeNull();
    const matching = (items ?? []).filter(
      (item) =>
        item.startsWith("- Fixed:") &&
        item.includes("TI01") &&
        item.includes("renamed") &&
        item.includes("`__tests__` directory") &&
        item.includes("package exemption"),
    );
    expect(matching.length, `a Fixed: item names TI01, both fixes: ${JSON.stringify(items)}`).toBeGreaterThan(0);
  });
});
