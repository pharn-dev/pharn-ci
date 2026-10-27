import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness, PR_CONTEXT } from "./harness.js";

// E3 item 24 (P07), AC-16. run() is loaded inside each run: the AC test is written before the Action reads the agent
// instruction files, so nothing the build adds may run while this file loads. The runs use the in-memory harness for
// git and the GitHub API, a real temporary workspace (the file: policy reader lstats each path segment) that is also a
// git repository committing AGENTS.md, CLAUDE.md and .mcp.json, and a recording git batch runner that reads that
// repository (or fails for the instruction call).

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const AGENTS = "# Agents\n\nRun `pnpm install`, then `pnpm test`.\n";
const CLAUDE = "# Claude\n\n```sh\nnpm install\nnpm test\n```\n";
const TRACKED = ["AGENTS.md", "CLAUDE.md", ".mcp.json", POLICY_PATH, "README.md", "src/math.ts", "src/new.ts"];
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const LOG_PREFIX = "pharn-ci: could not read the agent instruction files from git, so P07 did not compare them: ";

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type BatchCall = { args: string[]; input: string };

let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p07-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "AGENTS.md"), AGENTS);
  writeFileSync(join(dir, "CLAUDE.md"), CLAUDE);
  writeFileSync(join(dir, ".mcp.json"), '{\n  "mcpServers": {}\n}\n');
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

const PR_PAYLOAD_CONTEXT = {
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

const WORKFLOW_RUN_CONTEXT = {
  eventName: "workflow_run",
  sha: "4444444444444444444444444444444444444444",
  ref: "refs/heads/main",
  workflow: "ci",
  job: "check",
  runId: 11,
  runAttempt: 1,
  repo: { owner: "acme", repo: "widgets" },
  issue: { owner: "acme", repo: "widgets" },
  payload: {
    repository: { full_name: "acme/widgets", id: 42 },
    workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA },
  },
};

const HUMAN_COMMITS = [
  {
    sha: "3".repeat(40),
    commit: { message: "Fix the parser\n" },
    author: { login: "octocat" },
    committer: { login: "octocat" },
  },
];

interface RunOptions {
  context?: Record<string, unknown>;
  inputs: Record<string, string>;
  localGit?: boolean;
  api?: Record<string, unknown>;
  /** The served policy document for an app run. */
  appPolicy?: unknown;
  /** Makes the batch call that names AGENTS.md reject. */
  failInstructions?: boolean;
}

