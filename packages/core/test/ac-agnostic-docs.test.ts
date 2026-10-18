import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// AC test for ai-agnostic-inventory (AC-15): the README kinds table and docs/LIMITS.md section 4. The files are
// read inside the test body.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

// The 21 kinds that existed before this change plus the 13 it adds, sorted.
const ALL_KINDS = [
  "agents-md",
  "aider-config",
  "amazonq-rules",
  "augment-rules",
  "claude-agent",
  "claude-command",
  "claude-hook",
  "claude-local-md",
  "claude-md",
  "claude-rule",
  "claude-settings",
  "claude-settings-local",
  "claude-skill",
  "cline-rules",
  "codex-config",
  "continue-rules",
  "conventions-md",
  "copilot-agents",
  "copilot-instructions",
  "copilot-instructions-scoped",
  "copilot-prompts",
  "cursor-mcp",
  "cursor-rules",
  "gemini-md",
  "gemini-settings",
  "goosehints",
  "junie-guidelines",
  "kiro-steering",
  "mcp-config",
  "opencode-config",
  "roo-rules",
  "vscode-mcp",
  "windsurf-rules",
  "zed-rules",
];

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

/** The body rows of the README table whose header is `| Kind | Matches | Tools |`. */
function kindsTableRows(readme: string): string[][] {
  const all = readme.split("\n");
  const header = all.findIndex((line) => /^\|\s*Kind\s*\|\s*Matches\s*\|\s*Tools\s*\|\s*$/.test(line));
  expect(header, "a | Kind | Matches | Tools | table in README.md").toBeGreaterThanOrEqual(0);
  const rows: string[][] = [];
  for (const line of all.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(cells(line));
  }
  return rows;
}

describe("documentation of the AI-agnostic inventory (ai-agnostic-inventory)", () => {
  it("AC-15: the README lists all 34 kinds with the new agents-md tools, and LIMITS §4 says 34 kinds and names Cody", () => {
    const rows = kindsTableRows(read("README.md"));
    const kinds = rows.map((row) => (row[0] ?? "").replace(/^`/, "").replace(/`$/, ""));
    expect(kinds).toHaveLength(34);
    expect([...kinds].sort()).toEqual(ALL_KINDS);
    const agentsMd = rows.find((row) => row[0] === "`agents-md`");
    expect(agentsMd?.[2]).toBe("amp, codex, copilot, cursor, jules, opencode, zed");

    const limits = read("docs/LIMITS.md");
    const start = limits.search(/^## 4\. /m);
    expect(start, "a ## 4. section in docs/LIMITS.md").toBeGreaterThanOrEqual(0);
    const rest = limits.slice(start + 1);
    const next = rest.search(/^## /m);
    const section = (next < 0 ? rest : rest.slice(0, next)).replace(/\s+/g, " ");
    expect(section).toMatch(/kinds detected are fixed[^.\d]{0,10}\b34\b/i);
    expect(section).toMatch(/deliberately not detected.*\bCody\b/i);
  });
});
