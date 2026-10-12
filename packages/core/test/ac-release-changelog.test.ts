import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// These tests mirror the changelog checks of .github/workflows/release.yml (`Release verify`), for the version the
// workflow compares its input with: packages/action/package.json. Every file is read inside the test body.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8");
const releaseVersion = (): string => JSON.parse(read("packages/action/package.json")).version;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The `Extract release notes` program, byte for byte as release.yml runs it.
const AWK_PROGRAM = "index($0, h) == 1 { f = 1; next } /^## \\[/ { if (f) exit } f";
// The `Check version, tag and changelog` heading check, byte for byte.
const GREP_CHECK = 'grep -q "^## \\[$' + '{VERSION//./\\\\.}\\]" CHANGELOG.md';

describe("release readiness: CHANGELOG.md passes release.yml", () => {
  it("AC-2: has exactly one dated or placeholder heading for the version, below ## [Unreleased]", () => {
    expect(read(".github/workflows/release.yml"), "release.yml still checks the heading this way").toContain(
      GREP_CHECK,
    );

    const version = releaseVersion();
    const lines = read("CHANGELOG.md").split(/\r?\n/);
    const prefix = `## [${version}]`;

    const headings = lines.filter((line) => line.startsWith(prefix));
    expect(headings, `lines starting with ${prefix}`).toHaveLength(1);
    expect(headings[0]).toMatch(new RegExp(`^${escapeRegExp(prefix)} - (YYYY-MM-DD|\\d{4}-\\d{2}-\\d{2})$`));

    const firstSection = lines.findIndex((line) => line.startsWith("## ["));
    expect(lines[firstSection], "the first ## [ line").toBe("## [Unreleased]");
    expect(firstSection).toBeLessThan(lines.findIndex((line) => line.startsWith(prefix)));
  });

  it("AC-3: the extracted release notes are non-empty, complete and claim no lcov-only reading", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow, "release.yml still extracts the notes with this program").toContain(`'${AWK_PROGRAM}'`);
    expect(workflow).toContain('awk -v h="## [$VERSION]"');

    const extract = (version: string) =>
      execFileSync("awk", ["-v", `h=## [${version}]`, AWK_PROGRAM, fileURLToPath(repoFile("CHANGELOG.md"))], {
        encoding: "utf8",
      });
    expect(extract(releaseVersion()), "the extracted section has non-whitespace characters").toMatch(/\S/);

    // The completeness checks below describe what 0.1.0 shipped, so they read the 0.1.0 section only;
    // a later release's notes list only its own changes.
    const notes = extract("0.1.0");

    const named: Array<[string, RegExp]> = [
      ["Cobertura", /Cobertura/],
      ["coverage-format", /(?<![\w-])coverage-format(?![\w-])/],
      ["--coverage-format", /--coverage-format(?![\w-])/],
      ["coverage.format", /(?<![\w.])coverage\.format(?![\w])/],
      ["auto", /(?<![\w-])auto(?![\w-])/],
      ["diffCoverage.format", /diffCoverage\.format(?![\w])/],
      ["agentSetup.summary", /agentSetup\.summary(?![\w])/],
      ["coverage.exclude", /(?<![\w.])coverage\.exclude(?![\w])/],
      ["--exclude", /--exclude(?![\w-])/],
      ["the exclude input", /(?<![\w-])exclude`?\s+input/],
      ["diffCoverage.excludedFiles", /diffCoverage\.excludedFiles(?![\w])/],
    ];
    for (const [name, pattern] of named) {
      expect(notes, `release notes name ${name}`).toMatch(pattern);
    }

    const schema = read("schema/report.v1.json");
    const known = (label: string) => {
      const match = schema.match(new RegExp(`${label}: ([^.]+)\\.`));
      expect(match, `schema lists "${label}:"`).not.toBeNull();
      const items = (match?.[1] ?? "").split(",").map((item) => item.trim());
      expect(items.length, `${label} entries`).toBeGreaterThan(0);
      return items;
    };
    for (const code of known("Known codes")) {
      expect(notes, `release notes name message code ${code}`).toMatch(new RegExp(`(?<!\\w)${code}(?!\\w)`));
    }
    for (const kind of known("Known kinds")) {
      expect(notes, `release notes name setup kind ${kind}`).toMatch(
        new RegExp(`(?<![\\w-])${escapeRegExp(kind)}(?![\\w-])`),
      );
    }

    for (const phrase of ["lcov only", "lcov-only", "the lcov report"]) {
      expect(notes.toLowerCase(), `release notes never say "${phrase}"`).not.toContain(phrase);
    }
  });
});
