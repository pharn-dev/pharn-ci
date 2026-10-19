import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// run() is loaded inside each test body: the AC tests are written before coverage discovery exists. The Action runs
// against in-memory deps for a pull_request event in a workspace whose git returns the golden diff and files list,
// whose readFile reads a fake file tree, and whose listDir lists that tree by absolute path.

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
type Message = { code: string; level: string; text: string };

function fakeAction(inputs: Record<string, string>, files: Record<string, string>) {
  const info: string[] = [];
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
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
    writeFile: async (path: string, text: string) => {
      written.set(path, text);
    },
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
  return {
    deps,
    failed,
    info,
    writtenReport: () => {
      const text = written.get(outputs["report-path"] ?? "");
      if (text === undefined) throw new Error(`no report written at report-path ${outputs["report-path"]}`);
      return JSON.parse(text);
    },
  };
}

async function runAction(inputs: Record<string, string>, files: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const action = fakeAction(inputs, files);
  await run(action.deps as never);
  return action;
}

const missingMessages = (report: { messages: Message[] }) =>
  report.messages.filter((message) => message.code === "COVERAGE_FILE_MISSING");

// Unrelated files only: no discovery candidate anywhere in the tree.
const NO_CANDIDATE = { "src/math.ts": "export const x = 1;\n", "docs/coverage.md": "# Coverage\n" };

describe("action: no coverage-file input and no candidate in the workspace", () => {
  it("AC-14: reports COVERAGE_FILE_MISSING naming the candidates, and fails the step only with threshold 80", async () => {
    for (const [threshold, fails] of [
      [null, false],
      ["80", true],
    ] as const) {
      const label = `threshold ${threshold ?? "none"}`;
      const inputs: Record<string, string> = { "coverage-file": "", config: "" };
      if (threshold !== null) inputs.threshold = threshold;
      const action = await runAction(inputs, NO_CANDIDATE);
      const report = action.writtenReport();
      expectValidReport(report);
      const missing = missingMessages(report);
      expect(missing, label).toHaveLength(1);
      expect(missing[0]?.text, label).toContain("coverage/lcov.info");
      expect(missing[0]?.text, label).toContain("**/coverage.cobertura.xml");
      expect(action.failed.length > 0, `${label}: ${action.failed.join(" | ")}`).toBe(fails);
      expect(
        action.info.some((line) => line.includes("(auto-discovered)")),
        label,
      ).toBe(false);
    }
  });

  it("AC-14: coverage-file missing.info wins over a discoverable coverage/lcov.info, with no auto-discovered line", async () => {
    const files = { "coverage/lcov.info": fixture("golden/coverage.info") };

    // Control run: with no coverage-file input the same tree's coverage/lcov.info is discovered, so the explicit
    // run below is a real precedence check, not a tree with nothing to discover.
    const control = await runAction({ "coverage-file": "", config: "" }, files);
    expect(control.failed, "control run").toEqual([]);
    expect(control.info, "control run").toContain("coverage: coverage/lcov.info (auto-discovered)");

    const action = await runAction({ "coverage-file": "missing.info", config: "" }, files);
    const report = action.writtenReport();
    expectValidReport(report);
    const missing = missingMessages(report);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.text).toContain("missing.info");
    expect(missing[0]?.text).not.toContain("coverage/lcov.info");
    expect(action.info.some((line) => line.includes("(auto-discovered)"))).toBe(false);
  });
});
