import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The example workflows are read inside the test body, so a missing example is a failed test, not a file that fails
// to load. `run:` values are read as text: a one-line scalar, or the lines of a `|` / `>` block under it.

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(repoFile(path), "utf8").replace(/\r\n/g, "\n");

const COMMANDS: Record<string, string> = {
  "vitest.yml": "npx vitest run --coverage --coverage.reporter=lcov",
  "jest.yml": "npx jest --coverage --coverageReporters=lcov",
  "pytest.yml": "pytest --cov --cov-report=xml",
  "dotnet.yml": 'dotnet test --collect:"XPlat Code Coverage"',
  "cargo.yml": "cargo llvm-cov --lcov --output-path lcov.info",
};

const indentOf = (line: string) => line.length - line.trimStart().length;

/** Every `run:` value of a workflow, one string per command line. */
function runCommands(text: string): string[] {
  const lines = text.split("\n");
  const commands: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (match === null) return;
    const value = (match[2] ?? "").trim();
    if (/^[|>][-+]?$/.test(value)) {
      const indent = indentOf(line);
      for (const next of lines.slice(index + 1)) {
        if (next.trim() !== "" && indentOf(next) <= indent) break;
        if (next.trim() !== "") commands.push(next.trim());
      }
    } else {
      commands.push(value.replace(/^(["'])(.*)\1$/, "$2"));
    }
  });
  return commands;
}

describe("examples/workflows/: each example's test command", () => {
  it("AC-16: each example runs the command that writes its report to a discovery candidate", () => {
    for (const [name, command] of Object.entries(COMMANDS)) {
      const commands = runCommands(read(`examples/workflows/${name}`));
      expect(
        commands.some((line) => line.includes(command)),
        `${name}: a run: step with ${command}\n${commands.join("\n")}`,
      ).toBe(true);
    }
  });
});
