import { describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build. The fake GitHub
// API's listPullRequestCommits pages, rejects or returns malformed data, and records every page requested. The pull
// request is a human one (author octocat, no labels), so only the commit listing can make it count as an agent PR.

type Page = { commits: unknown; hasNext: boolean };

const infoLine = (reason: string) =>
  `pharn-ci: agent PR detection could not read all of the pull request's evidence (${reason}), so it counts as an agent PR`;

const humanCommit = (i: number) => ({
  sha: String(i).padStart(40, "0"),
  commit: { message: `Change number ${i}\n` },
  author: { login: "octocat" },
  committer: { login: "octocat" },
});
const humanCommits = (from: number, count: number) => Array.from({ length: count }, (_, i) => humanCommit(from + i));

/** One meta-complete pull_request run of a human PR #7 whose commit listing is served by `page`. */
async function pagedRun(page: (n: number) => Promise<Page>, commitCount?: number) {
  const { run } = await import("../src/run.js");
  const pullRequest: Record<string, unknown> = {
    number: 7,
    base: { sha: "a".repeat(40) },
    head: { sha: "b".repeat(40) },
    user: { login: "octocat", type: "User" },
    labels: [],
  };
  if (commitCount !== undefined) pullRequest.commits = commitCount;
  const h = harness({
    context: {
      eventName: "pull_request",
      sha: "merge000",
      workflow: "ci",
      job: "check",
      runId: 9,
      runAttempt: 1,
      payload: { repository: { full_name: "demo/demo", id: 42 }, pull_request: pullRequest },
    } as never,
  });
  const pages: number[] = [];
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(pullNumber: number, n: number) {
      expect(pullNumber).toBe(7);
      pages.push(n);
      return page(n);
    },
  } as typeof h.deps.api;
  await run(h.deps);
  const path = h.outputs["report-path"];
  expect(path, "report-path output").toBeDefined();
  const report = JSON.parse(h.written[path as string] as string);
  return { h, report, pages };
}

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("action: agent PR detection over paged and failing commit listings", { timeout: 60_000 }, () => {
  it("AC-12: three pages each with hasNext true are read to page 3 only and the PR counts as agent", async () => {
    const { report, pages } = await pagedRun(async (n) => ({ commits: humanCommits(n * 10, 2), hasNext: true }));
    expect(pages).toEqual([1, 2, 3]);
    expect(report.meta.isAgentPr).toBe(true);
  });

  it("AC-12: a payload commit count of 251 counts as agent", async () => {
    const { report } = await pagedRun(async () => ({ commits: humanCommits(1, 3), hasNext: false }), 251);
    expect(report.meta.isAgentPr).toBe(true);
  });

  it("AC-12: a payload commit count of 5 with 3 commits listed counts as agent", async () => {
    const { report } = await pagedRun(async () => ({ commits: humanCommits(1, 3), hasNext: false }), 5);
    expect(report.meta.isAgentPr).toBe(true);
  });

  it("AC-12: a listing rejected with HTTP 403 counts as agent and logs the fixed line", async () => {
    const { report, h } = await pagedRun(async () => {
      throw Object.assign(new Error("Resource not accessible by integration"), { status: 403 });
    }, 3);
    expect(report.meta.isAgentPr).toBe(true);
    expect(h.infos).toContain(infoLine("commits-unreadable"));
  });

  it("AC-12: a page that is not a list counts as agent and logs the fixed line", async () => {
    const { report, h } = await pagedRun(async () => ({ commits: { message: "not a list" }, hasNext: false }), 1);
    expect(report.meta.isAgentPr).toBe(true);
    expect(h.infos).toContain(infoLine("commits-unreadable"));
  });

  it("AC-12: an entry without a string message counts as agent and logs the fixed line", async () => {
    const { report, h } = await pagedRun(
      async () => ({
        commits: [humanCommit(1), { sha: "9".repeat(40), commit: { message: 42 }, author: { login: "octocat" } }],
        hasNext: false,
      }),
      2,
    );
    expect(report.meta.isAgentPr).toBe(true);
    expect(h.infos).toContain(infoLine("commits-unreadable"));
  });

  it("AC-12: a human PR of 120 commits over two pages of 100 and 20 is not an agent PR", async () => {
    const { report, pages, h } = await pagedRun(
      async (n) =>
        n === 1 ? { commits: humanCommits(1, 100), hasNext: true } : { commits: humanCommits(101, 20), hasNext: false },
      120,
    );
    expect(pages).toEqual([1, 2]);
    expect(report.meta.isAgentPr).toBe(false);
    expect(h.infos.some((line) => line.startsWith("pharn-ci: agent PR detection"))).toBe(false);
  });
});
