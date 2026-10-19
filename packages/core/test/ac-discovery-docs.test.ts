import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// README.md, action.yml, CHANGELOG.md and docs/THREAT-MODEL.md are read inside each test body, so a missing doc is
// a failed test, not a file that fails to load.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8").replace(/\r\n/g, "\n");

/** The text under the exact `<heading>` line, up to the next line starting with `stop` (### subsections included). */
function sectionText(markdown: string, heading: string, stop: string): string {
  const lines = markdown.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `section "${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith(stop));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The lines of action.yml's `coverage-file` input: its key line and every line indented deeper. */
function coverageFileInput(actionYml: string): string {
  const lines = actionYml.split("\n");
  const start = lines.findIndex((line) => /^ {2}coverage-file:\s*$/.test(line));
  expect(start, "action.yml input coverage-file").toBeGreaterThanOrEqual(0);
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !/^ {3,}/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

describe("docs: coverage auto-discovery", () => {
  it("AC-17: the README Quick start and CLI sections mention auto-discovery and examples/workflows/", () => {
    const readme = read("README.md");
    for (const heading of ["## Quick start", "## CLI"]) {
      const text = sectionText(readme, heading, "## ");
      expect(text, heading).toMatch(/auto-discover/i);
      expect(text, heading).toContain("examples/workflows/");
    }
  });

  it("AC-17: action.yml's coverage-file description says the path is auto-discovered when unset", () => {
    expect(coverageFileInput(read("action.yml"))).toMatch(/auto-discover/i);
  });

  it("AC-17: CHANGELOG.md has a line under 0.1.0 naming coverage auto-discovery", () => {
    // The change shipped in 0.1.0; before that release its line sat under Unreleased.
    const shipped = sectionText(read("CHANGELOG.md"), "## [0.1.0] - 2026-10-19", "## [");
    const items = shipped.split("\n").filter((line) => /^\s*[-*]\s/.test(line));
    expect(
      items.some((line) => /auto-discover/i.test(line) && /coverage/i.test(line)),
      "a 0.1.0 list line naming coverage auto-discovery",
    ).toBe(true);
  });

  it("AC-17: docs/THREAT-MODEL.md names coverage auto-discovery and the test that covers it", () => {
    const threatModel = read("docs/THREAT-MODEL.md");
    expect(threatModel).toMatch(/coverage auto-discovery/i);
    expect(threatModel).toContain("packages/node-io/test/ac-discovery-walk-rules.test.ts");
  });
});
