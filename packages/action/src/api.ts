import type { getOctokit } from "@actions/github";
import type { GitHubApi } from "./run.js";

type Octokit = ReturnType<typeof getOctokit>;

export interface GitHubApiOptions {
  /** The github-token input; may be empty when no API call is needed. */
  token: string;
  /** Read only when a call is made: `github.context.repo` throws without GITHUB_REPOSITORY. */
  repo: () => { owner: string; repo: string };
  getOctokit: (token: string) => Octokit;
}

/**
 * The compare API's diff body as text. Octokit decodes a body as text only when its content type is
 * `text/*` or carries `charset=utf-8`; other types arrive as an ArrayBuffer, and a JSON body as a
 * parsed value. An ArrayBuffer is decoded as UTF-8; anything else throws, so the caller degrades the
 * way it does for any compare failure (DIFF_UNAVAILABLE) instead of crashing on a non-string.
 */
export function diffText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Uint8Array) return new TextDecoder().decode(data as Uint8Array<ArrayBuffer>);
  const got =
    data === null
      ? "null"
      : data === undefined
        ? "no body"
        : Array.isArray(data)
          ? "an array"
          : typeof data === "object"
            ? "an object"
            : `a ${typeof data}`;
  throw new Error(`the compare API returned ${got} instead of diff text`);
}

/**
 * The GitHub API, with the client built on first use. A run with `comment: false` and a local diff
 * makes no API call, so it needs no token. Without one, every call rejects, and run() degrades the
 * way it does for any API failure (DIFF_UNAVAILABLE for the compare fallback, a warning for the comment).
 */
export function createGitHubApi(opts: GitHubApiOptions): GitHubApi {
  let client: { octokit: Octokit; owner: string; repo: string } | undefined;
  const connect = () => {
    if (!client) {
      if (opts.token === "") throw new Error("the github-token input is empty");
      client = { octokit: opts.getOctokit(opts.token), ...opts.repo() };
    }
    return client;
  };

  return {
    async compareDiff(basehead) {
      const { octokit, owner, repo } = connect();
      const res = await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead,
        mediaType: { format: "diff" },
      });
      return diffText(res.data);
    },
    async getPullRequest(pullNumber) {
      const { octokit, owner, repo } = connect();
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return { baseSha: data.base.sha, headSha: data.head.sha };
    },
    async getPullRequestSignoff(pullNumber) {
      const { octokit, owner, repo } = connect();
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      return { author: data.user, labels: data.labels, commits: data.commits };
    },
    async listPullRequestCommits(pullNumber, page) {
      const { octokit, owner, repo } = connect();
      const res = await octokit.rest.pulls.listCommits({ owner, repo, pull_number: pullNumber, per_page: 100, page });
      return { commits: res.data, hasNext: /\brel="next"/.test(String(res.headers.link ?? "")) };
    },
    async listIssueEvents(issueNumber, page) {
      const { octokit, owner, repo } = connect();
      const res = await octokit.rest.issues.listEvents({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
        page,
      });
      return { events: res.data, hasNext: /\brel="next"/.test(String(res.headers.link ?? "")) };
    },
    async listTree(sha) {
      const { octokit, owner, repo } = connect();
      const { data } = await octokit.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: "1" });
      // Only files count: drop directories ("tree") and submodule entries ("commit").
      const paths = data.tree.flatMap((entry) => (entry.type === "blob" && entry.path ? [entry.path] : []));
      return { paths, truncated: data.truncated === true };
    },
    async viewerLogin() {
      const { octokit } = connect();
      // Works for a personal or user token. An App installation token or the default GITHUB_TOKEN
      // cannot read /user; run() then matches its comment by scope instead of by login.
      try {
        return (await octokit.rest.users.getAuthenticated()).data.login;
      } catch {
        return null;
      }
    },
    async listComments(issueNumber) {
      const { octokit, owner, repo } = connect();
      return octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      });
    },
    async createComment(issueNumber, body) {
      const { octokit, owner, repo } = connect();
      const created = await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
      return created.data.user?.login ?? null;
    },
    async updateComment(commentId, body) {
      const { octokit, owner, repo } = connect();
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
    },
    async deleteComment(commentId) {
      const { octokit, owner, repo } = connect();
      await octokit.rest.issues.deleteComment({ owner, repo, comment_id: commentId });
    },
  };
}
