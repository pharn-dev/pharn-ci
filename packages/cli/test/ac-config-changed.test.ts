import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), main(), run() and the fixtures are loaded inside each test body: the AC tests are written before the
// config-change warning and fixtures/gate-tamper/ exist, so nothing that depends on them may run while the file loads.
// The CLI and the Action run against in-memory deps: a repo whose git returns a gate-tamper diff and tracked files.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const lines = (path: string) => fixture(path).trim().split("\n");

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };

const withCode = (report: Report, code: string) => report.messages.filter((message) => message.code === code);

async function runCheck(diff: string, configPath?: string): Promise<Report> {
  const { check } = await import("../../core/src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("gate-tamper/coverage.info"), format: "lcov" as const },
    diff: { text: fixture(`gate-tamper/${diff}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines("gate-tamper/files.txt"),
    ...(configPath === undefined ? {} : { configPath }),
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Report;
}

function fakeGit(diff: string) {
  const tracked = lines("gate-tamper/files.txt");
  return async (args: string[]) => {
    if (args.includes("ls-files")) return args.includes("-z") ? `${tracked.join("\0")}\0` : `${tracked.join("\n")}\n`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args.includes("diff")) return diff;
    return `${BASE_SHA}\n`;
  };
}

async function runCli(argv: string[], files: Record<string, string>, diff: string) {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const err: string[] = [];
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
  const deps = {
    cwd: REPO_ROOT,
    git: fakeGit(diff),
    readFile: async (path: string) => contents.get(path) ?? null,
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
  };
  const code = await main(argv, deps);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

async function runAction(inputs: Record<string, string>, files: Record<string, string>, diff: string) {
  const { run } = await import("../../action/src/run.js");
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(REPO_ROOT, path), text]));
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
      compareDiff: async () => diff,
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: fakeGit(diff),
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

describe("CONFIG_CHANGED_IN_DIFF", () => {
  it("AC-1: check() warns once, naming the path, when the diff touches the config in use or a workflow", async () => {
    for (const [diff, configPath, changed] of [
      ["config-modified.diff", undefined, ".pharn/ci.yml"],
      ["config-added.diff", "config/pharn.yml", "config/pharn.yml"],
      ["config-deleted.diff", "config/pharn.yml", "config/pharn.yml"],
      ["config-renamed-from.diff", "config/pharn.yml", "config/pharn.yml"],
      ["config-renamed-to.diff", "config/pharn.yml", "config/pharn.yml"],
      ["workflow-modified.diff", undefined, ".github/workflows/ci.yml"],
    ] as const) {
      const label = `${diff}, configPath ${configPath ?? "absent"}`;
      const report = await runCheck(diff, configPath);
      expectValidReport(report);
      const warnings = withCode(report, "CONFIG_CHANGED_IN_DIFF");
      expect(warnings, label).toHaveLength(1);
      expect(warnings[0]?.level, label).toBe("warn");
      expect(warnings[0]?.text, label).toContain(changed);
      expect(report.verdict, label).toBe("warn");
    }

    for (const configPath of [undefined, "config/pharn.yml"]) {
      const label = `untouched.diff, configPath ${configPath ?? "absent"}`;
      const report = await runCheck("untouched.diff", configPath);
      expectValidReport(report);
      expect(withCode(report, "CONFIG_CHANGED_IN_DIFF"), label).toEqual([]);
    }
  });

  it("AC-1: the CLI with --config naming a repo file the diff modifies reports CONFIG_CHANGED_IN_DIFF", async () => {
    const cli = await runCli(
      ["check", "--config", "config/pharn.yml", "--coverage", "coverage/lcov.info", "--format", "json"],
      {
        "coverage/lcov.info": fixture("gate-tamper/coverage.info"),
        "config/pharn.yml": fixture("gate-tamper/ci.yml"),
      },
      fixture("gate-tamper/config-custom-modified.diff"),
    );
    const report: Report = JSON.parse(cli.stdout);
    expectValidReport(report);
    const warnings = withCode(report, "CONFIG_CHANGED_IN_DIFF");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warn");
    expect(warnings[0]?.text).toContain("config/pharn.yml");
  });

  it("AC-1: the Action with an empty config input over a diff modifying .pharn/ci.yml reports CONFIG_CHANGED_IN_DIFF", async () => {
    const action = await runAction(
      { "coverage-file": "coverage/lcov.info", threshold: "80", config: "" },
      {
        "coverage/lcov.info": fixture("gate-tamper/coverage.info"),
        ".pharn/ci.yml": fixture("gate-tamper/ci.yml"),
      },
      fixture("gate-tamper/config-modified.diff"),
    );
    const report = action.report();
    expectValidReport(report);
    const warnings = withCode(report, "CONFIG_CHANGED_IN_DIFF");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warn");
    expect(warnings[0]?.text).toContain(".pharn/ci.yml");
  });
});
