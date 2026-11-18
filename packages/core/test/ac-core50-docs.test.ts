import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// CORE-50 (binary-diff-not-blind). The docs are read inside the test body. LIMITS §5's `.gitattributes` bullet says what
// a file git shows as binary now gives and what is still missed; the README rows of TEST_INTEGRITY_TI01 and
// TEST_INTEGRITY_INDEX_UNAVAILABLE name the binary case; the Unreleased Changed list holds one `Fixed:` line naming
// `.gitattributes`.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** The text from the line that starts with `start` up to the next line that matches `end` (or the end). */
function section(text: string, start: string, end: RegExp): string {
  const lines = text.split("\n");
  const from = lines.findIndex((line) => line.startsWith(start));
  expect(from, `a line starting ${start}`).toBeGreaterThan(-1);
  const to = lines.findIndex((line, i) => i > from && end.test(line));
  return lines.slice(from, to === -1 ? undefined : to).join("\n");
}

/** The bullets of a Markdown list, each with its continuation lines joined by spaces. */
function bullets(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) out.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && out.length > 0) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out;
}

/** The README message-code table row of `code`. */
function row(readme: string, code: string): string {
  const rows = readme.split("\n").filter((line) => line.startsWith(`| \`${code}\``));
  expect(rows, `one README row for ${code}`).toHaveLength(1);
  return rows[0] as string;
}

describe("CORE-50: LIMITS, README and CHANGELOG name the binary case", () => {
  it("AC-21: the LIMITS §5 `.gitattributes` bullet says binary files are reported and names what is still missed; the README rows of TEST_INTEGRITY_TI01 and TEST_INTEGRITY_INDEX_UNAVAILABLE name the binary case; the Unreleased Changed list holds one Fixed: line naming .gitattributes", () => {
    const five = section(read("docs/LIMITS.md"), "## 5.", /^## \d+\./);
    const inputs = bullets(five).filter((b) => b.startsWith("**A PR controls the inputs that grade it.**"));
    expect(inputs, "one LIMITS §5 bullet on the inputs a PR controls").toHaveLength(1);
    const bullet = inputs[0] as string;
    expect(bullet).toContain(".gitattributes");
    expect(bullet).toMatch(/binary/);
    for (const what of ["test file", "`package.json`", "workflow", "test-runner config", "pharn-ci config"]) {
      expect(bullet, `the bullet names a ${what} git shows as binary`).toContain(what);
    }
    for (const id of ["TI01", "`TEST_INTEGRITY_INDEX_UNAVAILABLE`", "TI10", "TI11", "TI14"]) {
      expect(bullet, `the bullet names ${id}`).toContain(id);
    }
    for (const missed of ["TI13", "TI15", "TI08", "pytest", "language", "snapshot"]) {
      expect(bullet, `the bullet names what is still missed: ${missed}`).toContain(missed);
    }
    expect(bullet, "the bullet still names the .gitattributes change itself as missed").toMatch(
      /`\.gitattributes`[^.]*itself/,
    );

    const readme = read("README.md");
    expect(row(readme, "TEST_INTEGRITY_TI01"), "the TI01 row names the binary case").toMatch(/binary/);
    expect(
      row(readme, "TEST_INTEGRITY_INDEX_UNAVAILABLE"),
      "the TEST_INTEGRITY_INDEX_UNAVAILABLE row names the binary case",
    ).toMatch(/binary/);

    const unreleased = section(read("CHANGELOG.md"), "## [Unreleased]", /^## \[/);
    const changed = section(unreleased, "### Changed", /^### /);
    const fixed = bullets(changed).filter((b) => b.startsWith("Fixed:") && b.includes(".gitattributes"));
    expect(fixed, "one Unreleased Changed line starts with Fixed: and names .gitattributes").toHaveLength(1);
  });
});
