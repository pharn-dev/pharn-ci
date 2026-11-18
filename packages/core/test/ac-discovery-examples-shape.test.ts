import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The example workflows are read inside the test body, so a missing example is a failed test, not a file that fails
// to load. The YAML is read as text, line by line: the checks are about the shape a user copies. Wording (the header
// comments, the README) and the release a pin names are not checked here; docs-contract.test.ts checks that every pin
// names the root package.json version.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8").replace(/\r\n/g, "\n");

const EXAMPLES = ["vitest.yml", "jest.yml", "pytest.yml", "dotnet.yml", "cargo.yml"];

const PINNED_USES = /uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(.*)$/;
const PHARN_REF = /^pharn-dev\/pharn-ci@[0-9a-f]{40}$/;
// The GitHub expression is joined from parts, so it is not read as a JS template placeholder.
const GROUP = ["group: pharn-ci-", "$", "{{ github.event.pull_request.number || github.ref }}"].join("");

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The lines of the step (a `- ` item) that contains line `index`: from its `- ` line to the next line at or above its indent. */
function stepOf(lines: string[], index: number): string[] {
  let start = index;
  while (start >= 0 && !/^\s*-\s/.test(lines[start] ?? "")) start--;
  expect(start, `a step around line ${index + 1}`).toBeGreaterThanOrEqual(0);
  const indent = indentOf(lines[start] ?? "");
  const step = [lines[start] ?? ""];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) <= indent) break;
    step.push(line);
  }
  return step;
}

/** The lines of a top-level `<key>:` block: the key line and every indented or blank line after it. */
function topLevelBlock(lines: string[], key: string): string[] {
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `) || line === `${key}:\t`);
  expect(start, `top-level ${key}:`).toBeGreaterThanOrEqual(0);
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) === 0) break;
    block.push(line);
  }
  return block;
}

/** The value of a line before any ` #` comment, trimmed. */
const refOf = (value: string) => (value.split(" #")[0] ?? "").trim();

describe("examples/workflows/: the shape of each example", () => {
  it("AC-15: each example checks out with fetch-depth 0, has the permissions and concurrency, and runs pharn-ci with no with:", () => {
    for (const name of EXAMPLES) {
      const lines = read(`examples/workflows/${name}`).split("\n");

      const checkout = lines.findIndex((line) => /^\s*(?:-\s+)?uses:\s*actions\/checkout@/.test(line));
      expect(checkout, `${name}: an actions/checkout step`).toBeGreaterThanOrEqual(0);
      expect(
        stepOf(lines, checkout).some((line) => /^\s*fetch-depth:\s*0\s*$/.test(line)),
        `${name}: fetch-depth: 0 on the checkout step`,
      ).toBe(true);

      const permissions = topLevelBlock(lines, "permissions").map(refOf);
      expect(permissions, `${name}: permissions`).toContain("contents: read");
      expect(permissions, `${name}: permissions`).toContain("pull-requests: write");
      expect(permissions, `${name}: permissions`).toContain("id-token: write");

      const concurrency = topLevelBlock(lines, "concurrency").map((line) => line.trim());
      expect(concurrency, `${name}: concurrency group`).toContain(GROUP);

      const uses = lines
        .map((line, index) => ({ index, match: USES_LINE.exec(line) }))
        .filter((entry): entry is { index: number; match: RegExpExecArray } => entry.match !== null);
      // The pharn-ci step pins a commit SHA, like every other action (PINNED_USES below).
      const pharn = uses.filter(({ match }) => PHARN_REF.test(refOf(match[1] ?? "")));
      expect(pharn, `${name}: exactly one pharn-dev/pharn-ci@<SHA> step`).toHaveLength(1);
      expect(lines[pharn[0]?.index ?? -1], `${name}: the pharn-ci step's version comment`).toMatch(PINNED_USES);
      const step = stepOf(lines, pharn[0]?.index ?? -1);
      expect(
        step.some((line) => /^\s*(?:-\s+)?timeout-minutes:\s*5\s*$/.test(line)),
        `${name}: timeout-minutes: 5 on the pharn-ci step`,
      ).toBe(true);
      expect(
        step.some((line) => /^\s*(?:-\s+)?with:/.test(line)),
        `${name}: no with: on the pharn-ci step`,
      ).toBe(false);

      for (const { index } of uses) {
        if (index === pharn[0]?.index) continue;
        expect(lines[index], `${name}:${index + 1} pinned to a commit SHA with a version comment`).toMatch(PINNED_USES);
      }
      expect(uses.length, `${name}: at least one pinned uses: besides pharn-ci`).toBeGreaterThan(1);
    }
  });
});
