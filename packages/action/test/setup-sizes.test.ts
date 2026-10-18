import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() is loaded inside each test body, like the other action tests. The action runs against in-memory deps for a
// pull_request event whose diff comes from the compare API; `git ls-tree` answers with sizes or fails.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const BLOB = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391";

const INPUT_DEFAULTS: Record<string, string> = { comment: "false", "fail-on-threshold": "true", config: "" };

const lsTreeOutput = () =>
  fixture("golden/files.txt")
    .trim()
    .split("\n")
    .map((path) => `100644 blob ${BLOB} ${String(path === "CLAUDE.md" ? 0 : 120).padStart(7, " ")}\t${path}\0`)
    .join("");

async function runAction(lsTree: "sizes" | "fails") {
  const { run } = await import("../src/run.js");
  const warnings: string[] = [];
  const written = new Map<string, string>();
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  const files = new Map([[resolve(WORKSPACE, "coverage/lcov.info"), fixture("golden/coverage.info")]]);
  const inputs: Record<string, string> = { "coverage-file": "coverage/lcov.info" };
  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
    context: {
      eventName: "pull_request",
      sha: HEAD_SHA,
      ref: "refs/pull/7/merge",
      repo: { owner: "octo", repo: "demo" },
      issue: { owner: "octo", repo: "demo", number: 7 },
      payload: {
        pull_request: { number: 7, base: { sha: BASE_SHA, ref: "main" }, head: { sha: HEAD_SHA, ref: "feature" } },
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
      if (args[0] === "ls-tree") {
        if (lsTree === "fails") throw new Error("fatal: not a valid object name HEAD");
        return lsTreeOutput();
      }
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      throw new Error("fatal: bad object");
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
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  await run(deps as never);
  const reportPath = outputs["report-path"] ?? "";
  const report = JSON.parse(written.get(reportPath) ?? "{}") as {
    verdict: string;
    messages: { code: string; level: string; text: string }[];
  };
  return { report, warnings, outputs, failed };
}

describe("action: empty agent setup files", () => {
  it("reports an empty CLAUDE.md found by git ls-tree", async () => {
    const { report, warnings } = await runAction("sizes");
    expect(report.messages.filter((m) => m.code === "AGENT_SETUP_FILE_EMPTY")).toEqual([
      { level: "warn", code: "AGENT_SETUP_FILE_EMPTY", text: "1 agent setup file is empty: `CLAUDE.md`." },
    ]);
    expect(report.verdict).toBe("warn");
    expect(warnings).toEqual([]);
  });

  it("warns once about a failing git ls-tree, reports no empty files and keeps the verdict it would have had", async () => {
    const { report, warnings, failed } = await runAction("fails");
    expect(report.messages.some((m) => m.code === "AGENT_SETUP_FILE_EMPTY")).toBe(false);
    expect(warnings.filter((w) => w.includes("git ls-tree"))).toHaveLength(1);
    expect(report.verdict).toBe("pass");
    expect(failed).toEqual([]);
  });
});
