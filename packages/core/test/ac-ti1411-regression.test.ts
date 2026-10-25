import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC tests are written before TI14 and TI11 exist, so nothing the build
// adds may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

/** The TI01 fixtures and what TI01 reports for them in mode block, which this increment must not change. */
const TI01_FIXTURES: Array<[string, "block" | "info" | "none"]> = [
  ["block-code-stays.diff", "block"],
  ["block-rename-away.diff", "block"],
  ["block-root-tests.diff", "block"],
  ["pass-helper.diff", "none"],
  ["pass-init-py.diff", "none"],
  ["pass-fixture-json.diff", "none"],
  ["pass-binary.diff", "none"],
  ["info-with-source.diff", "info"],
  ["info-package-removed.diff", "info"],
  ["info-migration-ts.diff", "info"],
  ["info-migration-mjs.diff", "info"],
];

async function run(diff: string, files: string, coverage: string, mode: "block" | "warn" = "block") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture(coverage), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture(files).trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ids = (report: Awaited<ReturnType<typeof run>>, id: string) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === id);

describe("TI14 and TI11 leave the earlier signals and fixtures alone", () => {
  it("AC-14: the old config and workflow fixtures keep their messages, the TI01 fixtures keep their signals", async () => {
    // Control: the config fixture that lowers a threshold (90 to 10) is now a TI14 block finding, with its
    // CONFIG_CHANGED_IN_DIFF message still there exactly once.
    const config = await run(
      fixture("gate-tamper/config-modified.diff"),
      "gate-tamper/files.txt",
      "gate-tamper/coverage.info",
    );
    expect(ids(config, "TI14")).toHaveLength(1);
    expect(ids(config, "TI14")[0]).toMatchObject({ severity: "block", path: ".pharn/ci.yml", line: 2 });
    expect(config.messages.filter((m) => (m.code as string) === "CONFIG_CHANGED_IN_DIFF")).toHaveLength(1);

    // The workflow fixture changes a `threshold: 90` action input, which neither signal reads.
    const workflow = await run(
      fixture("gate-tamper/workflow-modified.diff"),
      "gate-tamper/files.txt",
      "gate-tamper/coverage.info",
    );
    expect(ids(workflow, "TI14")).toEqual([]);
    expect(ids(workflow, "TI11")).toEqual([]);
    expect(workflow.messages.filter((m) => (m.code as string) === "CONFIG_CHANGED_IN_DIFF")).toHaveLength(1);

    // The golden diff touches no config or workflow.
    const golden = await run(fixture("golden/pr.diff"), "golden/files.txt", "golden/coverage.info");
    expect(golden.testIntegrity.signals).toEqual([]);

    // The TI01 fixtures keep their TI01 signals and gain no TI14 or TI11 signal.
    for (const [name, expected] of TI01_FIXTURES) {
      const report = await run(
        fixture(`test-integrity/TI01/${name}`),
        "test-files-deleted/files.txt",
        "test-files-deleted/coverage.info",
      );
      const ti01 = ids(report, "TI01");
      if (expected === "none") expect(ti01, name).toEqual([]);
      else {
        expect(ti01.length, name).toBeGreaterThan(0);
        expect(
          ti01.every((s) => s.severity === expected),
          name,
        ).toBe(true);
      }
      expect(ids(report, "TI14"), name).toEqual([]);
      expect(ids(report, "TI11"), name).toEqual([]);
    }
  });
});
