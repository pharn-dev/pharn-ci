import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness } from "./harness.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build.
// PR-number mode: a workflow_run event with no pull_request payload, and the pr-number input names PR 42. The fake
// GitHub API serves the pull request, its tree, the compare diff, the pull request's author and commit count
// (getPullRequestSignoff) and one page of its commits (listPullRequestCommits), and records the agent calls.

const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const WORKFLOW_RUN_CONTEXT = {
  eventName: "workflow_run",
  sha: "4444444444444444444444444444444444444444",
  ref: "refs/heads/main",
  workflow: "ci",
  job: "check",
  runId: 11,
  runAttempt: 1,
  repo: { owner: "octo", repo: "demo" },
  issue: { owner: "octo", repo: "demo" },
  payload: {
    repository: { full_name: "octo/demo", id: 42 },
    workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA },
  },
};

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("action: agent PR detection in pr-number mode", { timeout: 60_000 }, () => {
  it("AC-11: pr-number mode reads the author and commits of PR 42 from the API and records a devin agent PR", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({
      context: WORKFLOW_RUN_CONTEXT as never,
      inputs: { "pr-number": "42", "head-sha": HEAD_SHA, "github-token": "test-token" },
    });
    const signoffCalls: number[] = [];
    const commitCalls: Array<[number, number]> = [];
    h.deps.api = {
      ...h.deps.api,
      async getPullRequest(pullNumber: number) {
        if (pullNumber !== 42) throw new Error("Not Found");
        return { baseSha: BASE_SHA, headSha: HEAD_SHA };
      },
      async listTree(_sha: string) {
        return { paths: ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"], truncated: false };
      },
      async compareDiff(_basehead: string) {
        return fixture("golden/pr.diff");
      },
      async getPullRequestSignoff(pullNumber: number) {
        signoffCalls.push(pullNumber);
        return { author: { login: "devin-ai-integration[bot]", type: "Bot" }, labels: [], commits: 1 };
      },
      async listPullRequestCommits(pullNumber: number, page: number) {
        commitCalls.push([pullNumber, page]);
        return {
          commits:
            page === 1
              ? [
                  {
                    sha: "3".repeat(40),
                    commit: { message: "Bump the parser\n" },
                    author: { login: "devin-ai-integration[bot]" },
                    committer: { login: "devin-ai-integration[bot]" },
                  },
                ]
              : [],
          hasNext: false,
        };
      },
    } as typeof h.deps.api;
    await run(h.deps);
    const path = h.outputs["report-path"];
    expect(path, "report-path output").toBeDefined();
    const report = JSON.parse(h.written[path as string] as string);

    expect(report.meta.isAgentPr).toBe(true);
    expect(report.meta.agentHint).toBe("devin");
    expect(report.meta.prNumber).toBe(42);
    expect(signoffCalls).toContain(42);
    expect(commitCalls).toEqual([[42, 1]]);
    expectValidReport(report);
  });
});
