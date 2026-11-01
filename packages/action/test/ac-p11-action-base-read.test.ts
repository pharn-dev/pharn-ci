import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// E3 item 24a part B (P11), AC-16. run() is loaded inside each run: the AC test is written before the build reads the
// file: policy at the merge base, so nothing the build adds may run while this file loads. The runs use a real
// temporary workspace (the file: policy reader lstats each path segment), the in-memory harness for git and the GitHub
// API, and a recording fake git batch reader that answers nothing (so every batch read it serves is unreadable).

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const POLICY = { version: 1, agents: { protected_paths: ["src/**"] } };
const LOCAL_BASE = "a".repeat(40);
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  meta?: Record<string, unknown>;
  policy?: { violations: Violation[] };
};
type BatchCall = { args: string[]; input: string };

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const modification = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -2,0 +3 @@",
    "+x",
  ].join("\n");
/** A diff that edits the policy file and touches src/a.ts. */
const DIFF = `${[POLICY_PATH, "src/a.ts"].map(modification).join("\n")}\n`;
const HUMAN_COMMITS = [
  {
    sha: "3".repeat(40),
    commit: { message: "Fix the parser\n" },
    author: { login: "octocat" },
    committer: { login: "octocat" },
  },
];

function workspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p11-base-read-")));
  mkdirSync(join(dir, "coverage"), { recursive: true });
  writeFileSync(join(dir, "coverage/lcov.info"), read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir));
  mkdirSync(join(dir, ".pharn"), { recursive: true });
  writeFileSync(join(dir, POLICY_PATH), JSON.stringify(POLICY));
  return dir;
}

interface RunOptions {
  dir: string;
  context: Record<string, unknown>;
  inputs: Record<string, string>;
  api?: Record<string, unknown>;
  /** The served policy envelope for an app run. */
  envelope?: string;
}

async function actionRun(options: RunOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({ context: options.context as never, inputs: options.inputs });
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? DIFF : git(args));
  h.deps.api = {
    ...h.deps.api,
    compareDiff: async () => DIFF,
    async listPullRequestCommits(_pullNumber: number, page: number) {
      return { commits: page === 1 ? HUMAN_COMMITS : [], hasNext: false };
    },
    ...options.api,
  } as typeof h.deps.api;
  const batchCalls: BatchCall[] = [];
  const envelope = options.envelope;
  Object.assign(h.deps, {
    workspace: options.dir,
    readFile: realReadFile,
    gitBatch: async (args: string[], input: string) => {
      batchCalls.push({ args: [...args], input });
      return new Uint8Array();
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
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, batchCalls };
}

const naming = (calls: BatchCall[]) => calls.filter((c) => c.input.includes(`:${POLICY_PATH}`));

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
      base: { sha: LOCAL_BASE },
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

describe("action: the file: policy read at the merge base", { timeout: 120_000 }, () => {
  it("AC-16: a local-diff run under a file: policy asks the git batch reader once for <local base>:<policy path>; an app-policy run and a pr-number run never do, and the pr-number run fails closed with a path-less P11 and policy-lists-unreadable", async () => {
    const dir = workspace();
    try {
      // pull_request, local diff, file: policy that the diff edits.
      const local = await actionRun({ dir, context: PR_PAYLOAD_CONTEXT, inputs: { policy: `file:${POLICY_PATH}` } });
      const asked = naming(local.batchCalls);
      expect(asked, JSON.stringify(local.batchCalls)).toHaveLength(1);
      expect(asked[0]?.input.split("\n")).toContain(`${LOCAL_BASE}:${POLICY_PATH}`);

      // The same run under an app policy: no batch request names the policy path.
      const envelope = { ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")), policy: POLICY };
      const app = await actionRun({
        dir,
        context: PR_PAYLOAD_CONTEXT,
        inputs: { policy: "auto" },
        envelope: JSON.stringify(envelope),
      });
      expect(naming(app.batchCalls)).toEqual([]);

      // pr-number mode: the diff comes from the compare API, so the base cannot be read; a person's PR fails closed.
      const prNumber = await actionRun({
        dir,
        context: WORKFLOW_RUN_CONTEXT,
        inputs: {
          policy: `file:${POLICY_PATH}`,
          "pr-number": "42",
          "head-sha": HEAD_SHA,
          "github-token": "test-token",
        },
        api: {
          async getPullRequest(pullNumber: number) {
            if (pullNumber !== 42) throw new Error("Not Found");
            return { baseSha: BASE_SHA, headSha: HEAD_SHA };
          },
          async listTree(_sha: string) {
            return { paths: ["AGENTS.md", POLICY_PATH, "src/a.ts"], truncated: false };
          },
          async getPullRequestSignoff(_pullNumber: number) {
            return { author: { login: "octocat", type: "User" }, labels: [], commits: 1 };
          },
        },
      });
      expect(naming(prNumber.batchCalls)).toEqual([]);
      if (prNumber.report.meta !== undefined) expect(prNumber.report.meta.isAgentPr).toBe(true);
      const violations = (prNumber.report.policy?.violations ?? []).filter((v) => v.id === "P11");
      expect(violations.some((v) => v.path === null)).toBe(true);
      const incomplete = prNumber.report.messages.filter((m) => m.code === "AGENT_PR_DETECTION_INCOMPLETE");
      expect(incomplete).toHaveLength(1);
      expect(incomplete[0]?.text).toContain("policy-lists-unreadable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
