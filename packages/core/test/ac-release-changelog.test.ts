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

  it("AC-3: the extracted release notes are non-empty", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow, "release.yml still extracts the notes with this program").toContain(`'${AWK_PROGRAM}'`);
    expect(workflow).toContain('awk -v h="## [$VERSION]"');

    const extract = (version: string) =>
      execFileSync("awk", ["-v", `h=## [${version}]`, AWK_PROGRAM, fileURLToPath(repoFile("CHANGELOG.md"))], {
        encoding: "utf8",
      });
    expect(extract(releaseVersion()), "the extracted section has non-whitespace characters").toMatch(/\S/);
    // CORE-133: the checks that the 0.1.0 notes name each 0.1.0 feature and never say "lcov only" (CHANGELOG wording)
    // moved out.
  });
});
