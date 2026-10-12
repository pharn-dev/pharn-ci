import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ActionContext, ActionDeps } from "../src/run.js";

// run() is imported inside each test body, like the other AC tests written before the build.

const FIXTURES = new URL("../../../fixtures/", import.meta.url);
const fixture = (p: string) => readFileSync(new URL(p, FIXTURES), "utf8");

const WORKSPACE = "/home/runner/work/demo/demo";
const REPORT_PATH = "/tmp/runner/pharn-ci/report.json";
const PR_CONTEXT: ActionContext = {
  eventName: "pull_request",
  sha: "merge000",
  payload: { pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } } },
};

interface Harness {
  deps: ActionDeps;
  outputs: Record<string, string>;
  failed: string[];
  written: Record<string, string>;
}

/** A pull_request run on fixtures/golden/, diffed locally, with comments off. */
function harness(inputs: Record<string, string>, files: Record<string, string> = {}): Harness {
  const h: Harness = { outputs: {}, failed: [], written: {}, deps: undefined as never };
  const allFiles: Record<string, string> = {
    [`${WORKSPACE}/coverage/lcov.info`]: fixture("golden/coverage.info"),
    ...files,
  };
  const allInputs: Record<string, string> = {
    "coverage-file": "coverage/lcov.info",
    comment: "false",
    "fail-on-threshold": "true",
    config: ".pharn/ci.yml",
    ...inputs,
  };
  h.deps = {
    getInput: (name) => allInputs[name] ?? "",
    context: PR_CONTEXT,
    workspace: WORKSPACE,
    tempDir: "/tmp/runner",
    api: {
      compareDiff: async () => fixture("golden/pr.diff"),
      viewerLogin: async () => "github-actions[bot]",
      listComments: async () => [],
      createComment: async () => {},
      updateComment: async () => {},
    },
    async git(args) {
      if (args[0] === "ls-files") return `${fixture("golden/files.txt").trim().split("\n").join("\0")}\0`;
      if (args[0] === "rev-parse" && args[1] === "HEAD") return `${"c".repeat(40)}\n`;
      if (args[0] === "rev-parse") return "ok\n";
      if (args[0] === "diff") return fixture("golden/pr.diff");
      throw new Error(`unexpected git ${args.join(" ")}`);
    },
    readFile: async (p) => allFiles[p] ?? null,
    async writeFile(p, text) {
      h.written[p] = text;
    },
    resolvePath: (...segments) =>
      segments.reduce((acc, s) => (s.startsWith("/") ? s : `${acc.replace(/\/$/, "")}/${s.replace(/^\.\//, "")}`), ""),
    info: () => {},
    warning: () => {},
    setOutput: (name, value) => {
      h.outputs[name] = value;
    },
    setFailed: (m) => h.failed.push(m),
    writeSummary: async () => {},
  };
  return h;
}

describe("action input exclude", () => {
  it("AC-20: merges the exclude input with coverage.exclude, ignoring blank entries", async () => {
    const { run } = await import("../src/run.js");
    const h = harness(
      // Three patterns, separated by a comma and by newlines, with blank entries and surrounding spaces.
      { exclude: " src/utils/** ,\n\n , README.md\n  docs/** ,\n" },
      { [`${WORKSPACE}/.pharn/ci.yml`]: "coverage:\n  exclude:\n    - src/new.ts\n" },
    );
    await run(h.deps);

    expect(h.failed).toEqual([]);
    const written = h.written[REPORT_PATH];
    expect(written).toBeDefined();
    const report = JSON.parse(written as string);
    expect(report.diffCoverage.excludedFiles).toEqual(["README.md", "src/new.ts", "src/utils/new-name.ts"]);
    expect(report.diffCoverage.files.map((f: { path: string }) => f.path)).toEqual(["src/math.ts"]);
    // Unexcluded, the golden change is 71.43%; without the excluded files it is 3/4 = 75%.
    expect(report.diffCoverage.percent).toBe(75);
    expect(h.outputs["diff-coverage"]).toBe(String(report.diffCoverage.percent));
  });

  it("AC-21: fails the step naming a rejected pattern in the exclude input", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ exclude: "src/**,\n[ab].ts" });
    await run(h.deps);
    expect(h.failed.length).toBeGreaterThan(0);
    expect(h.failed.join("\n")).toContain("[ab].ts");
  });
});
