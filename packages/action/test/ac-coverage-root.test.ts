import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() and the fixtures are loaded inside each test body: the AC tests are written before the coverage root and
// fixtures/coverage-paths/ exist, so nothing that depends on them may run while the file loads. The Action runs
// against in-memory deps for a pull_request event in a workspace whose git returns the package-relative fixture's
// diff and tracked files.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");
const repoFile = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

// What the runner passes when an input is not set: the action.yml default, else "" (coverage-root has none).
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

type Report = {
  verdict: string;
  diffCoverage: { files: { path: string; coveredLines: number; coverableLines: number }[] } | null;
  messages: { code: string; level: string }[];
};

async function runAction(coverageRoot: string, config: string | null) {
  const { run } = await import("../src/run.js");
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const files: Record<string, string> = {
    "coverage/lcov.info": fixture("coverage-paths/package-relative/coverage.info"),
  };
  if (config !== null) files[".pharn/ci.yml"] = fixture(`coverage-paths/package-relative/${config}`);
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(WORKSPACE, path), text]));
  const diff = fixture("coverage-paths/package-relative/pr.diff");
  const tracked = fixture("coverage-paths/package-relative/files.txt").trim().split("\n");
  const inputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    threshold: "80",
    "coverage-root": coverageRoot,
  };
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

const codes = (report: Report) => report.messages.map((message) => message.code);
const measured = (report: Report) =>
  report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({ path, coveredLines, coverableLines }));

describe("the coverage-root Action input", () => {
  it("AC-9: a set input decides over coverage.root, an empty one falls back to it and then to none", async () => {
    for (const [input, config, mapped] of [
      ["", null, false],
      ["", "ci-root.yml", true],
      ["", "ci-root-other.yml", false],
      ["packages/core", null, true],
      ["packages/core", "ci-root-other.yml", true],
      ["packages/web", "ci-root.yml", false],
    ] as const) {
      const label = `input "${input}", config ${config ?? "none"}`;
      const action = await runAction(input, config);
      const report = action.report();
      if (mapped) {
        expect(codes(report), label).not.toContain("COVERAGE_PATHS_UNMATCHED");
        expect(measured(report), label).toEqual([
          { path: "packages/core/src/a.ts", coveredLines: 4, coverableLines: 5 },
        ]);
        expect(report.verdict, label).toBe("pass");
        expect(action.outputs.verdict, label).toBe("pass");
        expect(action.failed, label).toEqual([]);
      } else {
        expect(codes(report), label).toContain("COVERAGE_PATHS_UNMATCHED");
        expect(report.diffCoverage, label).toBeNull();
        expect(report.verdict, label).toBe("fail");
        expect(action.outputs.verdict, label).toBe("fail");
        expect(action.failed.length, `${label}: the step is failed`).toBeGreaterThan(0);
      }
    }
  });

  it("AC-9: an invalid coverage-root input fails the step with a message naming coverage-root", async () => {
    const action = await runAction("../x", "ci-root.yml");
    expect(action.failed).toHaveLength(1);
    expect(action.failed[0]).toContain("coverage-root");
  });

  it("AC-9: action.yml declares a coverage-root input that is not required and has no default", () => {
    const lines = repoFile("action.yml").split(/\r?\n/);
    const inputsAt = lines.indexOf("inputs:");
    expect(inputsAt, "action.yml has an inputs: block").toBeGreaterThanOrEqual(0);
    const start = lines.findIndex((line, index) => index > inputsAt && /^ {2}coverage-root:\s*$/.test(line));
    expect(start, "inputs.coverage-root").toBeGreaterThan(inputsAt);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.trim() !== "" && !/^ {3,}/.test(line));
    const block = rest.slice(0, end === -1 ? rest.length : end);
    expect(
      block.some((line) => /^\s+required:\s*false\s*$/.test(line)),
      "required: false",
    ).toBe(true);
    expect(
      block.some((line) => /^\s+default:/.test(line)),
      "no default: key",
    ).toBe(false);
    expect(
      block.some((line) => /^\s+description:/.test(line)),
      "a description",
    ).toBe(true);
  });
});
