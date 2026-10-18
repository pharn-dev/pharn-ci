import { describe, expect, it, vi } from "vitest";
import { createGitHubApi, type GitHubApiOptions } from "../src/api.js";

const REPO = { owner: "acme", repo: "demo" };

function fakeOctokit() {
  return {
    rest: {
      repos: { compareCommitsWithBasehead: vi.fn(async () => ({ data: "diff text" })) },
      users: { getAuthenticated: vi.fn(async () => ({ data: { login: "me" } })) },
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

  it("returns no login when /user is not readable", async () => {
    const { opts, octokit } = options("t0ken");
    octokit.rest.users.getAuthenticated.mockRejectedValueOnce(new Error("Resource not accessible by integration"));
    expect(await createGitHubApi(opts).viewerLogin()).toBeNull();
  });
});
