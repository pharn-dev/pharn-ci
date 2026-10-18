import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// main() and the fixtures are loaded inside each test body: the AC tests are written before --expect-agent-setup and
// fixtures/setup-expect/ exist, so nothing that depends on them may run while the file loads. The CLI runs against
// in-memory deps: a repo at /repo, run from /repo/sub, whose git returns the golden diff and a tracked-files list
// with CLAUDE.md as its only agent setup file (no Cursor setup file), and records every git call.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const CONFIG = "/repo/.pharn/ci.yml";

/** The fixed agent tool list, as the SPEC names it. */
const AGENT_TOOLS = [
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "gemini",
  "windsurf",
  "cline",
  "mcp",
  "aider",
  "amazon-q",
  "amp",
  "augment",
  "continue",
  "goose",
  "jules",
  "junie",
  "kiro",
  "opencode",
  "roo",
  "zed",
];

async function runCli(flags: string[], config?: string) {
  const { main } = await import("../src/main.js");
  const tracked = fixture("setup-expect/claude-only.txt").trim().split("\n");
  const files: Record<string, string> = {
    "/repo/sub/lcov.info": fixture("golden/coverage.info").replaceAll("/home/runner/work/demo/demo", "/repo"),
    ...(config === undefined ? {} : { [CONFIG]: config }),
  };
  const gitCalls: string[][] = [];
  let out = "";
  let err = "";
  const deps = {
    cwd: "/repo/sub",
    async git(args: string[]) {
      gitCalls.push(args);
      if (args[0] === "rev-parse") return "/repo\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      if (args[0] === "ls-files") return `${tracked.join("\0")}\0`;
      if (args[0] === "ls-tree") return "";
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    async readFile(path: string) {
      return files[path] ?? null;
    },
    resolvePath: (...segments: string[]) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    stdout: (text: string) => {
      out += text;
    },
    stderr: (text: string) => {
      err += text;
    },
  };
  const code = await main(["check", "--coverage", "lcov.info", "--format", "json", ...flags], deps as never);
  return { code, stdout: out, stderr: err, gitCalls };
}

type Report = { verdict: string; agentSetup: { missing?: string[] } };

describe("pharn-ci check --expect-agent-setup", () => {
  it("AC-8: names the expected tools with no setup file in the JSON report and exits 0, adding to setup.expect", async () => {
    const { EXIT_OK } = await import("../src/main.js");
    for (const [label, flags, config, missing] of [
      ["one flag", ["--expect-agent-setup", "cursor"], undefined, ["cursor"]],
      [
        "repeated flag",
        ["--expect-agent-setup", "cursor", "--expect-agent-setup", "gemini"],
        undefined,
        ["cursor", "gemini"],
      ],
      [
        "flag plus setup.expect",
        ["--expect-agent-setup", "cursor"],
        fixture("setup-expect/ci-gemini.yml"),
        ["cursor", "gemini"],
      ],
    ] as const) {
      const cli = await runCli([...flags], config);
      expect(cli.code, `${label}: ${cli.stderr}`).toBe(EXIT_OK);
      const report: Report = JSON.parse(cli.stdout);
      expect(report.agentSetup.missing, label).toContain("cursor");
      expect(report.agentSetup.missing, label).toEqual(missing);
    }
  });

  it("AC-8: an unknown tool name exits 2 before any git call, naming --expect-agent-setup and listing the valid tools", async () => {
    const { EXIT_ERROR } = await import("../src/main.js");
    const cli = await runCli(["--expect-agent-setup", "foo"]);
    expect(cli.code).toBe(EXIT_ERROR);
    expect(cli.gitCalls).toEqual([]);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).toContain("--expect-agent-setup");
    expect(cli.stderr).toContain("foo");
    for (const tool of AGENT_TOOLS) expect(cli.stderr, `lists ${tool}`).toContain(tool);
  });

  it("AC-8: with the agent setup requirement on, a missing expected tool exits 1", async () => {
    const { EXIT_FAIL } = await import("../src/main.js");
    const cli = await runCli(["--expect-agent-setup", "cursor", "--require-agent-setup"]);
    expect(cli.code, cli.stderr).toBe(EXIT_FAIL);
    const report: Report = JSON.parse(cli.stdout);
    expect(report.agentSetup.missing).toEqual(["cursor"]);
    expect(report.verdict).toBe("fail");
  });
});
