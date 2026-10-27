import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build. The fake GitHub
// API's listPullRequestCommits serves one page of human commits and records every call.

const HUMAN_COMMITS = [
  {
    sha: "1".repeat(40),
    commit: { message: "Fix the parser\n" },
    author: { login: "octocat" },
    committer: { login: "octocat" },
  },
];

const PULL_REQUEST = {
  number: 7,
  base: { sha: "a".repeat(40) },
  head: { sha: "b".repeat(40) },
  user: { login: "octocat", type: "User" },
  labels: [],
  commits: 1,
};

const RUN = { workflow: "ci", job: "check", runId: 9, runAttempt: 1 };
const REPOSITORY = { full_name: "demo/demo", id: 42 };

async function runWith(context: Record<string, unknown>, inputs: Record<string, string> = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({ context: context as never, inputs });
  const commitCalls: Array<[number, number]> = [];
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(pullNumber: number, page: number) {
      commitCalls.push([pullNumber, page]);
      return { commits: page === 1 ? HUMAN_COMMITS : [], hasNext: false };
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const path = h.outputs["report-path"];
  expect(path, "report-path output").toBeDefined();
  const text = h.written[path as string] as string;
  return { report: JSON.parse(text), text, commitCalls };
}

const prRun = (pullRequest: Record<string, unknown>) =>
  runWith({
    eventName: "pull_request",
    sha: "merge000",
    ...RUN,
    payload: { repository: REPOSITORY, pull_request: pullRequest },
  });

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("action: agent PR detection on other events and unusual authors", { timeout: 60_000 }, () => {
  it("AC-13: a push run with meta records isAgentPr false, no prAuthor key and makes no commits call", async () => {
    const { report, commitCalls } = await runWith(
      {
        eventName: "push",
        sha: "c".repeat(40),
        ...RUN,
        payload: { repository: REPOSITORY, before: "a".repeat(40) },
      },
      { "base-ref": "a".repeat(40) },
    );
    expect(report.meta).toBeDefined();
    expect(report.meta.isAgentPr).toBe(false);
    expect("prAuthor" in report.meta).toBe(false);
    expect(commitCalls).toEqual([]);
  });

  // E3 item 24a part B (P11): detection now runs inside check() on every pull request run, so the run without meta also
  // makes the commits call. It still records no isAgentPr: there is no meta, and no isAgentPr in the text.
  it("AC-13: a run without meta (no runId) makes the commits call on every pull request run and records no isAgentPr, like the same run with meta", async () => {
    const withMeta = await prRun(PULL_REQUEST);
    expect(withMeta.report.meta.isAgentPr, "the same pull request with meta is detected").toBe(false);
    expect(withMeta.commitCalls).toEqual([[7, 1]]);

    const { runId: _runId, ...noRunId } = RUN;
    const withoutMeta = await runWith({
      eventName: "pull_request",
      sha: "merge000",
      ...noRunId,
      payload: { repository: REPOSITORY, pull_request: PULL_REQUEST },
    });
    expect(withoutMeta.commitCalls).toEqual([[7, 1]]);
    expect(withoutMeta.report.meta).toBeUndefined();
    expect(withoutMeta.text).not.toContain("isAgentPr");
  });

  it("AC-13: a pull request whose user type is Mannequin counts as an agent PR", async () => {
    const { report } = await prRun({ ...PULL_REQUEST, user: { login: "former-member", type: "Mannequin" } });
    expect(report.meta.isAgentPr).toBe(true);
  });

  it("AC-13: a pull request that has no user counts as an agent PR", async () => {
    const { user: _user, ...noUser } = PULL_REQUEST;
    const { report } = await prRun(noUser);
    expect(report.meta.isAgentPr).toBe(true);
  });
});
