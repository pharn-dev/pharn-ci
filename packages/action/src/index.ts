import { tmpdir } from "node:os";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGitHubApi } from "./api.js";
import { createNodeIo } from "./node-io.js";
import { withRequestPolicy } from "./request-policy.js";
import { run } from "./run.js";

const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
// Built lazily: a run that needs no API call (comment: false, local diff) needs no token.
const api = createGitHubApi({
  token: core.getInput("github-token"),
  repo: () => github.context.repo,
  // Every request gets a 30 s timeout and at most one retry (request-policy.ts).
  getOctokit: withRequestPolicy((token) => github.getOctokit(token), { log: core.info }),
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
  // The org policy: the runner's OIDC token for the audience pharn.dev, and the global fetch. Only a job that grants
  // `id-token: write` has both request variables, and only then is a policy fetched (policy-fetch.ts).
  fetch: (input, init) => fetch(input, init),
  getIDToken: (audience) => core.getIDToken(audience),
  setSecret: core.setSecret,
  hasOidcEnv: Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL) && Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
