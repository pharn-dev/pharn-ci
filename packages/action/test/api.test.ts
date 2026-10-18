import { describe, expect, it, vi } from "vitest";
import { createGitHubApi, type GitHubApiOptions } from "../src/api.js";

const REPO = { owner: "acme", repo: "demo" };

function fakeOctokit() {
  return {
    rest: {
      repos: { compareCommitsWithBasehead: vi.fn(async () => ({ data: "diff text" })) },
      users: { getAuthenticated: vi.fn(async () => ({ data: { login: "me" } })) },
      pulls: {
        get: vi.fn(async () => ({ data: { base: { sha: "b".repeat(40) }, head: { sha: "h".repeat(40) } } })),
      },
      git: {
        getTree: vi.fn(async () => ({
          data: {
            truncated: false,
            tree: [
              { path: "src", type: "tree" },
              { path: "src/a.ts", type: "blob" },
              { path: "vendor/lib", type: "commit" },
              { path: "AGENTS.md", type: "blob" },
            ],
          },
        })),
      },
      issues: {
        listComments: vi.fn(),
        createComment: vi.fn(async () => ({ data: { user: { login: "me" } } })),
        updateComment: vi.fn(async () => ({})),
        deleteComment: vi.fn(async () => ({})),
      },
    },
    paginate: vi.fn(async () => [{ id: 1 }]),
  };
}

function options(token: string) {
  const octokit = fakeOctokit();
  const getOctokit = vi.fn(() => octokit);
  const repo = vi.fn(() => REPO);
  const opts = { token, repo, getOctokit } as unknown as GitHubApiOptions;
  return { opts, octokit, getOctokit, repo };
}

describe("createGitHubApi", () => {
  it("builds no client and reads no repo context until a call is made", () => {
    const { opts, getOctokit, repo } = options("");
    createGitHubApi(opts);
    expect(getOctokit).not.toHaveBeenCalled();
    expect(repo).not.toHaveBeenCalled();
  });

  it("rejects every call with a clear error when the token is empty", async () => {
    const { opts, getOctokit } = options("");
    const api = createGitHubApi(opts);
    const empty = "the github-token input is empty";
    await expect(api.compareDiff("a...b")).rejects.toThrow(empty);
    await expect(api.viewerLogin()).rejects.toThrow(empty);
    await expect(api.listComments(7)).rejects.toThrow(empty);
    await expect(api.createComment(7, "x")).rejects.toThrow(empty);
    await expect(api.updateComment(1, "x")).rejects.toThrow(empty);
    await expect(api.deleteComment(1)).rejects.toThrow(empty);
    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("builds the client once, on first use, with the token and repo", async () => {
    const { opts, octokit, getOctokit } = options("t0ken");
    const api = createGitHubApi(opts);
    expect(await api.compareDiff("a...b")).toBe("diff text");
    expect(octokit.rest.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
      ...REPO,
      basehead: "a...b",
      mediaType: { format: "diff" },
    });
    expect(await api.viewerLogin()).toBe("me");
    expect(await api.listComments(7)).toEqual([{ id: 1 }]);
    expect(await api.createComment(7, "body")).toBe("me");
    await api.updateComment(1, "body");
    await api.deleteComment(2);
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({ ...REPO, issue_number: 7, body: "body" });
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({ ...REPO, comment_id: 1, body: "body" });
    expect(octokit.rest.issues.deleteComment).toHaveBeenCalledWith({ ...REPO, comment_id: 2 });
    expect(getOctokit).toHaveBeenCalledTimes(1);
    expect(getOctokit).toHaveBeenCalledWith("t0ken");
  });

  it("rejects the pull request and tree reads with a clear error when the token is empty", async () => {
    const { opts, getOctokit } = options("");
    const api = createGitHubApi(opts);
    const empty = "the github-token input is empty";
    await expect(api.getPullRequest(42)).rejects.toThrow(empty);
    await expect(api.listTree("a".repeat(40))).rejects.toThrow(empty);
    expect(getOctokit).not.toHaveBeenCalled();
  });

  it("reads a pull request's base and head SHAs", async () => {
    const { opts, octokit } = options("t0ken");
    expect(await createGitHubApi(opts).getPullRequest(42)).toEqual({
      baseSha: "b".repeat(40),
      headSha: "h".repeat(40),
    });
    expect(octokit.rest.pulls.get).toHaveBeenCalledWith({ ...REPO, pull_number: 42 });
  });

  it("lists the blob paths of a tree recursively and reports whether it was truncated", async () => {
    const { opts, octokit } = options("t0ken");
    const api = createGitHubApi(opts);
    expect(await api.listTree("c".repeat(40))).toEqual({ paths: ["src/a.ts", "AGENTS.md"], truncated: false });
    expect(octokit.rest.git.getTree).toHaveBeenCalledWith({ ...REPO, tree_sha: "c".repeat(40), recursive: "1" });

    octokit.rest.git.getTree.mockResolvedValueOnce({ data: { truncated: true, tree: [] } });
    expect(await api.listTree("c".repeat(40))).toEqual({ paths: [], truncated: true });
  });

  it("returns no login when /user is not readable", async () => {
    const { opts, octokit } = options("t0ken");
    octokit.rest.users.getAuthenticated.mockRejectedValueOnce(new Error("Resource not accessible by integration"));
    expect(await createGitHubApi(opts).viewerLogin()).toBeNull();
  });
});
