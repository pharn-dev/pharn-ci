import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// AC test for f16-comment-truncation (AC-2). run() is imported inside the test body. The Action runs against
// in-memory deps for a pull_request event with comment "true"; the body handed to createComment is captured.
// One `it` for the AC: its second clause (messages alone too long) already holds before the build.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const TRUNCATED_LINE = "_Truncated: the full report is in the job summary and report.json._";

const INPUT_DEFAULTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: ".pharn/ci.yml",
};

/** 50 agent setup files, each with a path of `width` characters plus a short suffix. */
function longSkillPaths(width: number): string[] {
  return Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(width)}${i}/SKILL.md`);
}

function fakeAction(inputs: Record<string, string>, extraTracked: string[]) {
  const comments: string[] = [];
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
      createComment: async (_issue: number, body: string) => {
        comments.push(body);
      },
      updateComment: async (_id: number, body: string) => {
        comments.push(body);
      },
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
    writeSummary: async () => {},
  };
  return { deps, comments };
}

async function runAction(inputs: Record<string, string>, extraTracked: string[]) {
  const { run } = await import("../src/run.js");
  const action = fakeAction(inputs, extraTracked);
  const report = await run(action.deps as never);
  if (report === undefined) throw new Error("run() returned no report");
  expectValidReport(report);
  expect(action.comments).toHaveLength(1);
  return { report, body: action.comments[0] as string };
}

describe("action: PR comment fitted under GitHub's size limit (f16-comment-truncation)", () => {
  it("AC-2: keeps the marker, verdict heading and every message code in an oversized comment", async () => {
    const { COMMENT_MARKER, MAX_COMMENT_LENGTH } = await import("../src/run.js");
    expect(MAX_COMMENT_LENGTH).toBe(65_000);

    // A report far over the limit: 50 agent setup files with 2,000-character paths, plus a coverage gate.
    const big = await runAction({ "coverage-file": "coverage.info", threshold: "80" }, longSkillPaths(2_000));
    expect(big.report.messages.length).toBeGreaterThan(0);
    expect(big.body.length).toBeLessThanOrEqual(65_000);
    expect(big.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(big.body).toContain(`pharn-ci: ${big.report.verdict}`);
    for (const message of big.report.messages) {
      expect(big.body, message.code).toContain(`\`${message.code}\``);
    }
    const lastLine = big.body.trimEnd().split("\n").at(-1);
    expect(lastLine).toBe(TRUNCATED_LINE);

    // Messages alone over the limit: a 70,000-character coverage path that does not exist.
    const longPath = `${"m".repeat(70_000)}.info`;
    const huge = await runAction({ "coverage-file": longPath }, []);
    expect(huge.report.messages.map((m) => m.code)).toContain("COVERAGE_FILE_MISSING");
    expect(huge.body.length).toBeLessThanOrEqual(65_000);
    expect(huge.body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(huge.body).toContain(`pharn-ci: ${huge.report.verdict}`);
  });
});
