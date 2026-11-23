import { resolve } from "node:path";
import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { fixture } from "../../core/test/helpers.js";
import { expectValidReport } from "../../core/test/schema.js";
import { requiredDeps, type StreamedFake } from "../../node-io/test/required-deps.js";

// CORE-92 (R3.1), through the CLI and the Action: a coverage report the pull request commits at the path the gate
// reads fails a run with a threshold. main() and run() are loaded inside each test body: the tests are written before
// the change, so nothing that depends on it may run while the file loads. Both run against in-memory deps: a repo whose
// git returns a tracked-coverage diff and the tracked files of fixtures/tracked-coverage/files.txt.

const REPO_ROOT = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const COVERAGE = "coverage/lcov.info";

const tracked = (report: Report) => report.messages.filter((message) => message.code === "COVERAGE_FILE_TRACKED");

function fakeGit(diff: string) {
  const files = fixture("tracked-coverage/files.txt").trim().split("\n");
  return async (args: string[]) => {
    if (args.includes("ls-files")) return args.includes("-z") ? `${files.join("\0")}\0` : `${files.join("\n")}\n`;
    if (args.includes("--show-toplevel")) return `${REPO_ROOT}\n`;
    if (args.includes("diff")) return diff;
    return `${BASE_SHA}\n`;
  };
}

function contents(): Map<string, string> {
  return new Map([[resolve(REPO_ROOT, COVERAGE), fixture("tracked-coverage/coverage.info")]]);
}

async function runCli(threshold: number | null, diff: string): Promise<{ code: number; report: Report }> {
  const { main } = await import("../src/main.js");
  const out: string[] = [];
  const files = contents();
  const deps = {
    ...requiredDeps((): StreamedFake => deps),
    cwd: REPO_ROOT,
    git: fakeGit(diff),
    readFile: async (path: string) => files.get(path) ?? null,
    listDir: () => Promise.reject(new Error("unexpected listDir")),
    resolvePath: (...segments: string[]) => resolve(...segments),
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: () => {},
  };
  const argv = [
    "check",
    "--coverage",
    COVERAGE,
    ...(threshold === null ? [] : ["--threshold", String(threshold)]),
    "--format",
    "json",
  ];
  const code = await main(argv, deps);
  return { code, report: JSON.parse(out.join("")) };
}

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  config: "",
};

async function runAction(threshold: number | null, diff: string): Promise<{ failed: string[]; report: Report }> {
  const { run } = await import("../../action/src/run.js");
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const files = contents();
  const inputs: Record<string, string> = {
    "coverage-file": COVERAGE,
    ...(threshold === null ? {} : { threshold: String(threshold) }),
  };
  const deps = {
    ...requiredDeps((): StreamedFake => deps),
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
    readFile: async (path: string) => files.get(path) ?? null,
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
  const text = written.get(outputs["report-path"] ?? "");
  if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
  return { failed, report: JSON.parse(text) };
}

/** The four rows of the ticket: threshold, diff fixture, expected level, CLI exit code and verdict. */
const ROWS = [
  {
    label: "AC-1: threshold 80, the PR changes the tracked report",
    threshold: 80,
    diff: "modified.diff",
    level: "error",
    exit: 1,
    verdict: "fail",
  },
  {
    label: "AC-2: threshold 80, the PR adds the tracked report",
    threshold: 80,
    diff: "added.diff",
    level: "error",
    exit: 1,
    verdict: "fail",
  },
  {
    label: "AC-3: no threshold, the PR changes the tracked report",
    threshold: null,
    diff: "modified.diff",
    level: "warn",
    exit: 0,
    verdict: "warn",
  },
  {
    label: "AC-4: threshold 80, the diff does not touch the tracked report",
    threshold: 80,
    diff: "untouched.diff",
    level: "warn",
    exit: 0,
    verdict: "warn",
  },
] as const;

describe("COVERAGE_FILE_TRACKED through the CLI and the Action (CORE-92)", () => {
  for (const row of ROWS) {
    it(`${row.label}: the CLI exits ${row.exit} and the Action ${row.exit === 1 ? "fails" : "passes"} with the same report`, async () => {
      const diff = fixture(`tracked-coverage/${row.diff}`);
      const cli = await runCli(row.threshold, diff);
      expectValidReport(cli.report);
      expect(cli.code).toBe(row.exit);
      expect(cli.report.verdict).toBe(row.verdict);
      const cliTracked = tracked(cli.report);
      expect(cliTracked).toHaveLength(1);
      expect(cliTracked[0]?.level).toBe(row.level);
      expect(cliTracked[0]?.text).toContain("`coverage/lcov.info`");
      if (row.level === "error") expect(cliTracked[0]?.text).toContain("`git rm --cached coverage/lcov.info`");

      const action = await runAction(row.threshold, diff);
      expectValidReport(action.report);
      expect(action.failed.length > 0).toBe(row.exit === 1);
      expect(action.report.verdict).toBe(row.verdict);
      // AC-5: the same inputs give the same verdict and the same messages in both.
      expect(action.report.messages).toEqual(cli.report.messages);
    });
  }
});
