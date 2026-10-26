import { describe, expect, it } from "vitest";

// createGitHubApi() is loaded inside each test body, like the other AC tests: they are written before the build.
// The API layer runs over a fake Octokit that records each request and answers with a canned response.

const REPO = { owner: "octo", repo: "demo" };

type Request = { method: string; params: Record<string, unknown> };
type Response = { data: unknown; headers?: Record<string, string> };

function fakeOctokit(responses: { listCommits?: Response[]; get?: Response }) {
  const requests: Request[] = [];
  const listCommitsQueue = [...(responses.listCommits ?? [])];
  const octokit = {
    rest: {
      pulls: {
        listCommits: async (params: Record<string, unknown>) => {
          requests.push({ method: "pulls.listCommits", params });
          const next = listCommitsQueue.shift();
          if (next === undefined) throw new Error("no canned listCommits response left");
          return { headers: {}, ...next };
        },
        get: async (params: Record<string, unknown>) => {
          requests.push({ method: "pulls.get", params });
          if (responses.get === undefined) throw new Error("no canned get response");
          return responses.get;
        },
      },
    },
  };
  return { octokit, requests };
}

async function apiOver(responses: { listCommits?: Response[]; get?: Response }) {
  const { createGitHubApi } = await import("../src/api.js");
  const fake = fakeOctokit(responses);
  const api = createGitHubApi({
    token: "test-token",
    repo: () => REPO,
    getOctokit: (() => fake.octokit) as never,
  });
  return { api: api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, ...fake };
}

const COMMITS = [
  {
    sha: "1".repeat(40),
    commit: { message: "Fix the parser\n" },
    author: { login: "octocat" },
    committer: { login: "octocat" },
  },
];

// The first test of a file loads createGitHubApi() cold, which can take seconds on a loaded host.
describe("action API: the read-only pull request commits call", { timeout: 60_000 }, () => {
  it("AC-14: listPullRequestCommits asks for page 2 of 100 commits and reads hasNext from the link header", async () => {
    const { api, requests } = await apiOver({
      listCommits: [
        {
          data: COMMITS,
          headers: {
            link: '<https://api.github.com/x?page=3>; rel="next", <https://api.github.com/x?page=9>; rel="last"',
          },
        },
        { data: [], headers: { link: '<https://api.github.com/x?page=1>; rel="prev"' } },
        { data: [], headers: {} },
      ],
    });
    expect(typeof api.listPullRequestCommits, "listPullRequestCommits").toBe("function");

    await expect(api.listPullRequestCommits?.(42, 2)).resolves.toEqual({ commits: COMMITS, hasNext: true });
    expect(requests[0]).toEqual({
      method: "pulls.listCommits",
      params: { owner: "octo", repo: "demo", pull_number: 42, per_page: 100, page: 2 },
    });

    await expect(api.listPullRequestCommits?.(42, 3)).resolves.toEqual({ commits: [], hasNext: false });
    await expect(api.listPullRequestCommits?.(42, 4)).resolves.toEqual({ commits: [], hasNext: false });
    expect(requests.map((r) => r.method)).toEqual(["pulls.listCommits", "pulls.listCommits", "pulls.listCommits"]);
  });

  it("AC-14: getPullRequestSignoff also returns the pull request's commits count", async () => {
    const author = { login: "claude[bot]", type: "Bot" };
    const labels = [{ name: "agent" }];
    const { api, requests } = await apiOver({ get: { data: { user: author, labels, commits: 5 } } });
    await expect(api.getPullRequestSignoff?.(42)).resolves.toEqual({ author, labels, commits: 5 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("pulls.get");
    expect(requests[0]?.params).toMatchObject({ owner: "octo", repo: "demo", pull_number: 42 });
  });
});
