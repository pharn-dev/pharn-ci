import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The example workflows and README.md are read inside the test body, so a missing example is a failed test, not a
// file that fails to load. The YAML is read as text, line by line: the checks are about the shape a user copies.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8").replace(/\r\n/g, "\n");

const EXAMPLES = ["vitest.yml", "jest.yml", "pytest.yml", "dotnet.yml", "cargo.yml"];

const PINNED_USES = /uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*$/;
const USES_LINE = /^\s*(?:-\s+)?uses:\s*(.*)$/;
/** The commit the v0.11.0 tag points at (`git rev-list -n1 v0.11.0`). */
const V0110_SHA = "bd7b36ea07588884418f5002ae74afc35135c400";

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The lines under the exact `## <heading>` line, up to the next `## ` heading. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);
  expect(start, `README section "## ${heading}"`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end === -1 ? rest : rest.slice(0, end);
}

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

/** The ref of a `uses:` value, before any ` #` comment. */
const refOf = (value: string) => (value.split(" #")[0] ?? "").trim();

describe("examples/workflows/: the shape of each example", () => {
  it("AC-15: each example checks out with fetch-depth 0, has the permissions and concurrency, and runs pharn-ci with no with:", () => {
    const readme = read("README.md");
    const groupLine = section(readme, "Quick start").find((line) => line.trim().startsWith("group: pharn-ci-"));
    expect(groupLine, "README Quick start concurrency group line").toBeDefined();
    const group = (groupLine ?? "").trim();
    // The GitHub expression is joined from parts, so it is not read as a JS template placeholder.
    expect(group).toBe(["group: pharn-ci-", "$", "{{ github.event.pull_request.number || github.ref }}"].join(""));
    const idTokenLine = section(readme, "Quick start").find((line) => line.trim().startsWith("id-token: write #"));
    expect(idTokenLine, "README Quick start id-token: write line with a comment").toBeDefined();
    const idToken = (idTokenLine ?? "").trim();
    expect(idToken, "the id-token comment says what removing it does").toContain("no call to pharn.dev");

    for (const name of EXAMPLES) {
      const lines = read(`examples/workflows/${name}`).split("\n");

      // CORE-127: the header names what fails the step without a threshold, and never says the step never fails.
      const headerEnd = lines.findIndex((line) => !line.startsWith("#"));
      const header = lines.slice(0, headerEnd).join("\n");
      for (const id of ["(S01-S09)", "(PI01)", "(D05)", "(D04)", "threshold: 80"]) {
        expect(header, `${name}: the header names ${id}`).toContain(id);
      }
      expect(header, `${name}: the header does not say the step never fails`).not.toMatch(/never fails/);

      const checkout = lines.findIndex((line) => /^\s*(?:-\s+)?uses:\s*actions\/checkout@/.test(line));
      expect(checkout, `${name}: an actions/checkout step`).toBeGreaterThanOrEqual(0);
      expect(
        stepOf(lines, checkout).some((line) => /^\s*fetch-depth:\s*0\s*$/.test(line)),
        `${name}: fetch-depth: 0 on the checkout step`,
      ).toBe(true);

      const permissions = topLevelBlock(lines, "permissions").map((line) => line.trim());
      expect(permissions, `${name}: permissions`).toContain("contents: read");
      expect(permissions, `${name}: permissions`).toContain("pull-requests: write");
      // CORE-127: the README Quick start and every example grant id-token: write with the same one-line comment.
      expect(permissions, `${name}: the README Quick start's id-token line`).toContain(idToken);

      const concurrency = topLevelBlock(lines, "concurrency").map((line) => line.trim());
      expect(concurrency, `${name}: concurrency group`).toContain(group);

      const uses = lines
        .map((line, index) => ({ index, match: USES_LINE.exec(line) }))
        .filter((entry): entry is { index: number; match: RegExpExecArray } => entry.match !== null);
      // CORE-127: the pharn-ci step pins the v0.11.0 tag's commit SHA, like every other action (PINNED_USES below).
      const pharn = uses.filter(({ match }) => refOf(match[1] ?? "") === `pharn-dev/pharn-ci@${V0110_SHA}`);
      expect(pharn, `${name}: exactly one pharn-dev/pharn-ci@<v0.11.0 SHA> step`).toHaveLength(1);
      expect(lines[pharn[0]?.index ?? -1], `${name}: the pharn-ci step's version comment`).toMatch(/ # v0\.11\.0\s*$/);
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
