import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// E3 item 24a part B (P11), AC-15. run() is loaded inside each run and fixtures/policy-rules/p11/ is read there too:
// the AC test is written before the build moves agent PR detection into check(), so nothing the build adds may run
// while this file loads. The runs use a real temporary workspace (the file: policy reader lstats each path segment),
// the in-memory harness for git and the GitHub API, and a fake listPullRequestCommits that records every call.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const FIXED_LINE =
  "pharn-ci: agent PR detection could not read all of the pull request's evidence (commits-unreadable), so it counts as an agent PR";

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Report = { verdict: string; meta?: Record<string, unknown>; policy?: { violations: Violation[] } };

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const RUN = { workflow: "ci", job: "check", runId: 9, runAttempt: 1, actor: "octocat" };
const REPOSITORY = { full_name: "demo/demo", id: 42 };
const AGENT_PR = {
  number: 7,
  base: { sha: "a".repeat(40) },
  head: { sha: "b".repeat(40) },
  user: { login: "claude[bot]", type: "Bot" },
  labels: [],
  commits: 1,
};
const apiCommit = (login: string, message: string) => ({
  sha: "1".repeat(40),
  commit: { message },
  author: { login },
  committer: { login },
});

interface RunOptions {
  context: Record<string, unknown>;
  inputs?: Record<string, string>;
  /** The diff the local git and the compare API serve; default: the golden PR diff. */
  diff?: string;
  /** listPullRequestCommits: the commits of page 1, or an Error to throw. */
  commits: unknown[] | Error;
  workspace?: string;
}

async function actionRun(options: RunOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({ context: options.context as never, inputs: options.inputs ?? {} });
  const commitCalls: Array<[number, number]> = [];
  const diff = options.diff;
  if (diff !== undefined) {
    const git = h.deps.git;
    h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
  }
  h.deps.api = {
    ...h.deps.api,
    ...(diff === undefined ? {} : { compareDiff: async () => diff }),
    async listPullRequestCommits(pullNumber: number, page: number) {
      commitCalls.push([pullNumber, page]);
      if (options.commits instanceof Error) throw options.commits;
      return { commits: page === 1 ? options.commits : [], hasNext: false };
    },
  } as typeof h.deps.api;
  if (options.workspace !== undefined) {
    Object.assign(h.deps, {
      workspace: options.workspace,
      readFile: realReadFile,
      fetch: async () => {
        throw new Error("no fetch was expected");
      },
      getIDToken: async () => "tok-SECRET-123",
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => new Date("2026-10-26T12:00:00.000Z"),
      sleep: async () => {},
    });
  }
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, text, report, commitCalls };
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");

describe("action: agent PR detection runs on every pull request run", { timeout: 120_000 }, () => {
  it("AC-15: a pull_request run without meta still reads the commits once and blocks the agent PR under the file: policy; a push run makes no call and has no P11; a failing commits read logs part A's fixed line; part A's AC-10 run is unchanged", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-p11-every-pr-")));
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(
        join(dir, "coverage/lcov.info"),
        read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir),
      );
      mkdirSync(join(dir, ".pharn"), { recursive: true });
      writeFileSync(join(dir, POLICY_PATH), read("fixtures/policy-rules/p11/src/policy.json"));
      const diff = read("fixtures/policy-rules/p11/src/a.diff");
      const policyInputs = { policy: `file:${POLICY_PATH}` };
      const agentCommits = [apiCommit("claude[bot]", "Add retry to the upload step\n")];
      const { runId: _runId, ...noRunId } = RUN;

      // A pull_request run without GITHUB_RUN_ID: no meta, yet detection runs and P11 blocks.
      const noMeta = await actionRun({
        context: {
          eventName: "pull_request",
          sha: "merge000",
          ...noRunId,
          payload: { repository: REPOSITORY, pull_request: AGENT_PR },
        },
        inputs: policyInputs,
        diff,
        commits: agentCommits,
        workspace: dir,
      });
      expect(noMeta.commitCalls).toEqual([[7, 1]]);
      expect(noMeta.report.meta).toBeUndefined();
      expect(noMeta.text).not.toContain("isAgentPr");
      expect(p11(noMeta.report).map((v) => v.path)).toEqual(["src/a.ts"]);
      expect(noMeta.h.failed.length).toBeGreaterThan(0);

      // A push run: no pull request, no commits call, no P11.
      const push = await actionRun({
        context: {
          eventName: "push",
          sha: "c".repeat(40),
          ...RUN,
          payload: { repository: REPOSITORY, before: "a".repeat(40) },
        },
        inputs: { ...policyInputs, "base-ref": "a".repeat(40) },
        diff,
        commits: agentCommits,
        workspace: dir,
      });
      expect(push.commitCalls).toEqual([]);
      expect(p11(push.report)).toEqual([]);

      // A pull_request run with meta whose commits read fails: part A's fixed line, unchanged.
      const failing = await actionRun({
        context: {
          eventName: "pull_request",
          sha: "merge000",
          ...RUN,
          payload: { repository: REPOSITORY, pull_request: AGENT_PR },
        },
        inputs: policyInputs,
        diff,
        commits: new Error("HttpError: Server Error"),
        workspace: dir,
      });
      expect(failing.h.infos).toContain(FIXED_LINE);
      expect(failing.h.infos.filter((line) => line.includes("agent PR detection"))).toEqual([FIXED_LINE]);

      // Part A's AC-10 run (no policy, the golden diff): the agent metadata as before, after one commits call.
      const partA = await actionRun({
        context: {
          eventName: "pull_request",
          sha: "merge000",
          ...RUN,
          payload: {
            repository: REPOSITORY,
            pull_request: { ...AGENT_PR, labels: [{ name: "agent" }], commits: 2 },
          },
        },
        commits: [
          apiCommit("claude[bot]", "Add retry to the upload step\n\nCo-authored-by: Claude <noreply@anthropic.com>\n"),
          apiCommit("claude[bot]", "Fix the lint warning\n"),
        ],
      });
      expect(partA.report.meta?.isAgentPr).toBe(true);
      expect(partA.report.meta?.agentHint).toBe("claude-code");
      expect(partA.report.meta?.prAuthor).toEqual({ login: "claude[bot]", type: "Bot" });
      expect(partA.report.meta?.prLabels).toEqual(["agent"]);
      expect(partA.commitCalls).toEqual([[7, 1]]);
      expect(p11(partA.report)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
