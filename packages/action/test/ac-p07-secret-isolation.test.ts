import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness, PR_CONTEXT } from "./harness.js";

// E3 item 24 (P07), AC-17. check(), agentConfigSecretPaths(), scanAgentSetup() and run() are loaded inside the test
// body: the AC test is written before the build adds rule P07 and the instruction read, so nothing the build adds may
// run while this file loads. The Action run uses the in-memory harness and a real temporary workspace that is a git
// repository committing AGENTS.md, a CLAUDE.md holding a GitHub-token-shaped string, and a .mcp.json holding none; the
// git batch runner reads it and records every call.
//
// No complete secret is written in this file (gitleaks, GitHub push protection): the token-shaped string is assembled
// at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const TOKEN = "ghp" + "_" + cut(36, 23);
const AGENTS = "# Agents\n\nRun `pnpm install`.\n";
const CLAUDE = `# Claude\n\nRun \`npm install\`.\n\nThe token is ${TOKEN} for the demo.\n`;
const MCP = '{\n  "mcpServers": {}\n}\n';
const TRACKED = ["AGENTS.md", "CLAUDE.md", ".mcp.json", POLICY_PATH, "README.md", "src/math.ts"];

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type BatchCall = { args: string[]; input: string };
interface Core {
  check(input: unknown): unknown;
  agentConfigSecretPaths(inventory: unknown): string[];
  scanAgentSetup(paths: readonly string[]): unknown;
}

let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p07-secrets-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "AGENTS.md"), AGENTS);
  writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
  writeFileSync(join(dir, ".mcp.json"), MCP);
  mkdirSync(join(dir, ".pharn"), { recursive: true });
  writeFileSync(join(dir, POLICY_PATH), JSON.stringify({ version: 1 }));
  sh("add", "-A");
  sh("commit", "-q", "-m", "agent setup");
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(join(dir, "coverage/lcov.info"), read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const a7 = (report: Report) => report.messages.filter((m) => m.code.startsWith("AGENT_CONFIG_SECRET_"));
const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const linesOf = (call: BatchCall) => call.input.split("\n").filter((l) => l.length > 0);

function checkInput(configText: string) {
  return {
    version: "0.1.0",
    coverage: { text: read("fixtures/golden/coverage.info"), format: "lcov" },
    diff: { text: read("fixtures/diff/empty.diff") },
    repoRoot: GOLDEN_ROOT,
    threshold: null,
    repoFiles: TRACKED,
    policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } },
    agentConfigSources: { files: [{ path: ".mcp.json", text: configText }], dropped: [] },
    agentInstructionSources: {
      files: [
        { path: "AGENTS.md", text: AGENTS },
        { path: "CLAUDE.md", text: CLAUDE },
      ],
      dropped: [],
    },
  };
}

describe("P07's instruction text never reaches check A7's secret scan", { timeout: 180_000 }, () => {
  it("AC-17: with A7 and P07 both active, no AGENT_CONFIG_SECRET_* message names CLAUDE.md, the scan's input holds only agentConfigSecretPaths, and the instruction text is never read with the agent config sources", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const selected = core.agentConfigSecretPaths(core.scanAgentSetup(TRACKED));
    expect(selected).toEqual([".mcp.json"]);

    // Control: the same token in .mcp.json is found by A7, so the scan is active.
    const controlConfig = `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${TOKEN}" } }\n  }\n}\n`;
    const control = core.check(checkInput(controlConfig)) as Report;
    expectValidReport(control);
    expect(a7(control).some((m) => m.code === "AGENT_CONFIG_SECRET_S01" && m.text.includes(".mcp.json"))).toBe(true);

    // check(): the token lives only in CLAUDE.md, which P07 reads and A7 never scans.
    const report = core.check(checkInput(MCP)) as Report;
    expectValidReport(report);
    expect(
      p07(report).map((v) => v.path),
      "P07 read the instruction text",
    ).toEqual(["AGENTS.md", "CLAUDE.md"]);
    for (const m of a7(report)) expect(m.text, m.code).not.toContain("CLAUDE.md");
    expect(a7(report).filter((m) => m.level === "error")).toEqual([]);
    expect(JSON.stringify(report).includes(TOKEN)).toBe(false);

    // The Action: local diff, file: policy, both reads active.
    const { run } = await import("../src/run.js");
    const context = {
      ...PR_CONTEXT,
      workflow: "ci",
      job: "check",
      runId: 9,
      runAttempt: 1,
      actor: "octocat",
      payload: {
        repository: { full_name: "acme/widgets", id: 42 },
        pull_request: {
          number: 7,
          base: { sha: "a".repeat(40) },
          head: { sha: "b".repeat(40) },
          user: { login: "octocat", type: "User" },
          labels: [],
          commits: 1,
        },
      },
    };
    const h = harness({ context: context as never, inputs: { policy: `file:${POLICY_PATH}` }, lsFiles: TRACKED });
    h.deps.api = {
      ...h.deps.api,
      async listPullRequestCommits() {
        return { commits: [], hasNext: false };
      },
    } as typeof h.deps.api;
    const calls: BatchCall[] = [];
    Object.assign(h.deps, {
      workspace: dir,
      readFile: realReadFile,
      gitBatch: async (args: string[], input: string) => {
        calls.push({ args: [...args], input });
        return runGitBatch(dir, args, input);
      },
    });
    await run(h.deps);
    const text = h.written[h.outputs["report-path"] ?? ""];
    if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
    const actionReport = JSON.parse(text) as Report;
    expectValidReport(actionReport);
    expect(
      p07(actionReport).map((v) => v.path),
      "the Action read the instruction text",
    ).toEqual(["AGENTS.md", "CLAUDE.md"]);
    for (const m of a7(actionReport)) expect(m.text, m.code).not.toContain("CLAUDE.md");
    expect(text.includes(TOKEN)).toBe(false);

    // The agent config batch-check names exactly the selected paths; no batch-check mixes config and instruction paths.
    const checks = calls.filter((c) => c.args[1] === "--batch-check");
    const configChecks = checks.filter((c) => linesOf(c).some((l) => l === "HEAD:.mcp.json"));
    expect(configChecks).toHaveLength(1);
    expect(linesOf(configChecks[0] as BatchCall)).toEqual(selected.map((p) => `HEAD:${p}`));
    for (const c of checks) {
      const lines = linesOf(c);
      const config = lines.some((l) => l === "HEAD:.mcp.json");
      const instruction = lines.some((l) => l === "HEAD:CLAUDE.md" || l === "HEAD:AGENTS.md");
      expect(config && instruction, JSON.stringify(lines)).toBe(false);
    }

    // CLAUDE.md's blob is never read in the same --batch call as .mcp.json's.
    const oid = (path: string) =>
      execFileSync("git", ["rev-parse", `HEAD:${path}`], { cwd: dir, encoding: "utf8" }).trim();
    const claudeOid = oid("CLAUDE.md");
    const mcpOid = oid(".mcp.json");
    const reads = calls.filter((c) => c.args[1] === "--batch");
    expect(
      reads.some((c) => linesOf(c).includes(claudeOid)),
      "CLAUDE.md was read for P07",
    ).toBe(true);
    for (const c of reads) {
      const lines = linesOf(c);
      expect(lines.includes(claudeOid) && lines.includes(mcpOid), JSON.stringify(lines)).toBe(false);
    }
  });
});
