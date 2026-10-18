import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() and the fixtures are loaded inside each test body: the AC tests are written before format selection,
// clover.xml and fixtures/golden-cobertura/ exist, so nothing that depends on them may run while the file loads.
// The Action runs against in-memory deps for a pull_request event in a workspace whose git returns the golden diff
// and files list.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

function fakeAction(inputs: Record<string, string>, files: Record<string, string>) {
  const info: string[] = [];
  const failed: string[] = [];
  const outputs: Record<string, string> = {};
  const written = new Map<string, string>();
  const contents = new Map(Object.entries(files).map(([path, text]) => [resolve(WORKSPACE, path), text]));
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
    outputs,
    formatLines: () => info.filter((line) => line.startsWith("coverage: ")),
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

describe("action: coverage-format input", () => {
  it("AC-19: reads a Cobertura file with coverage-format cobertura and with no format at all", async () => {
    const files = { "coverage.xml": fixture("golden-cobertura/coverage.xml") };
    for (const [inputs, line] of [
      [{ "coverage-file": "coverage.xml", "coverage-format": "cobertura" }, "coverage: cobertura (configured)"],
      [{ "coverage-file": "coverage.xml" }, "coverage: cobertura (auto-detected)"],
    ] as const) {
      const action = await runAction(inputs, files);
      expect(action.failed, line).toEqual([]);
      expect(action.writtenReport().diffCoverage.format, line).toBe("cobertura");
      expect(action.formatLines(), line).toEqual([line]);
    }
  });

  it("AC-20: fails on coverage-format clover, and fails the verdict on a Clover file under auto", async () => {
    const files = { "coverage.xml": fixture("cobertura/clover.xml") };

    const clover = await runAction({ "coverage-file": "coverage.xml", "coverage-format": "clover" }, files);
    expect(clover.failed).toHaveLength(1);
    for (const word of ["clover", "lcov", "cobertura", "auto"]) {
      expect(clover.failed[0], word).toContain(word);
    }

    const auto = await runAction({ "coverage-file": "coverage.xml", threshold: "80" }, files);
    expect(auto.outputs.verdict).toBe("fail");
    const codes = auto.writtenReport().messages.map((message: { code: string }) => message.code);
    expect(codes).toContain("COVERAGE_FORMAT_UNSUPPORTED");
  });
});
