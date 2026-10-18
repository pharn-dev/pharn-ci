import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// README.md, action.yml and CHANGELOG.md are read inside the test body, so a missing doc is a failed test, not a file
// that fails to load.

const read = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** The lines from the first heading matching `heading` up to the next heading of the same or a higher level. */
const markdownSection = (markdown: string, heading: RegExp): string => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  expect(start, `a heading matching ${heading}`).toBeGreaterThanOrEqual(0);
  const level = (lines[start]?.match(/^#+/)?.[0] ?? "#").length;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = line.match(/^(#+) /)?.[1];
    return hashes !== undefined && hashes.length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

/** The indented block under `  <name>:` in action.yml's `inputs:`. */
const actionInputBlock = (actionYml: string, name: string): string => {
  const lines = actionYml.split("\n");
  const inputsAt = lines.indexOf("inputs:");
  expect(inputsAt, "action.yml has an inputs: block").toBeGreaterThanOrEqual(0);
  const start = lines.findIndex((line, index) => index > inputsAt && line === `  ${name}:`);
  expect(start, `inputs.${name}`).toBeGreaterThan(inputsAt);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim() !== "" && !/^ {3,}/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

/** The text of a key in an action.yml input block: an inline scalar or a `>`/`|` block, joined into one string. */
const blockField = (block: string, key: string): string => {
  const lines = block.split("\n");
  const at = lines.findIndex((line) => new RegExp(`^\\s+${key}:`).test(line));
  expect(at, `${key}:`).toBeGreaterThanOrEqual(0);
  const line = lines[at] ?? "";
  const indent = line.length - line.trimStart().length;
  const inline = line.slice(line.indexOf(":") + 1).trim();
  const more: string[] = [];
  for (const next of lines.slice(at + 1)) {
    if (next.trim() !== "" && next.length - next.trimStart().length <= indent) break;
    more.push(next.trim());
  }
  return [inline.replace(/^[>|][-+]?$/, ""), ...more].join(" ").trim();
};

const tableRows = (markdown: string) => markdown.split("\n").filter((line) => line.trimStart().startsWith("|"));

describe("docs: several coverage files and globs", () => {
  it("AC-20: the README, action.yml and the changelog document coverage lists, globs and each ecosystem", () => {
    const readme = read("README.md");

    // The quick start says @vitest/coverage-v8 must be a dev dependency, or shows installing it.
    const quickStart = markdownSection(readme, /^#{2,3} Quick start\b/i);
    expect(quickStart, "quick start names @vitest/coverage-v8").toContain("@vitest/coverage-v8");
    const devDependency = /dev[ -]?dependenc/i.test(quickStart);
    const install =
      /(npm (install|i) (--save-dev|-D)|pnpm (add|install) (-D|--save-dev)|yarn add (-D|--dev)|bun add (-d|-D|--dev))[^\n]*@vitest\/coverage-v8/.test(
        quickStart,
      );
    expect(devDependency || install, "quick start: a dev dependency, or an install command").toBe(true);

    // Several coverage entries and globs.
    expect(readme, "README mentions globs").toMatch(/\bglob/i);
    expect(readme, "README: --coverage is repeatable or coverage-file takes one entry per line").toMatch(
      /repeatable|one (entry |path )?per line/i,
    );

    // A table row for each ecosystem.
    const rows = tableRows(readme);
    const rowWith = (label: string, ...patterns: RegExp[]) =>
      expect(
        rows.some((row) => patterns.every((pattern) => pattern.test(row))),
        `a README table row for ${label}`,
      ).toBe(true);
    rowWith("vitest", /\bvitest\b/i);
    rowWith("jest", /\bjest\b/i);
    rowWith("pytest-cov", /pytest-cov/);
    rowWith("coverlet", /coverlet/i, /TestResults\/\*\*\/coverage\.cobertura\.xml/);
    rowWith("cargo-llvm-cov", /cargo-llvm-cov/);
    rowWith("Go with gcov2lcov", /\bGo\b/, /gcov2lcov/);
    rowWith("JaCoCo/Kover with a Cobertura converter", /JaCoCo/, /Kover/, /Cobertura/);

    // action.yml: coverage-file takes one entry per line and accepts globs.
    const description = blockField(actionInputBlock(read("action.yml"), "coverage-file"), "description");
    expect(description, "coverage-file description: one entry per line").toMatch(
      /one (entry |path |pattern )?per line|each line/i,
    );
    expect(description, "coverage-file description: globs").toMatch(/\bglob/i);

    // The changelog's Unreleased section mentions several coverage files and globs.
    const changelog = read("CHANGELOG.md").split("\n");
    const start = changelog.indexOf("## [Unreleased]");
    expect(start, "## [Unreleased]").toBeGreaterThanOrEqual(0);
    const after = changelog.slice(start + 1);
    const end = after.findIndex((line) => line.startsWith("## ["));
    const unreleased = (end === -1 ? after : after.slice(0, end)).join("\n");
    expect(unreleased, "Unreleased: several coverage files").toMatch(
      /(several|multiple|more than one)[^\n]*coverage (files|reports)/i,
    );
    expect(unreleased, "Unreleased: globs").toMatch(/\bglob/i);
  });
});
