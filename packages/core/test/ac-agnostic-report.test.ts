import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport, validateReport } from "./schema.js";

// AC tests for ai-agnostic-inventory (AC-12..AC-14): the report, the schema's open tool list and the golden
// outputs. check(), buildReport(), the config parser and the renderer are loaded inside each test body so the
// file loads before the build; one `it` per AC. The goldens are compared with toBe, never a snapshot, so a
// regenerated golden cannot make these pass by construction.

const REPO_ROOT = "/home/runner/work/demo/demo";

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("../src/check.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  const { buildReport } = await import("../src/report.js");
  return { check, parseConfig, renderMarkdown, buildReport };
}

// An Aider-only repo: a two-line new file, one line covered.
const AIDER_LCOV = ["TN:", "SF:src/a.ts", "DA:1,1", "DA:2,0", "end_of_record", ""].join("\n");
const AIDER_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = 2;",
  "",
].join("\n");

describe("AI-agnostic agent setup in the report (ai-agnostic-inventory)", () => {
  it("AC-12: an Aider-only repo gets an inventory, an aider summary, no NO_AGENT_SETUP_FILES and a valid report", async () => {
    const { check, renderMarkdown } = await load();
    const report = check({
      version: "0.1.0",
      coverage: { text: AIDER_LCOV, format: "lcov" },
      diff: { text: AIDER_DIFF },
      threshold: null,
      repoFiles: [".aider.conf.yml", "CONVENTIONS.md", "src/a.ts"],
    });

    expect(report.agentSetup.files).toEqual([
      { path: ".aider.conf.yml", kind: "aider-config" },
      { path: "CONVENTIONS.md", kind: "conventions-md" },
    ]);
    expect(report.agentSetup.summary).toEqual({
      byKind: { "aider-config": 1, "conventions-md": 1 },
      tools: ["aider"],
    });
    expect(report.messages.map((message) => message.code)).not.toContain("NO_AGENT_SETUP_FILES");
    expectValidReport(report);
    expect(renderMarkdown(report).split("\n")).toContain("Agent setup: 2 files · aider");
  });

  it("AC-13: the schema accepts known and future tool names and the claude-rule kind, and rejects malformed tools", async () => {
    const { buildReport } = await load();
    const base = buildReport({
      version: "0.1.0",
      diffCoverage: null,
      threshold: null,
      missing: { reason: "diff-unavailable", detail: "no base" },
      agentSetup: { files: [{ path: "CLAUDE.md", kind: "claude-md" }] },
    }) as unknown as Record<string, unknown>;
    expectValidReport(base);

    const withSetup = (files: { path: string; kind: string }[], byKind: Record<string, number>, tools: unknown[]) => ({
      ...base,
      agentSetup: { files, summary: { byKind, tools } },
    });
    const claudeMd = [{ path: "CLAUDE.md", kind: "claude-md" }];
    const withTools = (tools: unknown[]) => withSetup(claudeMd, { "claude-md": 1 }, tools);

    const accepted = {
      '["aider"]': withTools(["aider"]),
      '["amazon-q","zed"]': withTools(["amazon-q", "zed"]),
      '["some-future-tool"]': withTools(["some-future-tool"]),
      "claude-rule file and byKind": withSetup(
        [{ path: ".claude/rules/style.md", kind: "claude-rule" }],
        { "claude-rule": 1 },
        ["claude-code"],
      ),
    };
    const rejected = {
      '["Aider"]': withTools(["Aider"]),
      '[""]': withTools([""]),
      '["../x"]': withTools(["../x"]),
      "[1]": withTools([1]),
      '["aider","aider"]': withTools(["aider", "aider"]),
    };

    const verdicts = (cases: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(cases).map(([name, report]) => [name, validateReport(report)]));
    expect({ accepted: verdicts(accepted), rejected: verdicts(rejected) }).toEqual({
      accepted: Object.fromEntries(Object.keys(accepted).map((name) => [name, true])),
      rejected: Object.fromEntries(Object.keys(rejected).map((name) => [name, false])),
    });
  });

  it("AC-14: the golden reports credit AGENTS.md to the new tools, keep byKind, and equal their golden files", async () => {
    const { check, parseConfig, renderMarkdown } = await load();

    const golden = check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: lines("golden/files.txt"),
    });
    const cobertura = check({
      version: "0.1.0",
      coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" },
      diff: { text: fixture("golden-cobertura/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: lines("golden-cobertura/files.txt"),
    });
    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const exclusions = check({
      version: "0.1.0",
      coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden-exclusions/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: config.coverage?.threshold ?? null,
      repoFiles: lines("golden-exclusions/files.txt"),
      exclude: config.coverage?.exclude ?? [],
    });

    const goldenByKind = {
      "agents-md": 1,
      "claude-md": 2,
      "claude-settings": 1,
      "claude-skill": 1,
      "copilot-instructions": 1,
      "cursor-rules": 1,
      "mcp-config": 1,
    };
    const goldenTools = ["amp", "claude-code", "codex", "copilot", "cursor", "jules", "mcp", "opencode", "zed"];
    const goldenLine = "Agent setup: 8 files · amp, claude-code, codex, copilot, cursor, jules, mcp, opencode, zed";

    for (const [dir, report] of [
      ["golden", golden],
      ["golden-cobertura", cobertura],
    ] as const) {
      expectValidReport(report);
      expect(report.agentSetup.summary, dir).toEqual({ byKind: goldenByKind, tools: goldenTools });
      const md = renderMarkdown(report);
      expect(md.split("\n"), dir).toContain(goldenLine);
      expect(asFile(report), `${dir}/report.json`).toBe(fixture(`${dir}/report.json`));
      expect(md, `${dir}/report.md`).toBe(fixture(`${dir}/report.md`));
    }

    expectValidReport(exclusions);
    expect(exclusions.agentSetup.summary).toEqual({
      byKind: { "agents-md": 1, "claude-md": 1 },
      tools: ["amp", "claude-code", "codex", "copilot", "cursor", "jules", "opencode", "zed"],
    });
    const exclusionsMd = renderMarkdown(exclusions);
    expect(exclusionsMd.split("\n")).toContain(
      "Agent setup: 2 files · amp, claude-code, codex, copilot, cursor, jules, opencode, zed",
    );
    expect(asFile(exclusions), "golden-exclusions/report.json").toBe(fixture("golden-exclusions/report.json"));
    expect(exclusionsMd, "golden-exclusions/report.md").toBe(fixture("golden-exclusions/report.md"));
  });
});
