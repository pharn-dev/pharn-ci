import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() is loaded inside each test body, like the other AC tests: they are written before the build.
// The Action runs against in-memory deps with comments on, so a run that got past input validation would comment.
// The GitHub API serves PR 42 (base A, head B), so a valid pr-number and head-sha would be accepted.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const DEFAULT_BRANCH_TIP = "4444444444444444444444444444444444444444";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: "",
  "github-token": "test-token",
};

const WORKFLOW_RUN_CONTEXT = {
  eventName: "workflow_run",
  sha: DEFAULT_BRANCH_TIP,
  ref: "refs/heads/main",
  repo: { owner: "octo", repo: "demo" },
  issue: { owner: "octo", repo: "demo" },
  payload: { workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA } },
};

const PULL_REQUEST_CONTEXT = {
  eventName: "pull_request",
  sha: "5555555555555555555555555555555555555555",
  ref: "refs/pull/7/merge",
  repo: { owner: "octo", repo: "demo" },
  issue: { owner: "octo", repo: "demo", number: 7 },
  payload: {
    pull_request: {
      number: 7,
      base: { sha: BASE_SHA, ref: "main" },
      head: { sha: HEAD_SHA, ref: "feature" },
    },
  },
};

async function runAction(context: object, extraInputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", ...extraInputs };
  const failed: string[] = [];
  const comments: { created: unknown[][]; updated: unknown[][] } = { created: [], updated: [] };
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const trackedFiles = fixture("golden/files.txt").trim().split("\n");
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context,
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (pullNumber: number) => {
        if (pullNumber === 42) return { baseSha: BASE_SHA, headSha: HEAD_SHA };
        throw new Error("Not Found");
      },
      listTree: async () => ({ paths: trackedFiles, truncated: false }),
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async (...args: unknown[]) => {
        comments.created.push(args);
      },
      updateComment: async (...args: unknown[]) => {
        comments.updated.push(args);
      },
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${trackedFiles.join("\0")}\0` : `${trackedFiles.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${DEFAULT_BRANCH_TIP}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args.includes("diff")) return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile: async (path: string) => files.get(path) ?? null,
    writeFile: async () => {},
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  await run(deps as never);
  return { failed, comments };
}

function expectFailedNaming(
  result: { failed: string[]; comments: { created: unknown[]; updated: unknown[] } },
  input: string,
) {
  expect(result.failed.length).toBeGreaterThan(0);
  expect(result.failed.join("\n")).toContain(input);
  expect(result.comments.created).toEqual([]);
  expect(result.comments.updated).toEqual([]);
}

describe("action inputs pr-number and head-sha", () => {
  it("AC-4: fails the step naming the input for an invalid pr-number or head-sha, and comments nothing", async () => {
    for (const prNumber of ["0", "042", "12345678901", "-1", "1e3", " 7x"]) {
      const result = await runAction(WORKFLOW_RUN_CONTEXT, { "pr-number": prNumber });
      expectFailedNaming(result, "pr-number");
    }

    for (const headSha of [
      "abc123",
      "2".repeat(39),
      "2".repeat(41),
      "g".repeat(40),
      "2".repeat(63),
      `${"2".repeat(39)}z`,
    ]) {
      const result = await runAction(WORKFLOW_RUN_CONTEXT, { "pr-number": "42", "head-sha": headSha });
      expectFailedNaming(result, "head-sha");
    }

    const headShaAlone = await runAction(WORKFLOW_RUN_CONTEXT, { "head-sha": HEAD_SHA });
    expectFailedNaming(headShaAlone, "head-sha");

    const mismatch = await runAction(PULL_REQUEST_CONTEXT, { "pr-number": "8" });
    expectFailedNaming(mismatch, "pr-number");
  });
});
