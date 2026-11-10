import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ti17-always-true-matcher-2, AC-23. CHANGELOG.md and docs/THREAT-MODEL.md are read inside the test body: the build
// edits them after this test is written.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const ID = ["TI", "17"].join("");
const CODE = ["TEST_INTEGRITY_", ID].join("");

const flat = (lines: string[]) => lines.join(" ").replace(/\s+/g, " ");

/** The lines under `heading` up to the next heading of the same or higher level. */
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

/** Blocks of a document: runs of lines split at blank lines, at numbered-list items and at table rows. */
function blocks(text: string): string[] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || /^\s*\d+\.\s/.test(line) || line.startsWith("|")) {
      if (current.length > 0) out.push(current);
      current = line.trim() === "" ? [] : [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) out.push(current);
  return out.map((b) => flat(b));
}

describe("CHANGELOG.md and docs/THREAT-MODEL.md record TI17", () => {
  it("AC-23: Unreleased names TI17 and TEST_INTEGRITY_TI17 under Added and, under Changed, the pass to warn move and the new schema id and policy key, with no new version heading; the threat model names TI17's scan of added test-file lines with linear time and the kept-text caps", () => {
    const changelog = read("CHANGELOG.md").split("\n");
    const versionHeadings = changelog.filter((l) => l.startsWith("## ["));
    const latest = versionHeadings.indexOf("## [0.10.0] - 2026-11-09");
    expect(latest, "the 0.10.0 heading").toBeGreaterThan(-1);
    expect(versionHeadings.slice(0, latest), "no version heading above 0.10.0 but Unreleased").toEqual([
      "## [Unreleased]",
    ]);

    const unreleased = sectionOf(changelog, "## [Unreleased]");
    const added = flat(sectionOf(unreleased, "### Added"));
    expect(added).toContain(ID);
    expect(added).toContain(CODE);
    const changed = flat(sectionOf(unreleased, "### Changed"));
    expect(changed, "Changed: a pull request can go from pass to warn").toMatch(/`?pass`? to `?warn`?/);
    expect(changed, "Changed: the new signal id in the report schema").toContain("schema/report.v2.json");
    expect(changed, "Changed: the new key in the policy schema").toContain("schema/policy.v1.json");
    expect(changed).toContain(ID);

    const passages = blocks(read("docs/THREAT-MODEL.md")).filter(
      (b) => b.includes(ID) && /linear/.test(b) && b.includes("5000") && b.includes("400"),
    );
    expect(passages.length, "a threat-model passage on TI17's scan with its bounds").toBeGreaterThan(0);
    expect(
      passages.some((b) => /added/.test(b) && /test/.test(b)),
      "the passage names the added test-file lines",
    ).toBe(true);
  });
});
