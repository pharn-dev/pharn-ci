import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// main(), run() and the fixtures are loaded inside each test body: the AC tests are written before the agent setup
// requirement and fixtures/require-agent-setup/ exist, so nothing that depends on them may run while the file loads.
// Both entry points run against in-memory deps: a repo whose git returns the golden diff and a tracked-files list
// with no agent setup file.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type Config = "none" | "true" | "false";

/** The repo's files: the golden coverage, plus a .pharn/ci.yml setting setup.require when asked. */
function repoFiles(config: Config): Record<string, string> {
  const files: Record<string, string> = { "coverage/lcov.info": fixture("golden/coverage.info") };
  if (config !== "none") files[".pharn/ci.yml"] = fixture(`require-agent-setup/ci-require-${config}.yml`);
  return files;
}

function fakeGit() {
  const paths = fixture("require-agent-setup/files.txt").trim().split("\n");
  return async (args: string[]) => {
    if (args.includes("ls-files")) return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args.includes("diff")) return fixture("golden/pr.diff");
    return `${BASE_SHA}\n`;
  };
}

type Report = { verdict: string; messages: { code: string; level: string }[] };

const setupLevels = (report: Report) =>
  report.messages.filter((message) => message.code === "NO_AGENT_SETUP_FILES").map((message) => message.level);

async function runCli(config: Config, flag: boolean) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map(Object.entries(repoFiles(config)).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
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
  const argv = ["check", "--coverage", "coverage/lcov.info", "--format", "json"];
  const code = await main(flag ? [...argv, "--require-agent-setup"] : argv, deps);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// What the runner passes when an input is not set: the action.yml default, else "" (require-agent-setup has none).
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: ".pharn/ci.yml",
};

async function runAction(input: string, config: Config) {
  const { run } = await import("../../action/src/run.js");
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", "require-agent-setup": input };
  const contents = new Map(Object.entries(repoFiles(config)).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
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
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  await run(deps as never);
  return {
    failed,
    outputs,
    report: (): Report => {
      const text = written.get(outputs["report-path"] ?? "");
      if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
      return JSON.parse(text);
    },
  };
}

describe("require-agent-setup: CLI flag and Action input", () => {
  it("AC-3: the CLI flag turns the requirement on, else setup.require then off decides, and a fail exits 1", async () => {
    const { EXIT_FAIL, EXIT_OK } = await import("../src/main.js");
    for (const [config, flag, level] of [
      ["none", false, "info"],
      ["none", true, "error"],
      ["true", false, "error"],
      ["false", false, "info"],
      ["false", true, "error"],
    ] as const) {
      const label = `config ${config}, flag ${flag}`;
      const cli = await runCli(config, flag);
      const report: Report = JSON.parse(cli.stdout);
      expect(setupLevels(report), label).toEqual([level]);
      expect(report.verdict, label).toBe(level === "error" ? "fail" : "pass");
      expect(cli.code, label).toBe(level === "error" ? EXIT_FAIL : EXIT_OK);
    }
  });

  it("AC-3: a set Action input decides; an empty one falls back to setup.require, then off", async () => {
    for (const [input, config, level] of [
      ["", "none", "info"],
      ["", "true", "error"],
      ["", "false", "info"],
      ["true", "false", "error"],
      ["true", "none", "error"],
      ["false", "true", "info"],
    ] as const) {
      const label = `input "${input}", config ${config}`;
      const action = await runAction(input, config);
      const report = action.report();
      expect(setupLevels(report), label).toEqual([level]);
      const verdict = level === "error" ? "fail" : "pass";
      expect(report.verdict, label).toBe(verdict);
      expect(action.outputs.verdict, label).toBe(verdict);
      if (level === "info") expect(action.failed, label).toEqual([]);
    }
  });

  it("AC-3: an Action input that is not a boolean is reported as an error naming require-agent-setup", async () => {
    for (const input of ["maybe", "required"]) {
      const action = await runAction(input, "none");
      expect(action.failed, input).toHaveLength(1);
      expect(action.failed[0], input).toContain("require-agent-setup");
    }
  });
});
