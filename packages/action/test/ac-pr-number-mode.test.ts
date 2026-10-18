import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// run() is loaded inside each test body, like the other AC tests: they are written before the build.
// PR-number mode: the event has no pull_request payload and the pr-number input names the PR. The GitHub API serves
// PR 42 (base A, head B), its tree and the compare diff; the local git answers too, so a run that used the local
// checkout instead of the API would show in the recorded calls.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const OTHER_SHA = "6666666666666666666666666666666666666666";
const DEFAULT_BRANCH_TIP = "4444444444444444444444444444444444444444";
const HEAD_SHA_EXPRESSION = ["$", "{{ github.event.workflow_run.head_sha }}"].join("");

// The PR head's tree: the golden change's source files plus agent setup files the local checkout does not have.
const TREE_PATHS = ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts", "packages/api/AGENTS.md"];
// The local (default-branch) checkout: a different agent setup file, so a report built from it is told apart.
const LOCAL_PATHS = ["README.md", "src/math.ts", ".cursor/rules/style.mdc"];

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: "",
  "github-token": "test-token",
};

function contextFor(eventName: string) {
  return {
    eventName,
    sha: DEFAULT_BRANCH_TIP,
    ref: "refs/heads/main",
    repo: { owner: "octo", repo: "demo" },
    issue: { owner: "octo", repo: "demo" },
    payload:
      eventName === "workflow_run"
        ? { workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA } }
        : { inputs: {}, ref: "refs/heads/main" },
  };
}

type Report = {
  verdict: string;
  diffCoverage: { percent: number | null; coveredLines: number; coverableLines: number } | null;
  agentSetup: { files: { path: string; kind: string }[] };
  messages: { code: string; level: string; text: string }[];
};

interface RunOptions {
  eventName?: string;
  inputs: Record<string, string>;
  truncated?: boolean;
}

