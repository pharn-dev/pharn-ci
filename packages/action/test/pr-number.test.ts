import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/run.js";

// Run-level behaviour of PR-number mode beyond the acceptance criteria. The harness shape is copied from the AC tests.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);
const LOCAL_TIP = "4".repeat(40);

const INPUT_DEFAULTS: Record<string, string> = { comment: "true", "fail-on-threshold": "true", config: "" };

interface Options {
  eventName?: string;
  payload?: object;
  inputs: Record<string, string>;
  getPullRequestError?: Error;
  listTreeError?: Error;
  compareError?: Error;
}

async function runWith(opts: Options) {
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info", ...opts.inputs };
  const failed: string[] = [];
  const warnings: string[] = [];
  const written = new Map<string, string>();
  const calls = { compare: [] as string[], tree: [] as string[], created: [] as unknown[][], git: [] as string[][] };
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: opts.eventName ?? "workflow_run",
      sha: LOCAL_TIP,
      payload: opts.payload ?? { workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA } },
    },
    workspace: WORKSPACE,
    tempDir: "/home/runner/work/_temp",
    api: {
      getPullRequest: async (n: number) => {
        if (opts.getPullRequestError) throw opts.getPullRequestError;
        if (n !== 42) throw new Error("Not Found");
        return { baseSha: BASE_SHA, headSha: HEAD_SHA };
      },
      listTree: async (sha: string) => {
        calls.tree.push(sha);
        if (opts.listTreeError) throw opts.listTreeError;
        return { paths: ["src/math.ts", "AGENTS.md"], truncated: false };
      },
      compareDiff: async (basehead: string) => {
        calls.compare.push(basehead);
        if (opts.compareError) throw opts.compareError;
        return fixture("golden/pr.diff");
      },
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async (...args: unknown[]) => {
        calls.created.push(args);
      },
      updateComment: async () => {},
      deleteComment: async () => {},
    },
    git: async (args: string[]) => {
      calls.git.push(args);
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
  const report = await run(deps as never);
  return { report, failed, warnings, calls, written };
}

describe("PR-number mode", () => {
  it("fails the step, with no report and no comment, when the pull request cannot be read", async () => {
    const r = await runWith({
      inputs: { "pr-number": "42" },
      getPullRequestError: new Error("Resource not accessible"),
    });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain("#42");
    expect(r.failed[0]).toContain("Resource not accessible");
    expect(r.report).toBeUndefined();
    expect(r.written.size).toBe(0);
    expect(r.calls.created).toEqual([]);
    expect(r.calls.compare).toEqual([]);
  });

  it("warns and still reports when the file list cannot be read", async () => {
    const r = await runWith({ inputs: { "pr-number": "42", "head-sha": HEAD_SHA }, listTreeError: new Error("boom") });
    expect(r.failed).toEqual([]);
    expect(r.warnings.some((w) => w.includes("boom"))).toBe(true);
    expect(r.report?.agentSetup.files).toEqual([]);
    expect(r.calls.created).toHaveLength(1);
  });

  it("reports DIFF_UNAVAILABLE when the compare fails and no base-ref was given", async () => {
    const r = await runWith({
      inputs: { "pr-number": "42", "head-sha": HEAD_SHA },
      compareError: new Error("diff too large"),
    });
    expect(r.failed).toEqual([]);
    expect(r.report?.messages.map((m) => m.code)).toContain("DIFF_UNAVAILABLE");
    expect(r.report?.messages.find((m) => m.code === "DIFF_UNAVAILABLE")?.text).toContain(
      `${BASE_SHA}...${HEAD_SHA} from the GitHub API`,
    );
    expect(r.warnings.some((w) => w.includes("diff too large"))).toBe(true);
  });

  it("fails the step when the compare fails for an explicit base-ref", async () => {
    const r = await runWith({
      inputs: { "pr-number": "42", "head-sha": HEAD_SHA, "base-ref": "no-such-branch" },
      compareError: new Error("Not Found"),
    });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain("base-ref");
    expect(r.failed[0]).not.toContain("fetch-depth");
    expect(r.calls.created).toEqual([]);
  });

  it("posts nothing with comment: false, but still reports", async () => {
    const r = await runWith({ inputs: { "pr-number": "42", "head-sha": HEAD_SHA, comment: "false" } });
    expect(r.failed).toEqual([]);
    expect(r.report).toBeDefined();
    expect(r.calls.created).toEqual([]);
  });

  it("never touches the local git checkout", async () => {
    const r = await runWith({ inputs: { "pr-number": "42", "head-sha": HEAD_SHA } });
    expect(r.calls.git).toEqual([]);
    expect(r.calls.tree).toEqual([HEAD_SHA]);
  });

  it("behaves as today on a pull_request event whose payload number equals pr-number", async () => {
    const r = await runWith({
      eventName: "pull_request",
      payload: { pull_request: { number: 7, base: { sha: BASE_SHA }, head: { sha: HEAD_SHA } } },
      inputs: { "pr-number": "7", "head-sha": HEAD_SHA },
    });
    // Local git is not faked here, so the diff comes from the compare API, and the file list from git (which fails).
    expect(r.failed).toEqual([]);
    expect(r.calls.tree).toEqual([]);
    expect(r.calls.compare).toEqual([`${BASE_SHA}...${LOCAL_TIP}`]);
    expect(r.calls.created).toHaveLength(1);
    expect(r.calls.created[0]?.[0]).toBe(7);
  });

  it("does not echo an invalid pr-number or head-sha value", async () => {
    const bad = await runWith({ inputs: { "pr-number": "4x2\nINJECTED" } });
    expect(bad.failed).toHaveLength(1);
    expect(bad.failed[0]).toContain("pr-number");
    expect(bad.failed[0]).not.toContain("INJECTED");

    const badSha = await runWith({ inputs: { "pr-number": "42", "head-sha": "zzINJECTEDzz" } });
    expect(badSha.failed).toHaveLength(1);
    expect(badSha.failed[0]).toContain("head-sha");
    expect(badSha.failed[0]).not.toContain("INJECTED");
  });
});
