import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// main(), run() and the fixtures are loaded inside each test body: these AC tests are written before the strict
// threshold rule and fixtures/threshold-parsing/ exist, so nothing that depends on them may run while the file loads.
// Both entry points run against in-memory deps: a repo whose git returns the golden diff and tracked-files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const ERROR = "must be a number between 0 and 100";

/** The repo's files: the golden coverage, plus a .pharn/ci.yml when one is given. */
function repoFiles(config?: string): Map<string, string> {
  const files: Record<string, string> = { "coverage/lcov.info": fixture("golden/coverage.info") };
  if (config !== undefined) files[".pharn/ci.yml"] = config;
  return new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
}

function fakeGit() {
  const paths = fixture("golden/files.txt").trim().split("\n");
  return async (args: string[]) => {
    if (args.includes("ls-files")) return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args.includes("diff")) return fixture("golden/pr.diff");
    if (args.includes("ls-tree")) return "";
    return `${BASE_SHA}\n`;
  };
}

async function runCli(extraArgs: string[], config?: string) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const contents = repoFiles(config);
  const deps = {
    cwd: REPO_ROOT,
    git: fakeGit(),
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  const argv = ["check", "--coverage", "coverage/lcov.info", "--format", "json", ...extraArgs];
  const code = await main(argv, deps);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

async function runAction(threshold: string) {
  const { run } = await import("../../action/src/run.js");
  const failed: string[] = [];
  const contents = repoFiles();
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", threshold };
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
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
    },
    workspace: REPO_ROOT,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: fakeGit(),
    readFile: async (path: string) => contents.get(path) ?? null,
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
  const report = await run(deps as never);
  return { report, failed };
}

describe("strict threshold: CLI flag, .pharn/ci.yml and Action input", () => {
  it("AC-3: the CLI refuses --threshold 1e2 and 0x10 with exit 2, the error on stderr and nothing on stdout", async () => {
    for (const threshold of ["1e2", "0x10"]) {
      const cli = await runCli(["--threshold", threshold]);
      expect(cli.code, threshold).toBe(2);
      expect(cli.stderr, threshold).toContain(`--threshold ${ERROR}`);
      expect(cli.stdout, threshold).toBe("");
    }
  });

  it("AC-3: the CLI refuses a .pharn/ci.yml whose coverage.threshold is 1e2 with exit 2", async () => {
    const config = fixture("threshold-parsing/refuse-1e2.yml");
    expect(config).toMatch(/^[ \t]+threshold:[ \t]*1e2[ \t]*$/m);
    const cli = await runCli([], config);
    expect(cli.code).toBe(2);
    expect(cli.stderr).toContain(`"coverage.threshold" ${ERROR}`);
  });

  it("AC-3: the Action refuses the threshold input 1e2 and 0x10: no report, the step fails once", async () => {
    for (const threshold of ["1e2", "0x10"]) {
      const action = await runAction(threshold);
      expect(action.report, threshold).toBeUndefined();
      expect(action.failed, threshold).toHaveLength(1);
      expect(action.failed[0], threshold).toContain(`threshold ${ERROR}`);
    }
  });
});
