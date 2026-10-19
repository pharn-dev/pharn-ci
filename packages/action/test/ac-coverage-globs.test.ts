import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// run() and the fixtures are loaded inside each test body: the AC tests are written before coverage globs and
// fixtures/coverage-multi/ exist, so nothing that depends on them may run while the file loads. The Action runs
// against in-memory deps for a pull_request event in a workspace whose git returns the golden diff and files list,
// whose readFile reads a fake file tree, and whose listDir lists that tree by absolute path.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (path: string) => readFileSync(new URL(path, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";
const GUID = "6f1c2b9e-3d4a-4c8e-9b7f-0a1e2d3c4b5a";

// What the runner passes when an input is not set: the action.yml default, else "".
const INPUT_DEFAULTS: Record<string, string> = {
  comment: "false",
  "fail-on-threshold": "true",
  config: "",
};

type DirEntry = { name: string; kind: "file" | "directory" | "symlink" | "other" };

function fakeAction(inputs: Record<string, string>, files: Record<string, string>) {
  const info: string[] = [];
  const failed: string[] = [];
  const reads: string[] = [];
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
    readFile: async (path: string) => {
      reads.push(path);
      return contents.get(path) ?? null;
    },
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
    outputs,
    reads,
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

describe("action: several coverage files and globs in coverage-file", () => {
  it("AC-18: a literal path and a coverlet glob, one per line, are both read and merged with no format", async () => {
    const action = await runAction(
      { "coverage-file": "cov/math.info\nTestResults/**/coverage.cobertura.xml" },
      {
        "cov/math.info": fixture("coverage-multi/mixed/math.info"),
        [`TestResults/${GUID}/coverage.cobertura.xml`]: fixture(
          `coverage-multi/coverlet/TestResults/${GUID}/coverage.cobertura.xml`,
        ),
      },
    );
    expect(action.failed).toEqual([]);
    const report = action.writtenReport();
    // src/math.ts from the lcov file; src/new.ts and src/utils/new-name.ts from the coverlet file.
    expect(
      report.diffCoverage.files.map(
        ({ path, coveredLines, coverableLines }: { path: string; coveredLines: number; coverableLines: number }) => ({
          path,
          coveredLines,
          coverableLines,
        }),
      ),
    ).toEqual([
      { path: "src/math.ts", coveredLines: 3, coverableLines: 4 },
      { path: "src/new.ts", coveredLines: 1, coverableLines: 2 },
      { path: "src/utils/new-name.ts", coveredLines: 1, coverableLines: 1 },
    ]);
    expect(report.diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7 });
    expect(report.diffCoverage).not.toHaveProperty("format");
    // Two files are read, so each format line names its file (as written, or as the glob matched it).
    expect(action.formatLines()).toEqual([
      "coverage: cov/math.info: lcov (auto-detected)",
      `coverage: TestResults/${GUID}/coverage.cobertura.xml: cobertura (auto-detected)`,
    ]);
  });

  it("AC-19: a single path with a comma is one file, and ../*.info fails the step naming coverage-file and the pattern", async () => {
    const lcov = fixture("golden/coverage.info");
    const withComma = await runAction({ "coverage-file": "cov/a,b.info" }, { "cov/a,b.info": lcov });
    const withoutComma = await runAction({ "coverage-file": "cov/ab.info" }, { "cov/ab.info": lcov });
    expect(withComma.failed).toEqual([]);
    expect(withComma.reads.filter((path) => path.endsWith(".info"))).toEqual([resolve(WORKSPACE, "cov/a,b.info")]);
    expect(withComma.formatLines()).toEqual(["coverage: lcov (auto-detected)"]);
    expect(withComma.writtenReport()).toEqual(withoutComma.writtenReport());
    expect(withComma.writtenReport().diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7 });

    const parent = await runAction({ "coverage-file": "../*.info" }, { "cov/ab.info": lcov });
    expect(parent.failed).toHaveLength(1);
    expect(parent.failed[0]).toContain("coverage-file");
    expect(parent.failed[0]).toContain("../*.info");
  });
});
