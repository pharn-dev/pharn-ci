import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGitHubApi } from "./api.js";
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
