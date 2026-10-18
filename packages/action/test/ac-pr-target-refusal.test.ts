import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build.
// The Action runs against in-memory deps for a pull_request_target event. Its git answers `rev-parse HEAD` with the
// SHA the test chooses: the base branch's commit (the default pull_request_target checkout) or the PR head.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const BASE_BRANCH_TIP = "3333333333333333333333333333333333333333";

const REFUSAL =
  "pull_request_target cannot be measured safely: run pharn-ci on pull_request (fork PRs get the job summary only); see SECURITY.md";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

type Report = {
  verdict: string;
  messages: { code: string; level: string; text: string }[];
};

async function runOnPullRequestTarget(localHead: string) {
  const { run } = await import("../src/run.js");
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", threshold: "80" };
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const gitCalls: string[][] = [];
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "pull_request_target",
      sha: BASE_BRANCH_TIP,
      ref: "refs/heads/main",
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
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      gitCalls.push(args);
      if (args.includes("ls-files")) {
        const paths = fixture("golden/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${localHead}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args.includes("diff")) return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
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
  const returned = (await run(deps as never)) as Report | undefined;
  const reportText = [...written.entries()].find(([path]) => path.endsWith("report.json"))?.[1];
  const report: Report | undefined = returned ?? (reportText ? JSON.parse(reportText) : undefined);
  return { report, failed, outputs, gitCalls };
}

describe("action: a pull_request_target run", () => {
  it("AC-1: refuses to measure a base-branch checkout without advising to check out the PR head", async () => {
    const refused = await runOnPullRequestTarget(BASE_BRANCH_TIP);
    expect(refused.report).toBeDefined();
    const report = refused.report as Report;
    expectValidReport(report);
    const unavailable = report.messages.filter((m) => m.code === "DIFF_UNAVAILABLE");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.text).toContain(REFUSAL);
    expect(unavailable[0]?.text).not.toContain("check out the PR head");
    expect(report.verdict).toBe("fail");
    expect(refused.outputs.verdict).toBe("fail");
    expect(refused.gitCalls.filter((args) => args.includes("diff"))).toEqual([]);

    // With the PR head checked out, the run diffs locally against the PR base, as before.
    const measured = await runOnPullRequestTarget(HEAD_SHA);
    expect(measured.report).toBeDefined();
    expectValidReport(measured.report);
    const diffCalls = measured.gitCalls.filter((args) => args.includes("diff"));
    expect(diffCalls.length).toBeGreaterThan(0);
    expect(diffCalls.some((args) => args.join(" ").includes(`${BASE_SHA}...HEAD`))).toBe(true);
    expect(measured.report?.messages.some((m) => m.code === "DIFF_UNAVAILABLE")).toBe(false);
  });
});
