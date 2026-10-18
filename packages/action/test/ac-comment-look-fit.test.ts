import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// AC test for pr-comment-redesign-2 (AC-6). run() and the renderer are imported inside the test body. The Action
// runs against in-memory deps for a pull_request event with comment "true"; the body handed to createComment is
// captured. One `it` for the AC. No snapshot: the expected values are derived inline.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const INPUTS: Record<string, string> = {
  comment: "true",
  "fail-on-threshold": "true",
  config: "",
  "coverage-file": "coverage.info",
  threshold: "80",
};

/** 50 agent setup files with 2,000-character paths: enough table text to push the render past the limit. */
const LONG_SKILLS = Array.from({ length: 50 }, (_, i) => `.claude/skills/${"x".repeat(2_000)}${i}/SKILL.md`);

function fakeAction() {
  const comments: string[] = [];
  const tracked = [...fixture("golden/files.txt").trim().split("\n"), ...LONG_SKILLS];
  const contents = new Map([[resolve(WORKSPACE, "coverage.info"), fixture("golden/coverage.info")]]);
  const deps = {
    getInput: (name: string) => INPUTS[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
      ref: "refs/pull/7/merge",
      workflow: "CI",
      job: "pharn",
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
        return "github-actions[bot]";
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

describe("action: redesigned PR comment fitted under the size limit (pr-comment-redesign-2)", () => {
  it("AC-6: keeps the marker, scope line, verdict header, summary block and every message line", async () => {
    const { run, COMMENT_MARKER, commentScopeLine, MAX_COMMENT_LENGTH } = await import("../src/run.js");
    const { renderMarkdown } = await import("@pharn-ci/core");
    expect(MAX_COMMENT_LENGTH).toBe(65_000);

    const action = fakeAction();
    const report = await run(action.deps as never);
    if (report === undefined) throw new Error("run() returned no report");
    expectValidReport(report);
    expect(action.comments).toHaveLength(1);
    const body = action.comments[0] as string;

    // The Given: the full rendering is over the limit because of its tables.
    const full = renderMarkdown(report);
    expect(full.length).toBeGreaterThan(65_000);
    const fullLines = full.split("\n");

    expect(body.length).toBeLessThanOrEqual(65_000);
    // The golden coverage (71.43%) is under the threshold of 80: the verdict is fail.
    expect(report.verdict).toBe("fail");
    const heading = "## 🛡️ pharn-ci · ❌ Fail";
    // The rendering opens with the fixed logo line (pr-comment-logo-2), an empty line, then the heading.
    const logo =
      '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';
    expect(fullLines[0]).toBe(logo);
    expect(fullLines[1]).toBe("");
    expect(fullLines[2]).toBe(heading);
    expect(body.startsWith(`${COMMENT_MARKER}\n${commentScopeLine("CI", "pharn")}\n${logo}\n\n${heading}\n`)).toBe(
      true,
    );

    const bodyLines = new Set(body.split("\n"));

    // The summary block: the non-empty lines between the verdict heading and `### 🧪 Diff coverage`.
    const headingAt = fullLines.indexOf(heading);
    const diffAt = fullLines.indexOf("### 🧪 Diff coverage");
    expect(diffAt).toBeGreaterThan(headingAt);
    const summary = fullLines.slice(headingAt + 1, diffAt).filter((l) => l.trim() !== "");
    expect(summary.length, "summary block in the full rendering").toBeGreaterThan(0);
    for (const line of summary) expect(bodyLines.has(line), `summary line kept: ${line}`).toBe(true);

    // Every message line of the report.
    expect(report.messages.length).toBeGreaterThan(0);
    const messagesAt = fullLines.findIndex((l) => l.startsWith("### 💬 Messages ("));
    const setupAt = fullLines.findIndex((l) => l.startsWith("### 🤖 Agent setup ("));
    expect(setupAt).toBeGreaterThan(messagesAt);
    const messageLines = fullLines.slice(messagesAt + 1, setupAt).filter((l) => l.startsWith("- "));
    expect(messageLines).toHaveLength(report.messages.length);
    for (const line of messageLines) expect(bodyLines.has(line), `message line kept: ${line}`).toBe(true);
  });
});
