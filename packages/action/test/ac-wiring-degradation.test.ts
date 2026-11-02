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

  // block-fails-closed-unavailable (review HIGH 4): a base that resolves locally but whose git diff rejects now fails
  // the step instead of falling back to the compare API (which cannot give the test text).
  it("AC-1: fails the step when the base resolves locally but git diff rejects, with no compare API call", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    const h = harness({ diffError: new Error("fatal: bad revision") });

    const report = await run(h.deps);

    // The base resolved locally (rev-parse succeeded) and the local diff was attempted.
    expect(h.gitCalls.some((a) => a[0] === "diff")).toBe(true);
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0]).toContain(BASE_SHA);
    expect(h.failed[0]).toContain("fatal: bad revision");
    expect(h.failed[0]).toContain("fetch-depth: 0");
    expect(h.apiCalls.filter((c) => c.startsWith("compare"))).toEqual([]);
    expect(report).toBeUndefined();
  });

  // block-fails-closed-unavailable (review HIGH 4): the compare-API fallback stays for a base that does not resolve
  // locally (a shallow checkout); only a failed local diff against a base that resolves stopped falling back.
  it("AC-1: falls back to the GitHub compare API when the base does not resolve locally (a shallow checkout)", async () => {
    const { run } = await import("../src/run.js");
    const { harness } = await import("./harness.js");
    // A local git diff would reject too, so a run that tried one would fail the step instead of reaching the API.
    const h = harness({ localGit: false, diffError: new Error("fatal: bad revision") });

    const report = await run(h.deps);

    // The base did not resolve locally (rev-parse rejected), so no local diff was attempted before the fallback, and
    // the old "local diff failed" fallback line is never written.
    expect(h.gitCalls.some((a) => a[0] === "rev-parse")).toBe(true);
    expect(h.gitCalls.some((a) => a[0] === "diff")).toBe(false);
    expect(h.infos.join("\n")).not.toContain("local git diff failed, falling back to the GitHub API");
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
