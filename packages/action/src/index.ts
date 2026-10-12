import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { type GitHubApi, run } from "./run.js";

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
const { owner, repo } = github.context.repo;
const octokit = github.getOctokit(core.getInput("github-token", { required: true }));

const api: GitHubApi = {
  async compareDiff(basehead) {
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
    // Works for a personal or user token. The default GITHUB_TOKEN cannot read /user, and it
    // comments as github-actions[bot].
    try {
      return (await octokit.rest.users.getAuthenticated()).data.login;
    } catch {
      return "github-actions[bot]";
    }
  },
  listComments: (issueNumber) =>
    octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: issueNumber, per_page: 100 }),
  async createComment(issueNumber, body) {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  },
  async updateComment(commentId, body) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body });
  },
};

await run({
  getInput: (name) => core.getInput(name),
  context: github.context as never,
  workspace,
  tempDir: process.env.RUNNER_TEMP ?? tmpdir(),
  api,
  git: (args) =>
    new Promise((ok, fail) => {
      execFile(
        "git",
        args,
        { cwd: workspace, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
        (err, stdout, stderr) => {
          if (err) fail(new Error(stderr || err.message));
          else ok(stdout);
        },
      );
    }),
  readFile: async (path) => {
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  writeFile: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  resolvePath: (...segments) => resolve(...segments),
  info: core.info,
  warning: core.warning,
  setOutput: core.setOutput,
  setFailed: core.setFailed,
  writeSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  },
});
