import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Reads the repository's action.yml as text, the way GitHub sees it. (CORE-133: the README input-table check moved to
// packages/core/test/docs-contract.test.ts, which checks a row and its default for every input.)

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

describe("action.yml: the pr-number and head-sha inputs", () => {
  it("AC-10: action.yml declares both inputs optional with no default", () => {
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
  });
});
