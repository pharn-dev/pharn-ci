import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

// AC tests for agent-setup-inventory (AC-8, AC-9, AC-10, AC-14). Targets are imported inside each
// test body so the file loads before the build; one `it` per AC.

type Summary = { byKind: Record<string, unknown>; tools: unknown[] };
type ReportLike = {
  agentSetup: { files: { path: string; kind: string }[]; summary?: Summary };
  messages: { code: string }[];
};

async function runCheck(repoFiles: string[]): Promise<ReportLike> {
  const { check } = await import("../src/check.js");
  return check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: 80,
    repoFiles,
  }) as unknown as ReportLike;
}

describe("agent setup summary (agent-setup-inventory)", () => {
  it("AC-8: adds agentSetup.summary for the golden inputs and validates against the schema", async () => {
    const report = await runCheck(fixture("golden/files.txt").trim().split("\n"));
    const summary = report.agentSetup.summary;
    const expectedByKind = {
      "agents-md": 1,
      "claude-md": 2,
      "claude-settings": 1,
      "claude-skill": 1,
      "copilot-instructions": 1,
      "cursor-rules": 1,
      "mcp-config": 1,
    };
    expect(summary?.byKind).toEqual(expectedByKind);
    expect(Object.keys(summary?.byKind ?? {})).toEqual(Object.keys(expectedByKind));
    expect(summary?.tools).toEqual(["claude-code", "codex", "copilot", "cursor", "mcp"]);
    expectValidReport(report);
  });

  it("AC-9: maps each kind to its agent tools", async () => {
    const mod = (await import("../src/setup/summary.js")) as unknown as {
      summarizeAgentSetup(files: readonly { path: string; kind: string }[]): Summary;
    };
    const expected: Record<string, string[]> = {
      "claude-md": ["claude-code"],
      "claude-local-md": ["claude-code"],
      "claude-settings": ["claude-code"],
      "claude-settings-local": ["claude-code"],
      "claude-skill": ["claude-code"],
      "claude-hook": ["claude-code"],
      "claude-agent": ["claude-code"],
      "claude-command": ["claude-code"],
      "agents-md": ["codex", "copilot", "cursor"],
      "cursor-rules": ["cursor"],
      "cursor-mcp": ["cursor", "mcp"],
      "copilot-instructions": ["copilot"],
      "copilot-instructions-scoped": ["copilot"],
      "copilot-agents": ["copilot"],
      "copilot-prompts": ["copilot"],
      "vscode-mcp": ["copilot", "mcp"],
      "codex-config": ["codex"],
      "gemini-md": ["gemini"],
      "windsurf-rules": ["windsurf"],
      "cline-rules": ["cline"],
      "mcp-config": ["mcp"],
    };
    const actual = Object.fromEntries(
      Object.keys(expected).map((kind) => [kind, mod.summarizeAgentSetup([{ path: "x", kind }]).tools]),
    );
    expect(actual).toEqual(expected);
  });

  it("AC-10: reports an empty summary and no summary line when there are no agent setup files", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");
    const report = await runCheck(["README.md", "src/math.ts", "src/new.ts"]);
    expect(report.agentSetup.summary).toEqual({ byKind: {}, tools: [] });
    expect(report.messages.map((m) => m.code)).toContain("NO_AGENT_SETUP_FILES");
    expectValidReport(report);
    const md = renderMarkdown(report as never);
    expect(md).toContain("_No agent setup files found._");
    expect(md.split("\n").filter((line) => line.startsWith("Agent setup:"))).toEqual([]);
  });

  it("AC-14: accepts a report without a summary and rejects an unknown tool or a string count", async () => {
    const { buildReport } = await import("../src/report.js");
    const built = buildReport({
      version: "0.1.0",
      agentSetup: { files: [{ path: "CLAUDE.md", kind: "claude-md" }] },
      threshold: 80,
      diffCoverage: {
        percent: 90,
        threshold: 80,
        coveredLines: 9,
        coverableLines: 10,
        files: [{ path: "a.ts", percent: 90, coveredLines: 9, coverableLines: 10, uncoveredLines: [3] }],
        meetsThreshold: true,
      },
    }) as unknown as ReportLike;
    const withSummary = (summary?: unknown) => ({
      ...built,
      agentSetup:
        summary === undefined ? { files: built.agentSetup.files } : { files: built.agentSetup.files, summary },
    });

    expect(validateReport(withSummary())).toBe(true);
    // A well-formed summary validates, so the rejections below come from the bad values themselves.
    expect(validateReport(withSummary({ byKind: { "claude-md": 1 }, tools: ["claude-code"] }))).toBe(true);
    expect(validateReport(withSummary({ byKind: { "claude-md": 1 }, tools: ["aider"] }))).toBe(false);
    expect(validateReport(withSummary({ byKind: { "claude-md": "1" }, tools: ["claude-code"] }))).toBe(false);
  });
});
