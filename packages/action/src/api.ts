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
      // With the diff media type the response body is the raw diff text.
      return res.data as unknown as string;
    },
    async viewerLogin() {
      const { octokit } = connect();
      // Works for a personal or user token. The default GITHUB_TOKEN cannot read /user, and it
      // comments as github-actions[bot].
      try {
        return (await octokit.rest.users.getAuthenticated()).data.login;
      } catch {
        return "github-actions[bot]";
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
      await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    },
    async updateComment(commentId, body) {
      const { octokit, owner, repo } = connect();
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
    },
  };
}
