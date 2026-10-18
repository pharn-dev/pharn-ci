import { describe, expect, it } from "vitest";

// The run() harness (packages/action/test/harness.ts) and run() are loaded inside each test body: these AC tests are
// written before the build, which creates the shared harness with its lsFilesError, summaryError and diffError
// options and its infos list.

const BASE_SHA = "a".repeat(40);

describe("action run() degradation paths", () => {
  it("AC-1: warns and still reports and sets outputs when git ls-files rejects", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ lsFilesError: new Error("fatal: not a git repository") });

    const report = await run(h.deps);

    expect(report).toBeDefined();
    expect(h.warnings.join("\n")).toContain("git ls-files failed, agent setup scan skipped");
    expect(h.outputs.verdict).toBe(report?.verdict);
    expect(h.outputs["report-path"]).toBe("/tmp/runner/pharn-ci/report.json");
  });

  it("AC-1: warns, still sets outputs and still posts the PR comment when the job summary write rejects", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ summaryError: new Error("EACCES: permission denied") });

    const report = await run(h.deps);

    expect(report).toBeDefined();
    expect(h.warnings.join("\n")).toContain("could not write job summary");
    expect(h.outputs.verdict).toBe(report?.verdict);
    expect(h.outputs["report-path"]).toBe("/tmp/runner/pharn-ci/report.json");
    expect(h.apiCalls).toContain("create 7");
    expect(h.comments).toHaveLength(1);
  });

  it("AC-1: falls back to the GitHub compare API when the base resolves locally but git diff rejects", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ diffError: new Error("fatal: bad revision") });

    const report = await run(h.deps);

    // The base resolved locally (rev-parse succeeded) and the local diff was attempted before the fallback.
    expect(h.gitCalls.some((a) => a[0] === "diff")).toBe(true);
    expect(h.infos.join("\n")).toContain("local git diff failed, falling back to the GitHub API");
    expect(h.apiCalls).toContain(`compare ${BASE_SHA}...merge000`);
    // The compare fixture (fixtures/golden/pr.diff against fixtures/golden/coverage.info) measures 71.43%.
    expect(report?.diffCoverage?.percent).toBe(71.43);
  });

  it("AC-1: fails the step with the config path and the parser's message when .pharn/ci.yml does not parse", async () => {
    const { run } = await import("../src/run.js");
    const { harness, WORKSPACE } = await import("./harness.js");
    const { parseConfig } = await import("@pharn-ci/core");
    const text = "coverage:\n\tthreshold: 90\n";

    let parserMessage: string | undefined;
    try {
      parseConfig(text);
    } catch (err) {
      parserMessage = err instanceof Error ? err.message : String(err);
    }
    expect(parserMessage, "the config parser rejects tab-indented text").toBeDefined();

    const h = harness({ files: { [`${WORKSPACE}/.pharn/ci.yml`]: text } });

    expect(await run(h.deps)).toBeUndefined();
    // run() labels every step failure "pharn-ci: "; the message after that label starts with the config path.
    expect(h.failed).toEqual([`pharn-ci: .pharn/ci.yml: ${parserMessage}`]);
  });
});
