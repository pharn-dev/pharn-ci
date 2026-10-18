import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// check(), run() and the fixtures are loaded inside each test body: the AC tests are written before the tracked
// coverage file warning and fixtures/gate-tamper/ exist, so nothing that depends on them may run while the file loads.
// The Action runs against in-memory deps for a pull_request event in a workspace whose git returns the tracked files.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const lines = (path: string) => fixture(path).trim().split("\n");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };

const withCode = (report: Report, code: string) => report.messages.filter((message) => message.code === code);

async function runCheck(file: string | undefined, tracked: string): Promise<Report> {
  const { check } = await import("../../core/src/check.js");
  const input = {
    version: "0.1.0",
    coverage: {
      text: fixture("gate-tamper/coverage.info"),
      format: "lcov" as const,
      ...(file === undefined ? {} : { file }),
    },
    diff: { text: fixture("gate-tamper/untouched.diff") },
    repoRoot: WORKSPACE,
    threshold: 80,
    repoFiles: lines(`gate-tamper/${tracked}`),
  };
  return check(input as Parameters<typeof check>[0]) as unknown as Report;
}

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

async function runAction(inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const files: Record<string, string> = { "coverage/lcov.info": fixture("gate-tamper/coverage.info") };
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(WORKSPACE, path), text]));
  const diff = fixture("gate-tamper/untouched.diff");
  const tracked = lines("gate-tamper/files-with-coverage.txt");
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
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      compareDiff: async () => diff,
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) return args.includes("-z") ? `${tracked.join("\0")}\0` : `${tracked.join("\n")}\n`;
      if (args.includes("--show-toplevel")) return `${WORKSPACE}\n`;
      if (args.includes("diff")) return diff;
      return `${BASE_SHA}\n`;
    },
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

describe("COVERAGE_FILE_TRACKED", () => {
  it("AC-2: check() warns once, naming the repo-relative path, for a tracked coverage file given relative or absolute", async () => {
    for (const file of ["coverage/lcov.info", `${WORKSPACE}/coverage/lcov.info`]) {
      const report = await runCheck(file, "files-with-coverage.txt");
      expectValidReport(report);
      const warnings = withCode(report, "COVERAGE_FILE_TRACKED");
      expect(warnings, file).toHaveLength(1);
      expect(warnings[0]?.level, file).toBe("warn");
      expect(warnings[0]?.text, file).toContain("coverage/lcov.info");
      expect(warnings[0]?.text, file).not.toContain(WORKSPACE);
      expect(report.verdict, file).toBe("warn");
    }

    for (const [file, tracked] of [
      ["coverage/lcov.info", "files.txt"],
      [`${WORKSPACE}/coverage/lcov.info`, "files.txt"],
      [undefined, "files-with-coverage.txt"],
    ] as const) {
      const label = `file ${file ?? "absent"}, tracked ${tracked}`;
      const report = await runCheck(file, tracked);
      expectValidReport(report);
      expect(withCode(report, "COVERAGE_FILE_TRACKED"), label).toEqual([]);
    }
  });

  it("AC-2: the Action with a coverage-file input naming a tracked file reports COVERAGE_FILE_TRACKED", async () => {
    const action = await runAction({ "coverage-file": "coverage/lcov.info", threshold: "80" });
    const report = action.report();
    expectValidReport(report);
    const warnings = withCode(report, "COVERAGE_FILE_TRACKED");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.level).toBe("warn");
    expect(warnings[0]?.text).toContain("coverage/lcov.info");
  });
});
