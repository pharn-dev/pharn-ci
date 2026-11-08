import { describe, expect, it } from "vitest";
import { check, type Report, renderMarkdown, type TestSources } from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Org-policy rule P13 through check(): the report validates against schema/report.v2.json, the POLICY_P13 message and
// the Policy section carry fixed words and paths only, and the sentinel strings planted in the fixtures never reach the
// report or the comment.

const p13 = (name: string) => fixture(`policy-rules/p13/${name}`);
const human = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });
const AGENT_FACTS = {
  pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [human("Widen the agent\n")] },
};
const HUMAN_FACTS = {
  pr: { author: { login: "octocat", type: "User" }, labels: [], commits: [human("Widen the agent\n")] },
};
const PATHS = [".claude/settings.json", ".mcp.json", ".github/workflows/ci.yml", ".github/CODEOWNERS"];
const SOURCES: TestSources = {
  base: {
    files: [
      { path: ".claude/settings.json", text: p13("settings/base.json.txt") },
      { path: ".github/CODEOWNERS", text: p13("codeowners/base.txt") },
      { path: ".github/workflows/ci.yml", text: p13("workflow/base.yml.txt") },
      { path: ".mcp.json", text: p13("mcp/base.json.txt") },
    ],
    dropped: [],
  },
  head: {
    files: [
      { path: ".claude/settings.json", text: p13("settings/toggles.json.txt") },
      { path: ".github/CODEOWNERS", text: p13("codeowners/owner-removed.txt") },
      { path: ".github/workflows/ci.yml", text: p13("workflow/write-all.yml.txt") },
      { path: ".mcp.json", text: p13("mcp/server-changed.json.txt") },
    ],
    dropped: [],
  },
};

function run(over: Record<string, unknown>): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: {
      parsed: PATHS.map((path) => ({ path, oldPath: path, status: "modified" as const, addedLines: [2] })),
    },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", ...PATHS, "src/a.ts"],
    policy: {
      source: "app",
      version: 4,
      fetchedAt: "2026-11-08T12:00:00.000Z",
      document: JSON.parse(p13("check/policy.json")),
    },
    agentPrFacts: AGENT_FACTS,
    selfModificationSources: SOURCES,
    ...over,
  } as never);
  expectValidReport(report);
  return report;
}

const p13Violations = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P13");

describe("org policy rule P13 through check()", () => {
  it("an agent PR widening its settings, MCP servers, a workflow and CODEOWNERS gets four block violations, one POLICY_P13 error, a failing verdict, and no fixture text anywhere", () => {
    const report = run({});
    expect(p13Violations(report).map((v) => [v.path, v.severity, v.detail])).toEqual([
      [
        ".claude/settings.json",
        "block",
        "agent PR widens its agent settings: permissions.additionalDirectories grew, disableAllHooks turned on, enableAllProjectMcpServers turned on, enabledMcpjsonServers grew, disabledMcpjsonServers shrank",
      ],
      [".github/CODEOWNERS", "block", "agent PR loosens CODEOWNERS: rules changed"],
      [".github/workflows/ci.yml", "block", "agent PR widens a workflow: permissions widened"],
      [".mcp.json", "block", "agent PR widens its MCP servers: server changed"],
    ]);
    const messages = report.messages.filter((m) => m.code === "POLICY_P13");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain(
      "in 4 files: `.claude/settings.json`, `.github/CODEOWNERS`, `.github/workflows/ci.yml`, `.mcp.json`.",
    );
    expect(messages[0]?.text).toContain("It counts as an agent PR by: a bot author; a known agent as author.");
    expect(report.verdict).toBe("fail");
    const markdown = renderMarkdown(report);
    expect(markdown).toContain("An agent PR may not widen its own or another agent's powers.");
    for (const text of [JSON.stringify(report), markdown]) {
      expect(text).not.toContain("SENTINEL");
      expect(text).not.toContain("acme");
    }
  });

  it("the same change by a person gets no P13 violation and no POLICY_P13 message", () => {
    const report = run({ agentPrFacts: HUMAN_FACTS });
    expect(p13Violations(report)).toEqual([]);
    expect(report.messages.filter((m) => m.code === "POLICY_P13")).toEqual([]);
  });

  it("without a policy, or without the sources, check() adds nothing for P13", () => {
    const none = run({ policy: undefined });
    expect(none.policy).toBeUndefined();
    expect(none.messages.filter((m) => m.code === "POLICY_P13")).toEqual([]);
    expect(p13Violations(run({ selfModificationSources: undefined }))).toEqual([]);
  });

  it("a missing diff fails closed with one path-less violation and its sentence", () => {
    const report = run({ diff: { unavailable: "git diff failed" } });
    expect(p13Violations(report).map((v) => [v.path, v.detail])).toEqual([
      [null, "diff unavailable; agent settings, MCP configs, workflows and CODEOWNERS could not be checked"],
    ]);
    const text = report.messages.find((m) => m.code === "POLICY_P13")?.text ?? "";
    expect(text).toContain("because the diff is unavailable");
  });
});
