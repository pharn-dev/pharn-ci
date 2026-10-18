import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// AC tests for agent-setup-inventory (AC-11, AC-12, AC-13). Targets are imported inside each test
// body so the file loads before the build; one `it` per AC. No snapshot: expected values are inline.

type SetupFile = { path: string; kind: string };

async function renderInventory(files: SetupFile[]): Promise<string> {
  const { buildReport } = await import("../src/report.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  const report = buildReport({
    version: "0.1.0",
    threshold: null,
    diffCoverage: {
      percent: null,
      threshold: null,
      coveredLines: 0,
      coverableLines: 0,
      files: [],
      meetsThreshold: true,
    },
    agentSetup: { files: files as never },
  });
  return renderMarkdown(report);
}

function skills(n: number): SetupFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `.claude/skills/s${String(i + 1).padStart(2, "0")}/SKILL.md`,
    kind: "claude-skill",
  }));
}

const FILE_ROW = /^\| `.*` \| claude-skill \|$/;

describe("agent setup rendering (agent-setup-inventory)", () => {
  it("AC-11: shows the summary line above the agent setup table for the golden inputs", async () => {
    const { check } = await import("../src/check.js");
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const md = renderMarkdown(
      check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
      }),
    );
    const lines = md.split("\n");
    const section = lines.indexOf("### 🤖 Agent setup (8 files)");
    const summaryLine = lines.indexOf(
      "Agent setup: 8 files · amp, claude-code, codex, copilot, cursor, jules, mcp, opencode, zed",
    );
    const header = lines.indexOf("| Path | Kind |");
    expect(section).toBeGreaterThanOrEqual(0);
    expect(summaryLine).toBeGreaterThan(section);
    expect(header).toBeGreaterThan(summaryLine);
    // Nothing but blank lines, the details tag and its summary between the summary line and the table header.
    expect(
      lines
        .slice(summaryLine + 1, header)
        .filter((l) => l.trim() !== "" && l !== "<details>" && l !== "<summary>Agent setup files (8)</summary>"),
    ).toEqual([]);
    expect(md).toBe(fixture("golden/report.md"));
  });

  it("AC-12: uses the singular for a one-file inventory", async () => {
    const md = await renderInventory([{ path: "AGENTS.md", kind: "agents-md" }]);
    expect(md.split("\n")).toContain("Agent setup: 1 file · amp, codex, copilot, cursor, jules, opencode, zed");
  });

  it("AC-13: collapses the table in a details block at every size and keeps the 50-row limit", async () => {
    // 25 files: the table is inside a details block whose summary names the count.
    const md25 = await renderInventory(skills(25));
    const lines25 = md25.split("\n");
    expect(lines25).toContain("Agent setup: 25 files · claude-code");
    const open25 = lines25.indexOf("<details>");
    const close25 = lines25.indexOf("</details>");
    const header25 = lines25.indexOf("| Path | Kind |");
    expect(lines25[open25 + 1]).toBe("<summary>Agent setup files (25)</summary>");
    expect(open25).toBeGreaterThan(lines25.indexOf("Agent setup: 25 files · claude-code"));
    expect(header25).toBeGreaterThan(open25);
    expect(close25).toBeGreaterThan(header25);

    // 26 files: summary line outside and before <details>, which holds the whole table.
    const lines26 = (await renderInventory(skills(26))).split("\n");
    const summary26 = lines26.indexOf("Agent setup: 26 files · claude-code");
    const open26 = lines26.indexOf("<details>");
    const close26 = lines26.indexOf("</details>");
    const header26 = lines26.indexOf("| Path | Kind |");
    expect(summary26).toBeGreaterThanOrEqual(0);
    expect(open26).toBeGreaterThan(summary26);
    expect(header26).toBeGreaterThan(open26);
    expect(close26).toBeGreaterThan(header26);
    const rows26 = lines26.map((l, i) => ({ l, i })).filter(({ l }) => FILE_ROW.test(l));
    expect(rows26).toHaveLength(26);
    for (const { i } of rows26) {
      expect(i).toBeGreaterThan(header26);
      expect(i).toBeLessThan(close26);
    }

    // 60 files: 50 file rows, then the "more files" row, all inside <details>.
    const lines60 = (await renderInventory(skills(60))).split("\n");
    const open60 = lines60.indexOf("<details>");
    const close60 = lines60.indexOf("</details>");
    const summary60 = lines60.indexOf("Agent setup: 60 files · claude-code");
    expect(summary60).toBeGreaterThanOrEqual(0);
    expect(open60).toBeGreaterThan(summary60);
    expect(close60).toBeGreaterThan(open60);
    const rowIdx60 = lines60.map((l, i) => (FILE_ROW.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(rowIdx60).toHaveLength(50);
    const last = rowIdx60[rowIdx60.length - 1] ?? -1;
    expect(lines60[last + 1]).toBe("| _…and 10 more files_ | |");
    expect(rowIdx60[0] ?? -1).toBeGreaterThan(open60);
    expect(last + 1).toBeLessThan(close60);
  });
});
