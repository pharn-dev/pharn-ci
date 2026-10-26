import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness } from "./harness.js";

// run() is loaded inside each run: the test is written before the Action gathers agent config sources, so nothing that
// depends on that may run while the file loads. The runs use packages/action/test/harness.ts with a gitBatch added to
// its deps; the batch runner reads a real temporary repository whose HEAD commits .mcp.json with a secret, and records
// every call. PR-number mode is built as packages/action/test/ac-test-sources-action.test.ts builds it.
//
// No complete secret is written in this file (gitleaks, GitHub push protection, and AC-22 runs findSecretSpans over
// this file as committed): the secret is assembled at test time from a prefix and a run cut from ALPHABET.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `n` distinct characters of ALPHABET, stepping 7 places from `seed` (7 is coprime with 62). */
function cut(n: number, seed: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[(seed + i * 7) % ALPHABET.length];
  return s;
}

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };
type Run = (deps: never) => Promise<unknown>;

const SECRET = "ghp" + "_" + cut(36, 17);
let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-secrets-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  writeFileSync(
    join(dir, ".mcp.json"),
    `{\n  "mcpServers": {\n    "github": { "env": { "GITHUB_TOKEN": "${SECRET}" } }\n  }\n}\n`,
  );
  sh("add", "-A");
  sh("commit", "-q", "-m", "agent config");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A gitBatch that reads the temporary repository and records each call's arguments. */
function recordingBatch() {
  const calls: string[][] = [];
  const gitBatch = (args: string[], input: string) => {
    calls.push([...args]);
    return runGitBatch(dir, args, input);
  };
  return { calls, gitBatch };
}

async function loadRun(): Promise<Run> {
  return ((await import("../src/run.js")) as unknown as { run: Run }).run;
}

/** The report a run wrote, else the one it returned. */
function reportOf(written: Record<string, string> | Map<string, string>, returned: unknown): Report {
  const entries = written instanceof Map ? [...written.entries()] : Object.entries(written);
  const text = entries.find(([path]) => path.endsWith("report.json"))?.[1];
  const report = (text === undefined ? returned : JSON.parse(text)) as Report | undefined;
  expect(report, "a report").toBeDefined();
  return report as Report;
}

const a7 = (report: Report) => report.messages.filter((m) => m.code.startsWith("AGENT_CONFIG_SECRET_"));
const catFile = (calls: string[][]) => calls.filter((args) => args[0] === "cat-file");

async function harnessRun(opts: Parameters<typeof harness>[0]) {
  const run = await loadRun();
  const h = harness(opts);
  const batch = recordingBatch();
  (h.deps as unknown as Record<string, unknown>).gitBatch = batch.gitBatch;
  const returned = await run(h.deps as never);
  return { h, batch, report: reportOf(h.written, returned) };
}

/** Expects one AGENT_CONFIG_SECRET_UNSCANNED warning naming a reason in a code span, and no other A7 message. */
function expectUnscannedWarn(report: Report, label: string) {
  const messages = a7(report);
  expect(
    messages.map((m) => `${m.code} ${m.level}`),
    label,
  ).toEqual(["AGENT_CONFIG_SECRET_UNSCANNED warn"]);
  expect((messages[0] as Message).text, `${label}: the reason`).toMatch(/`[^`\n]*\S[^`\n]*`/);
}

// PR-number mode: no pull_request payload, the pr-number input names PR 42, and the GitHub API serves its base, head,
// tree and compare diff. Both the local checkout and the PR tree hold a scannable path (.mcp.json).
const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const DEFAULT_BRANCH_TIP = "4444444444444444444444444444444444444444";
const TREE_PATHS = [".mcp.json", "README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"];
const LOCAL_PATHS = [".mcp.json", "README.md", "src/math.ts"];
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: "",
  "github-token": "test-token",
};

async function prNumberRun() {
  const run = await loadRun();
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    "pr-number": "42",
    "head-sha": HEAD_SHA,
  };
  const written = new Map<string, string>();
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const batch = recordingBatch();
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "workflow_run",
      sha: DEFAULT_BRANCH_TIP,
      ref: "refs/heads/main",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo" },
      payload: { workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA } },
    },
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (pullNumber: number) => {
        if (pullNumber === 42) return { baseSha: BASE_SHA, headSha: HEAD_SHA };
        throw new Error("Not Found");
      },
      listTree: async () => ({ paths: TREE_PATHS, truncated: false }),
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${LOCAL_PATHS.join("\0")}\0` : `${LOCAL_PATHS.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${DEFAULT_BRANCH_TIP}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args.includes("diff")) return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    gitBatch: batch.gitBatch,
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: () => {},
    writeSummary: async () => {},
  };
  const returned = await run(deps as never);
  return { batch, report: reportOf(written, returned) };
}

describe("action: agent config secrets", () => {
  it("AC-19: a local diff reads HEAD and fails on a committed secret; PR-number, compare-API and unavailable diffs warn unscanned without cat-file; no scannable path reads nothing", async () => {
    // A local diff: the agent config files are read at HEAD, and the committed secret fails the step.
    const local = await harnessRun({});
    expect(
      local.h.apiCalls.filter((call) => call.startsWith("compare ")),
      "control: the diff came from local git",
    ).toEqual([]);
    expect(
      a7(local.report)
        .filter((m) => m.code === "AGENT_CONFIG_SECRET_S01")
        .map((m) => m.level),
      "local diff: S01",
    ).toEqual(["error"]);
    expect(local.report.verdict, "local diff: verdict").toBe("fail");
    expect(local.h.failed.length, "local diff: the step fails").toBeGreaterThan(0);
    expect(JSON.stringify(local.report).includes(SECRET), "local diff: the report holds no secret").toBe(false);
    for (const body of [...local.h.posted, ...local.h.summary]) expect(body.includes(SECRET)).toBe(false);

    // PR-number mode: the checkout is not the PR head, so nothing is read.
    const prNumber = await prNumberRun();
    expectUnscannedWarn(prNumber.report, "pr-number mode");
    expect(catFile(prNumber.batch.calls), "pr-number mode: no cat-file call").toEqual([]);

    // A compare-API diff (no local base): nothing is read.
    const compare = await harnessRun({ localGit: false });
    expect(
      compare.h.apiCalls.some((call) => call.startsWith("compare ")),
      "control: the diff came from the compare API",
    ).toBe(true);
    expectUnscannedWarn(compare.report, "compare-API diff");
    expect(catFile(compare.batch.calls), "compare-API diff: no cat-file call").toEqual([]);

    // An unavailable diff (no local base, and the compare API refuses): nothing is read.
    const unavailable = await harnessRun({ localGit: false, compareError: new Error("the diff is too large") });
    expectUnscannedWarn(unavailable.report, "unavailable diff");
    expect(catFile(unavailable.batch.calls), "unavailable diff: no cat-file call").toEqual([]);

    // No scannable path in the tracked files: nothing is read and nothing is said.
    const none = await harnessRun({ lsFiles: ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"] });
    expect(catFile(none.batch.calls), "no scannable path: no cat-file call").toEqual([]);
    expect(a7(none.report), "no scannable path: no A7 message").toEqual([]);
  }, 60_000);
});