async function actionRun(options: RunOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({
    context: (options.context ?? PR_PAYLOAD_CONTEXT) as never,
    inputs: options.inputs,
    lsFiles: TRACKED,
    localGit: options.localGit ?? true,
  });
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(_pullNumber: number, page: number) {
      return { commits: page === 1 ? HUMAN_COMMITS : [], hasNext: false };
    },
    ...options.api,
  } as typeof h.deps.api;
  const batchCalls: BatchCall[] = [];
  const envelope =
    options.appPolicy === undefined
      ? undefined
      : JSON.stringify({ ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")), policy: options.appPolicy });
  Object.assign(h.deps, {
    workspace: dir,
    readFile: realReadFile,
    gitBatch: async (args: string[], input: string) => {
      batchCalls.push({ args: [...args], input });
      if (options.failInstructions && input.includes("HEAD:AGENTS.md")) throw new Error("fatal: simulated failure");
      return runGitBatch(dir, args, input);
    },
    fetch: async () => {
      if (envelope === undefined) throw new Error("no fetch was expected");
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
    },
    getIDToken: async () => "tok-SECRET-123",
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report & Record<string, unknown>;
  expectValidReport(report);
  return { h, report, batchCalls };
}

const INSTRUCTION_LINES = ["HEAD:AGENTS.md", "HEAD:CLAUDE.md"];
const linesOf = (call: BatchCall) => call.input.split("\n").filter((l) => l.length > 0);
const namingInstructions = (calls: BatchCall[]) =>
  calls.filter((c) => linesOf(c).some((l) => INSTRUCTION_LINES.includes(l) || /:(AGENTS|CLAUDE)\.md$/.test(l)));
const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const p07Messages = (report: Report) => report.messages.filter((m) => m.code === "POLICY_P07");
const unreadInfo = (report: Report) => p07(report).map((v) => ({ path: v.path, line: v.line, severity: v.severity }));

const PR_NUMBER_API = {
  async getPullRequest(pullNumber: number) {
    if (pullNumber !== 42) throw new Error("Not Found");
    return { baseSha: BASE_SHA, headSha: HEAD_SHA };
  },
  async listTree(_sha: string) {
    return { paths: TRACKED, truncated: false };
  },
  async getPullRequestSignoff(_pullNumber: number) {
    return { author: { login: "octocat", type: "User" }, labels: [], commits: 1 };
  },
};

describe("action: the agent instruction files are read for P07 only in policy mode with a local diff", {
  timeout: 180_000,
}, () => {
  it("AC-16: a local-diff file: policy run reads AGENTS.md and CLAUDE.md in a batch call of their own; P07 off and policy never read nothing; pr-number and compare-API runs read nothing and give one info violation; a failing read gives the info violation and one log line", async () => {
    // pull_request, local diff, file: policy.
    const local = await actionRun({ inputs: { policy: `file:${POLICY_PATH}` } });
    const instructionCalls = namingInstructions(local.batchCalls);
    expect(instructionCalls, JSON.stringify(local.batchCalls)).toHaveLength(1);
    expect(instructionCalls[0]?.args).toEqual(["cat-file", "--batch-check"]);
    expect(linesOf(instructionCalls[0] as BatchCall)).toEqual(INSTRUCTION_LINES);
    const configCalls = local.batchCalls.filter((c) => linesOf(c).some((l) => l.endsWith(":.mcp.json")));
    expect(configCalls.length, JSON.stringify(local.batchCalls)).toBeGreaterThan(0);
    for (const call of configCalls) expect(linesOf(call)).toEqual(["HEAD:.mcp.json"]);
    expect(p07(local.report).map((v) => ({ path: v.path, line: v.line, severity: v.severity }))).toEqual([
      { path: "AGENTS.md", line: 3, severity: "warn" },
      { path: "CLAUDE.md", line: 4, severity: "warn" },
    ]);

    // An app policy setting policy.rules.P07 off.
    const off = await actionRun({
      inputs: { policy: "auto" },
      appPolicy: { version: 1, policy: { rules: { P07: "off" } } },
    });
    expect(off.report.policy, "the app policy applied").toBeDefined();
    expect(namingInstructions(off.batchCalls)).toEqual([]);
    expect(p07(off.report)).toEqual([]);
    expect(p07Messages(off.report)).toEqual([]);

    // policy: never.
    const never = await actionRun({ inputs: { policy: "never" } });
    expect(namingInstructions(never.batchCalls)).toEqual([]);
    expect(p07(never.report)).toEqual([]);
    expect(p07Messages(never.report)).toEqual([]);
    expect(never.report.policy).toBeUndefined();

    // pr-number mode with the file: policy: nothing is read, one path-less info violation.
    const prNumber = await actionRun({
      context: WORKFLOW_RUN_CONTEXT,
      inputs: { policy: `file:${POLICY_PATH}`, "pr-number": "42", "head-sha": HEAD_SHA, "github-token": "test-token" },
      api: PR_NUMBER_API,
    });
    expect(namingInstructions(prNumber.batchCalls)).toEqual([]);
    expect(unreadInfo(prNumber.report)).toEqual([{ path: null, line: null, severity: "info" }]);

    // A diff from the compare API with the file: policy: nothing is read, one path-less info violation.
    const compare = await actionRun({ inputs: { policy: `file:${POLICY_PATH}` }, localGit: false });
    expect(
      compare.h.apiCalls.some((c) => c.startsWith("compare ")),
      "control: the diff came from the compare API",
    ).toBe(true);
    expect(namingInstructions(compare.batchCalls)).toEqual([]);
    expect(unreadInfo(compare.report)).toEqual([{ path: null, line: null, severity: "info" }]);

    // A local-diff run whose instruction batch call fails.
    const failing = await actionRun({ inputs: { policy: `file:${POLICY_PATH}` }, failInstructions: true });
    expect(namingInstructions(failing.batchCalls).length).toBeGreaterThan(0);
    expect(unreadInfo(failing.report)).toEqual([{ path: null, line: null, severity: "info" }]);
    const logged = [...failing.h.infos, ...failing.h.warnings].filter((l) => l.startsWith(LOG_PREFIX));
    expect(logged, JSON.stringify(failing.h.infos)).toHaveLength(1);
  });
});
