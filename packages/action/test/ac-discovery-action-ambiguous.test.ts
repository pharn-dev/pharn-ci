import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() is loaded inside the test body: the AC tests are written before coverage discovery exists. The Action runs
// against in-memory deps for a pull_request event with comments on, in a workspace whose git returns the golden
// diff and files list, whose readFile reads a fake file tree, and whose listDir lists that tree by absolute path.
// Every comment API call is recorded.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

type DirEntry = { name: string; kind: "file" | "directory" | "symlink" | "other" };

function fakeAction(inputs: Record<string, string>, files: Record<string, string>) {
  const info: string[] = [];
  const failed: string[] = [];
  const calls = { listComments: 0, createComment: 0, updateComment: 0 };
  const outputs: Record<string, string> = {};
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(WORKSPACE, path), text]));

  const children = new Map<string, Map<string, DirEntry["kind"]>>();
  for (const path of contents.keys()) {
    let child = path;
    let kind: DirEntry["kind"] = "file";
    while (child !== "/") {
      const parent = dirname(child);
      const entries = children.get(parent) ?? new Map<string, DirEntry["kind"]>();
      const name = child.slice(parent === "/" ? 1 : parent.length + 1);
      if (!entries.has(name)) entries.set(name, kind);
      children.set(parent, entries);
      child = parent;
      kind = "directory";
    }
  }

  const deps = {
    getInput: (name: string) => inputs[name] ?? INPUT_DEFAULTS[name] ?? "",
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
      listComments: async () => {
        calls.listComments++;
        return [];
      },
      createComment: async () => {
        calls.createComment++;
        return "github-actions[bot]";
      },
      updateComment: async () => {
        calls.updateComment++;
      },
    },
    git: async (args: string[]) => {
      if (args.includes("ls-files")) {
        const paths = fixture("golden/files.txt").trim().split("\n");
        return args.includes("-z") ? `${paths.join("\0")}\0` : `${paths.join("\n")}\n`;
      }
      if (args.includes("--show-toplevel")) return `${WORKSPACE}\n`;
      if (args.includes("diff")) return fixture("golden/pr.diff");
      return `${BASE_SHA}\n`;
    },
    readFile: async (path: string) => contents.get(path) ?? null,
    listDir: async (path: string): Promise<DirEntry[] | null> => {
      const entries = children.get(path);
      return entries === undefined ? null : [...entries].map(([name, kind]) => ({ name, kind }));
    },
    writeFile: async () => {},
    resolvePath: (...segments: string[]) => resolve(...segments),
    info: (message: string) => {
      info.push(message);
    },
    warning: () => {},
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setFailed: (message: string) => {
      failed.push(message);
    },
    writeSummary: async () => {},
  };
  return { deps, failed, info, calls };
}

describe("action: no coverage-file input and two different candidates in the workspace", () => {
  it("AC-13: fails the step naming both found files and coverage-file, and posts no comment", async () => {
    const { run } = await import("../src/run.js");
    const action = fakeAction(
      { "coverage-file": "", config: "", comment: "true" },
      {
        "lcov.info": fixture("golden/coverage.info"),
        "coverage/cobertura-coverage.xml": fixture("golden-cobertura/coverage.xml"),
      },
    );
    const result = await run(action.deps as never);
    expect(result).toBeUndefined();
    expect(action.failed).toHaveLength(1);
    const [message] = action.failed;
    expect(message).toContain("lcov.info");
    expect(message).toContain("coverage/cobertura-coverage.xml");
    expect(message).toContain("coverage-file");
    expect(action.calls.createComment).toBe(0);
    expect(action.calls.updateComment).toBe(0);
    expect(action.info.some((line) => line.includes("(auto-discovered)"))).toBe(false);
  });
});
