import { tmpdir } from "node:os";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGitHubApi } from "./api.js";
import { createNodeIo } from "./node-io.js";
import { run } from "./run.js";

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
// Built lazily: a run that needs no API call (comment: false, local diff) needs no token.
const api = createGitHubApi({
  token: core.getInput("github-token"),
  repo: () => github.context.repo,
  getOctokit: github.getOctokit,
});

await run({
  getInput: (name) => core.getInput(name),
  context: github.context as never,
  workspace,
  tempDir: process.env.RUNNER_TEMP ?? tmpdir(),
  api,
  ...createNodeIo(workspace),
  info: core.info,
  warning: core.warning,
  setOutput: core.setOutput,
  setFailed: core.setFailed,
});
