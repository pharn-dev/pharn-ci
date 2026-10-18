import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the repository's action.yml and README.md as text, the way GitHub and a reader see them.

const repoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** The lines of one input's block under the top-level `inputs:` key of action.yml, or undefined when absent. */
function inputBlock(actionYml: string, name: string): string[] | undefined {
  const lines = actionYml.split(/\r?\n/);
  const start = lines.indexOf("inputs:");
  if (start === -1) return undefined;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith(" ")) break;
    section.push(line);
  }
  const at = section.indexOf(`  ${name}:`);
  if (at === -1) return undefined;
  const block: string[] = [];
  for (const line of section.slice(at + 1)) {
    if (line !== "" && !line.startsWith("    ")) break;
    block.push(line);
  }
  return block;
}

/** The input table rows of README.md's `## Action reference` section, keyed by the input name in the first cell. */
function actionReferenceInputs(readme: string): Map<string, string> {
  const lines = readme.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Action reference");
  const rows = new Map<string, string>();
  if (start === -1) return rows;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const section = end === -1 ? rest : rest.slice(0, end);
  const header = section.findIndex((line) => /^\|\s*Input\s*\|/.test(line));
  if (header === -1) return rows;
  for (const line of section.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const first = line.split("|")[1]?.trim() ?? "";
    const name = /^`([^`]+)`$/.exec(first)?.[1];
    if (name) rows.set(name, line);
  }
  return rows;
}

describe("action.yml and README: the pr-number and head-sha inputs", () => {
  it("AC-10: action.yml declares both inputs optional with no default, and the README input table lists both", () => {
    const actionYml = repoFile("action.yml");
    for (const name of ["pr-number", "head-sha"]) {
      const block = inputBlock(actionYml, name);
      expect(block, `action.yml input ${name}`).toBeDefined();
      const keys = (block as string[]).map((line) => line.trim());
      expect(
        keys.some((line) => line.startsWith("description:")),
        `${name} description`,
      ).toBe(true);
      const required = keys.find((line) => line.startsWith("required:"));
      if (required !== undefined) expect(required).toBe("required: false");
      expect(
        keys.some((line) => line.startsWith("default:")),
        `${name} has no default`,
      ).toBe(false);
    }

    const rows = actionReferenceInputs(repoFile("README.md"));
    // The existing rows are found, so the table parse itself is sound.
    expect(rows.has("base-ref")).toBe(true);
    expect(rows.has("pr-number")).toBe(true);
    expect(rows.has("head-sha")).toBe(true);
  });
});
