import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { runGitBatch } from "../../node-io/src/io.js";
import { harness } from "./harness.js";

// E3 item 23 (policy settings), AC-28. run() is loaded inside each run: the AC test is written before the Action
// gathers the policy settings sources, so nothing that depends on that may run while this file loads. The runs use
// packages/action/test/harness.ts with the workspace moved to a real temporary repository (the `file:` policy and the
// coverage file are read from it) and a gitBatch that reads that repository and records every call. PR-number mode is
// built as packages/action/test/ac-secrets-action.test.ts builds it.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
type Run = (deps: never) => Promise<unknown>;
type Call = { args: string[]; input: string };

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const NEW_CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];
const POLICY_INPUT = "file:policy/org.json";
const NESTED = "pkg/.claude/settings.json";
const NESTED_TEXT = '{\n  "permissions": {\n    "allow": [\n      "Bash(curl:*)"\n    ]\n  }\n}\n';
const NESTED_LINE = 4;
const SETTINGS_PATHS = [".claude/settings.json", NESTED];
const LS_FILES = [...fixture("golden/files.txt").trim().split("\n"), ...SETTINGS_PATHS, "policy/org.json"];

let dir: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-polset-action-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  put(".claude/settings.json", '{ "permissions": { "allow": ["Bash(ls)"] } }\n');
  put(NESTED, NESTED_TEXT);
  put("policy/org.json", `${JSON.stringify({ version: 1, setup: { forbidden_permissions: ["Bash(curl:*)"] } })}\n`);
  put("coverage/lcov.info", fixture("golden/coverage.info").replaceAll(GOLDEN_ROOT, dir));
  sh("add", "-A");
  sh("commit", "-q", "-m", "agent settings");
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

function recordingBatch() {
  const calls: Call[] = [];
  const gitBatch = (args: string[], input: string) => {
    calls.push({ args: [...args], input });
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
  expectValidReport(report);
  return report as Report;
}

async function harnessRun(opts: { policy: string; batch?: boolean; localGit?: boolean; compareError?: Error }) {
  const run = await loadRun();
  const h = harness({
    inputs: { policy: opts.policy },
    lsFiles: LS_FILES,
    ...(opts.localGit === undefined ? {} : { localGit: opts.localGit }),
    ...(opts.compareError === undefined ? {} : { compareError: opts.compareError }),
  });
  const batch = recordingBatch();
  const deps = h.deps as unknown as Record<string, unknown>;
  deps.workspace = dir;
  deps.readFile = realReadFile;
  if (opts.batch !== false) deps.gitBatch = batch.gitBatch;
  const returned = await run(h.deps as never);
  return { h, calls: batch.calls, report: reportOf(h.written, returned) };
}

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const DEFAULT_BRANCH_TIP = "4444444444444444444444444444444444444444";
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
    policy: POLICY_INPUT,
  };
  const written = new Map<string, string>();
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
    workspace: dir,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (pullNumber: number) => {
        if (pullNumber === 42) return { baseSha: BASE_SHA, headSha: HEAD_SHA };
        throw new Error("Not Found");
      },
      listTree: async () => ({ paths: LS_FILES, truncated: false }),
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${LS_FILES.join("\0")}\0` : `${LS_FILES.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${DEFAULT_BRANCH_TIP}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args.includes("diff")) return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    gitBatch: batch.gitBatch,
    readFile: realReadFile,
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
  return { calls: batch.calls, report: reportOf(written, returned) };
}

const naming = (calls: Call[], path: string) => calls.filter((c) => c.args[0] === "cat-file" && c.input.includes(path));
const newCodes = (report: Report) => report.messages.filter((m) => NEW_CODES.includes(m.code));
const unread = (reason: string) => [
  {
    level: "warn",
    code: "POLICY_SETTINGS_INVALID",
    text: `The agent settings files were not read (${reason}), so P02–P06 did not run.`,
  },
];

describe("action: policy mode reads the committed agent settings files", () => {
  it("AC-28: a local diff reads them and reports their violations; PR-number mode, a compare-API diff and an unavailable diff say why nothing was read, with no cat-file request; no batch runner or no policy reads nothing", async () => {
    // A local diff: the committed nested file is read and its P02 violation reported.
    const local = await harnessRun({ policy: POLICY_INPUT });
    expect(
      local.h.apiCalls.filter((c) => c.startsWith("compare ")),
      "control: the diff came from local git",
    ).toEqual([]);
    expect((local.report.policy?.violations ?? []).filter((v) => v.id === "P02")).toEqual([
      {
        id: "P02",
        severity: "block",
        path: NESTED,
        line: NESTED_LINE,
        detail: "allow rule overlaps forbidden permission Bash(curl:*)",
      },
    ]);
    expect(naming(local.calls, NESTED).length, "local diff: the nested file is requested").toBeGreaterThan(0);

    // PR-number mode: the checkout is not the PR head.
    const prNumber = await prNumberRun();
    expect(prNumber.report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toEqual(
      unread(
        "pr-number mode: the checkout is not the pull request head, so its committed agent settings files were not read",
      ),
    );
    expect(
      naming(prNumber.calls, ".claude/settings"),
      "pr-number mode: no cat-file request for a settings file",
    ).toEqual([]);

    // A compare-API diff (no local base).
    const compare = await harnessRun({ policy: POLICY_INPUT, localGit: false });
    expect(
      compare.h.apiCalls.some((c) => c.startsWith("compare ")),
      "control: the compare API",
    ).toBe(true);
    expect(compare.report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toEqual(
      unread("the diff came from the GitHub compare API, so the checkout may not be the pull request head"),
    );
    expect(naming(compare.calls, ".claude/settings")).toEqual([]);

    // An unavailable diff.
    const unavailable = await harnessRun({
      policy: POLICY_INPUT,
      localGit: false,
      compareError: new Error("the diff is too large"),
    });
    expect(unavailable.report.messages.filter((m) => m.code === "POLICY_SETTINGS_INVALID")).toEqual(
      unread("the diff is unavailable, so the checkout may not be the pull request head"),
    );
    expect(naming(unavailable.calls, ".claude/settings")).toEqual([]);

    for (const id of ["P02", "P03", "P04", "P05", "P06"]) {
      for (const [label, r] of [
        ["pr-number", prNumber.report],
        ["compare", compare.report],
        ["unavailable", unavailable.report],
      ] as const) {
        expect(
          (r.policy?.violations ?? []).some((v) => v.id === id),
          `${label}: no ${id}`,
        ).toBe(false);
      }
    }

    // No batch git runner: nothing is gathered, nothing is said.
    const noBatch = await harnessRun({ policy: POLICY_INPUT, batch: false });
    expect(noBatch.report.policy, "control: the file policy is in force").toBeDefined();
    expect(newCodes(noBatch.report)).toEqual([]);
    expect(noBatch.calls).toEqual([]);

    // No policy: nothing is gathered, nothing is said.
    const never = await harnessRun({ policy: "never" });
    expect(newCodes(never.report)).toEqual([]);
    expect(naming(never.calls, NESTED), "no policy: no cat-file request names the nested file").toEqual([]);
  }, 120_000);
});