async function runPrNumberMode({ eventName = "workflow_run", inputs, truncated = false }: RunOptions) {
  const { run } = await import("../src/run.js");
  const allInputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", ...inputs };
  const failed: string[] = [];
  const warnings: string[] = [];
  const written = new Map<string, string>();
  const calls = {
    git: [] as string[][],
    getPullRequest: [] as unknown[],
    listTree: [] as unknown[],
    compareDiff: [] as unknown[],
    createComment: [] as unknown[][],
    updateComment: [] as unknown[][],
  };
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    getInput: (name: string) => allInputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: contextFor(eventName),
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (pullNumber: number) => {
        calls.getPullRequest.push(pullNumber);
        if (pullNumber === 42) return { baseSha: BASE_SHA, headSha: HEAD_SHA };
        throw new Error("Not Found");
      },
      listTree: async (sha: string) => {
        calls.listTree.push(sha);
        return { paths: TREE_PATHS, truncated };
      },
      compareDiff: async (basehead: string) => {
        calls.compareDiff.push(basehead);
        return fixture("golden/pr.diff");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async (...args: unknown[]) => {
        calls.createComment.push(args);
      },
      updateComment: async (...args: unknown[]) => {
        calls.updateComment.push(args);
      },
    },
    git: async (args: string[]) => {
      calls.git.push(args);
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${LOCAL_PATHS.join("\0")}\0` : `${LOCAL_PATHS.join("\n")}\n`;
      }
      if (args[0] === "rev-parse" && args.includes("HEAD")) return `${DEFAULT_BRANCH_TIP}\n`;
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
    warning: (message: string) => {
      warnings.push(message);
    },
    setOutput: () => {},
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  const returned = (await run(deps as never)) as Report | undefined;
  const reportText = [...written.entries()].find(([path]) => path.endsWith("report.json"))?.[1];
  const report: Report | undefined = returned ?? (reportText ? JSON.parse(reportText) : undefined);
  return { report, failed, warnings, calls };
}

const gitCallsOf = (calls: { git: string[][] }, command: string) => calls.git.filter((args) => args.includes(command));

describe("action: PR-number mode", () => {
  it("AC-5: measures the PR from the GitHub API and comments on it, without the local checkout", async () => {
    const { report, failed, calls } = await runPrNumberMode({ inputs: { "pr-number": "42", "head-sha": HEAD_SHA } });

    expect(failed).toEqual([]);
    expect(calls.getPullRequest).toEqual([42]);
    expect(calls.compareDiff).toEqual([`${BASE_SHA}...${HEAD_SHA}`]);
    expect(gitCallsOf(calls, "diff")).toEqual([]);
    expect(gitCallsOf(calls, "ls-files")).toEqual([]);
    expect(calls.listTree).toEqual([HEAD_SHA]);

    expect(report).toBeDefined();
    expectValidReport(report);
    const setupPaths = (report as Report).agentSetup.files.map((f) => f.path);
    expect(setupPaths).toContain("packages/api/AGENTS.md");
    expect(setupPaths).not.toContain(".cursor/rules/style.mdc");
    expect((report as Report).diffCoverage).not.toBeNull();
    expect((report as Report).diffCoverage?.percent).toBe(71.43);
    expect((report as Report).diffCoverage?.coverableLines).toBe(7);

    expect(calls.createComment).toHaveLength(1);
    expect(calls.createComment[0]?.[0]).toBe(42);
    expect(calls.updateComment).toEqual([]);
  });

  it("AC-6: fails naming head-sha when it is not the PR head, and accepts the head in uppercase", async () => {
    const stale = await runPrNumberMode({ inputs: { "pr-number": "42", "head-sha": OTHER_SHA } });
    expect(stale.failed.length).toBeGreaterThan(0);
    expect(stale.failed.join("\n")).toContain("head-sha");
    expect(stale.calls.compareDiff).toEqual([]);
    expect(stale.calls.createComment).toEqual([]);
    expect(stale.calls.updateComment).toEqual([]);

    const upper = await runPrNumberMode({ inputs: { "pr-number": "42", "head-sha": HEAD_SHA.toUpperCase() } });
    expect(upper.failed.filter((m) => m.includes("head-sha"))).toEqual([]);
    expect(upper.calls.getPullRequest).toEqual([42]);
    expect(upper.calls.compareDiff).toEqual([`${BASE_SHA}...${HEAD_SHA}`]);
  });

  it("AC-7: diffs from base-ref to the PR head when base-ref is given", async () => {
    const baseRef = "release-1.0";
    const { calls } = await runPrNumberMode({
      inputs: { "pr-number": "42", "head-sha": HEAD_SHA, "base-ref": baseRef },
    });
    expect(calls.getPullRequest).toEqual([42]);
    expect(calls.compareDiff).toEqual([`${baseRef}...${HEAD_SHA}`]);
    expect(gitCallsOf(calls, "diff")).toEqual([]);
  });

  it("AC-8: warns on workflow_run without head-sha, recommending the workflow_run head SHA", async () => {
    const workflowRun = await runPrNumberMode({ inputs: { "pr-number": "42" } });
    const recommending = workflowRun.warnings.filter((m) => m.includes("head-sha") && m.includes(HEAD_SHA_EXPRESSION));
    expect(recommending).toHaveLength(1);
    expect(workflowRun.calls.compareDiff).toEqual([`${BASE_SHA}...${HEAD_SHA}`]);

    const dispatch = await runPrNumberMode({ eventName: "workflow_dispatch", inputs: { "pr-number": "42" } });
    expect(dispatch.calls.getPullRequest).toEqual([42]);
    expect(dispatch.warnings.filter((m) => m.includes("workflow_run.head_sha"))).toEqual([]);
  });

  it("AC-9: warns when the PR head's tree listing is truncated and still produces the report", async () => {
    const { report, warnings, calls } = await runPrNumberMode({
      inputs: { "pr-number": "42", "head-sha": HEAD_SHA },
      truncated: true,
    });
    expect(calls.listTree).toEqual([HEAD_SHA]);
    expect(warnings.some((m) => m.includes("truncated"))).toBe(true);
    expect(report).toBeDefined();
    expectValidReport(report);
  });
});
