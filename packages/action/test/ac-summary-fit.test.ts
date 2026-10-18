import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// AC test for f16-comment-truncation (AC-3). run() is imported inside the test body. The Action runs against
// in-memory deps for a pull_request event; the markdown handed to writeSummary is captured. One `it` for the AC:
// its second clause (a summary over 65,000 characters stays full) already holds before the build.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const ONE_MIB = 1_048_576;

const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

/** 50 agent setup files, each with a path of `width` characters plus a short suffix. */
function longSkillPaths(width: number): string[] {
  return Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(width)}${i}/SKILL.md`);
}

function fakeAction(inputs: Record<string, string>, extraTracked: string[]) {
  const summaries: string[] = [];
  const tracked = [...fixture("golden/files.txt").trim().split("\n"), ...extraTracked];
  const contents = new Map([[resolve(WORKSPACE, "coverage.info"), fixture("golden/coverage.info")]]);
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
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        return args.includes("-z") ? `${tracked.join("\0")}\0` : `${tracked.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${WORKSPACE}\n`;
      if (args.includes("diff")) return fixture("golden/pr.diff");
      return `${BASE_SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    writeFile: async () => {},
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: () => {},
    warning: () => {},
    setOutput: () => {},
    setFailed: () => {},
    writeSummary: async (markdown: string) => {
      summaries.push(markdown);
    },
  };
  return { deps, summaries };
}

async function runAction(inputs: Record<string, string>, extraTracked: string[]) {
  const { run } = await import("../src/run.js");
  const action = fakeAction(inputs, extraTracked);
  const report = await run(action.deps as never);
  if (report === undefined) throw new Error("run() returned no report");
  expectValidReport(report);
  expect(action.summaries).toHaveLength(1);
  return { report, summary: action.summaries[0] as string };
}

describe("action: job summary fitted under GitHub's 1 MiB limit (f16-comment-truncation)", () => {
  it("AC-3: keeps an oversized job summary under 1 MiB with the verdict and every message code", async () => {
    const inputs = { "coverage-file": "coverage.info", threshold: "80" };

    // Full render over 1 MiB: 50 agent setup files with 25,000-character paths.
    const huge = await runAction(inputs, longSkillPaths(25_000));
    expect(huge.report.messages.length).toBeGreaterThan(0);
    expect(Buffer.byteLength(huge.summary, "utf8")).toBeLessThan(ONE_MIB);
    expect(huge.summary).toContain(`pharn-ci: ${huge.report.verdict}`);
    for (const message of huge.report.messages) {
      expect(huge.summary, message.code).toContain(`\`${message.code}\``);
    }

    // Over 65,000 characters but under 1 MiB (the existing truncation test's report): the summary stays long.
    const big = await runAction(inputs, longSkillPaths(2_000));
    expect(big.summary.length).toBeGreaterThan(65_000);
    expect(Buffer.byteLength(big.summary, "utf8")).toBeLessThan(ONE_MIB);
  });
});
