import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = "/home/runner/work/demo/demo";

const TI14 = [
  "block-threshold-lowered.diff",
  "block-threshold-removed.diff",
  "block-config-deleted.diff",
  "block-exclude-flow.diff",
  "block-exclude-block.diff",
  "block-exclude-appended.diff",
  "pass-threshold-raised.diff",
  "pass-threshold-moved.diff",
  "pass-threshold-added.diff",
  "pass-exclude-removed.diff",
  "pass-exclude-moved.diff",
  "pass-unrelated-setup.diff",
  "pass-file-item-added.diff",
];

const TI11 = [
  "block-test-step-removed.diff",
  "block-workflow-deleted.diff",
  "block-trigger-removed.diff",
  "block-trigger-flow.diff",
  "warn-matrix-reduced.diff",
  "warn-continue-on-error.diff",
  "warn-if-false.diff",
  "warn-if-event.diff",
  "warn-timeout-one.diff",
  "pass-step-moved.diff",
  "pass-step-reflowed.diff",
  "pass-comment-removed.diff",
  "pass-trigger-kept.diff",
  "pass-matrix-grown.diff",
  "pass-continue-expression.diff",
  "pass-if-always.diff",
  "pass-timeout-fifteen.diff",
  "pass-action-bump.diff",
  "pass-pure-rename.diff",
  "pass-non-workflow.diff",
];

async function signalsOf(dir: string, name: string, exclude: string[] = []) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    exclude,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

// CORE-133: the CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out. CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed.
describe("TI14 and TI11: schema and fixtures", () => {
  // CORE-140: the schema's code description is one sentence and a link to the code table of docs/output.md.
  it("AC-15: the code table names both message codes", () => {
    expect(codeRow("TEST_INTEGRITY_TI14")).toContain("TI14:");
    expect(codeRow("TEST_INTEGRITY_TI11")).toContain("TI11:");
  });

  it("AC-15: at least five must-trigger and five must-not-trigger diffs exist for each id, and they behave", async () => {
    for (const [dir, names] of [
      ["TI14", TI14],
      ["TI11", TI11],
    ] as const) {
      const listed = readdirSync(new URL(`fixtures/test-integrity/${dir}/`, ROOT)).sort();
      for (const name of names)
        expect(existsSync(new URL(`fixtures/test-integrity/${dir}/${name}`, ROOT)), name).toBe(true);
      expect(listed.filter((n) => !n.startsWith("pass-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of names) {
        // An item appended to an existing list is judged against the exclusion patterns the check was given.
        const appended = name === "block-exclude-appended.diff";
        const exclude = appended
          ? fixture(`test-integrity/${dir}/${name}`)
              .split("\n")
              .filter((line) => /^\+\s+- /.test(line))
              .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""))
          : [];
        const signals = await signalsOf(dir, name, exclude);
        if (name.startsWith("pass-")) expect(signals, `${dir}/${name}`).toEqual([]);
        else {
          expect(signals.length, `${dir}/${name}`).toBeGreaterThan(0);
          expect(signals[0]?.severity, `${dir}/${name}`).toBe(name.startsWith("warn-") ? "warn" : "block");
        }
      }
    }
  });
});
