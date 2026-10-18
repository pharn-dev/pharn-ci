import { describe, expect, it } from "vitest";

// createGitHubApi() is loaded inside each test body, like the other AC tests: they are written before the build.
// The API layer runs over a fake Octokit that records each request and answers with a canned response.

const REPO = { owner: "octo", repo: "demo" };
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type TreeEntry = { path: string; type: string; sha: string; mode: string };

function fakeOctokit(tree: { entries: TreeEntry[]; truncated: boolean }) {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const octokit = {
    rest: {
      pulls: {
        get: async (params: Record<string, unknown>) => {
          requests.push({ method: "pulls.get", params });
          return {
            data: {
              number: params.pull_number,
              base: { sha: BASE_SHA, ref: "main" },
              head: { sha: HEAD_SHA, ref: "feature" },
            },
          };
        },
      },
      git: {
        getTree: async (params: Record<string, unknown>) => {
          requests.push({ method: "git.getTree", params });
          return { data: { sha: params.tree_sha, tree: tree.entries, truncated: tree.truncated } };
        },
      },
    },
  };
  return { octokit, requests };
}

async function apiOver(tree: { entries: TreeEntry[]; truncated: boolean }) {
  const { createGitHubApi } = await import("../src/api.js");
  const fake = fakeOctokit(tree);
  const tokens: string[] = [];
  const api = createGitHubApi({
    token: "test-token",
    repo: () => REPO,
    getOctokit: ((token: string) => {
      tokens.push(token);
      return fake.octokit;
    }) as never,
  });
  return { api: api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>, ...fake };
}

const ENTRIES: TreeEntry[] = [
  { path: "AGENTS.md", type: "blob", sha: "a1", mode: "100644" },
  { path: "src", type: "tree", sha: "a2", mode: "040000" },
  { path: "src/math.ts", type: "blob", sha: "a3", mode: "100644" },
  { path: "packages", type: "tree", sha: "a4", mode: "040000" },
  { path: "packages/web/CLAUDE.md", type: "blob", sha: "a5", mode: "100644" },
];

describe("action API: read-only pull request and tree calls", () => {
  it("AC-2: reads pull request 42 and returns its base and head SHAs", async () => {
    const { api, requests } = await apiOver({ entries: [], truncated: false });
    const pr = await api.getPullRequest?.(42);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("pulls.get");
    expect(requests[0]?.params).toMatchObject({ owner: "octo", repo: "demo", pull_number: 42 });
    expect(pr).toEqual({ baseSha: BASE_SHA, headSha: HEAD_SHA });
  });

  it("AC-3: lists a tree recursively, returning only blob paths and whether it was truncated", async () => {
    const whole = await apiOver({ entries: ENTRIES, truncated: false });
    const listed = await whole.api.listTree?.(HEAD_SHA);
    expect(whole.requests).toHaveLength(1);
    expect(whole.requests[0]?.method).toBe("git.getTree");
    expect(whole.requests[0]?.params).toMatchObject({
      owner: "octo",
      repo: "demo",
      tree_sha: HEAD_SHA,
      recursive: "1",
    });
    expect(listed).toEqual({ paths: ["AGENTS.md", "src/math.ts", "packages/web/CLAUDE.md"], truncated: false });

    const cut = await apiOver({ entries: ENTRIES, truncated: true });
    const partial = (await cut.api.listTree?.(HEAD_SHA)) as { paths: string[]; truncated: boolean };
    expect(partial.truncated).toBe(true);
    expect(partial.paths).toEqual(["AGENTS.md", "src/math.ts", "packages/web/CLAUDE.md"]);
  });
});
