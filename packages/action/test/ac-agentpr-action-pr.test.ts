import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build. The fake GitHub
// API gains listPullRequestCommits, which serves one page of the pull request's commits and records every call.

type ApiCommit = {
  sha: string;
  commit: { message: unknown };
  author: { login: string } | null;
  committer: { login: string } | null;
};

const apiCommit = (i: number, login: string, message: string): ApiCommit => ({
  sha: String(i).padStart(40, "0"),
  commit: { message },
  author: { login },
  committer: { login },
});

/** A meta-complete pull_request context (repository, runId, runAttempt) for PR #7 with the given payload fields. */
function prContext(pullRequest: Record<string, unknown>) {
  return {
    eventName: "pull_request",
    sha: "merge000",
    workflow: "ci",
    job: "check",
    runId: 9,
    runAttempt: 1,
    actor: "octocat",
    payload: {
      repository: { full_name: "demo/demo", id: 42 },
      pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) }, ...pullRequest },
    },
  };
}

async function runPr(pullRequest: Record<string, unknown>, commits: ApiCommit[]) {
  const { run } = await import("../src/run.js");
  const h = harness({ context: prContext(pullRequest) as never });
  const commitCalls: Array<[number, number]> = [];
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(pullNumber: number, page: number) {
      commitCalls.push([pullNumber, page]);
      return { commits: page === 1 ? commits : [], hasNext: false };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const path = h.outputs["report-path"];
  expect(path, "report-path output").toBeDefined();
  const text = h.written[path as string] as string;
  return { h, text, report: JSON.parse(text), commitCalls };
}

const AGENT_PR = {
  user: { login: "claude[bot]", type: "Bot" },
  labels: [{ name: "agent" }],
  commits: 2,
};
const AGENT_COMMITS = [
  apiCommit(1, "claude[bot]", "Add retry to the upload step\n\nCo-authored-by: Claude <noreply@anthropic.com>\n"),
  apiCommit(2, "claude[bot]", "Fix the lint warning\n"),
];

const HUMAN_PR = { user: { login: "octocat", type: "User" }, labels: [], commits: 2 };
const HUMAN_COMMITS = [
  apiCommit(1, "octocat", "Refactor the config reader\n\nCo-authored-by: Jane Roe <jane.roe@example.com>\n"),
  apiCommit(2, "octocat", "Update the README wording\n"),
];

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("action: agent PR detection on a pull_request run", { timeout: 60_000 }, () => {
  it("AC-10: an agent pull_request run records the agent metadata in a valid report.json after one commits call", async () => {
    const { report, commitCalls } = await runPr(AGENT_PR, AGENT_COMMITS);
    expect(report.meta.isAgentPr).toBe(true);
    expect(report.meta.agentHint).toBe("claude-code");
    expect(report.meta.prAuthor).toEqual({ login: "claude[bot]", type: "Bot" });
    expect(report.meta.prLabels).toEqual(["agent"]);
    expectValidReport(report);
    expect(commitCalls).toEqual([[7, 1]]);
  });

  it("AC-10: a human pull_request run records isAgentPr false and keeps no trace of the human co-author", async () => {
    const { report, text } = await runPr(HUMAN_PR, HUMAN_COMMITS);
    expect(report.meta.isAgentPr).toBe(false);
    expect(report.meta.coAuthors).toEqual([]);
    expect(text.toLowerCase()).not.toContain("jane");
    expectValidReport(report);
  });

  it("AC-10: the agent and the human run produce the same verdict, messages and job summary", async () => {
    const agent = await runPr(AGENT_PR, AGENT_COMMITS);
    const humanRun = await runPr(HUMAN_PR, HUMAN_COMMITS);
    expect(agent.report.meta.isAgentPr, "the agent run is flagged").toBe(true);
    expect(humanRun.report.meta.isAgentPr, "the human run is not").toBe(false);
    expect(agent.report.verdict).toEqual(humanRun.report.verdict);
    expect(agent.report.messages).toEqual(humanRun.report.messages);
    expect(agent.h.summary.length).toBeGreaterThan(0);
    expect(agent.h.summary).toEqual(humanRun.h.summary);
  });
});
