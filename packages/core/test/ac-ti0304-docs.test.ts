import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codeRow } from "./codeTable.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const REPO_ROOT = "/home/runner/work/demo/demo";

/** The must-not-block cases of docs/PRECISION.md §1, each a TI03 fixture whose TI03 signals are all warn or absent. */
const TI03_PRECISION = [
  "warn-conditional-mobile.diff",
  "warn-skipif-camera.diff",
  "warn-skipif-docker.diff",
  "warn-skipif-openssl.diff",
  "warn-skipunless-windows.diff",
  "warn-pytest-skip-redis.diff",
  "warn-pytest-skip-fixture.diff",
  "warn-go-skip-root.diff",
  "warn-xfail-new-test.diff",
  "pass-fails-async-edit.diff",
];

/** The PRECISION.md §1 cases TI04 must not fire on. */
const TI04_PRECISION = ["pass-solver-fit.diff", "pass-python-def-fit.diff"];

async function signalsOf(dir: string, name: string) {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: "block" },
  });
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

// CORE-133: the CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out. CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed.
describe("TI03 and TI04: schema and fixtures", () => {
  // CORE-140: the schema's code description is one sentence and a link to the code table of docs/output.md.
  it("AC-14: the code table names both message codes", () => {
    expect(codeRow("TEST_INTEGRITY_TI03")).toContain("TI03:");
    expect(codeRow("TEST_INTEGRITY_TI04")).toContain("TI04:");
  });

  it("AC-14: at least five must-trigger and five must-not-trigger diffs per id, the PRECISION cases among them, and they behave", async () => {
    for (const [dir, precision] of [
      ["TI03", TI03_PRECISION],
      ["TI04", TI04_PRECISION],
    ] as const) {
      const folder = new URL(`fixtures/test-integrity/${dir}/`, ROOT);
      expect(existsSync(folder), dir).toBe(true);
      const listed = readdirSync(folder)
        .filter((n) => n.endsWith(".diff"))
        .sort();
      for (const name of precision) expect(listed, `${dir}/${name}`).toContain(name);
      expect(listed.filter((n) => !n.startsWith("pass-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of listed) {
        const signals = await signalsOf(dir, name);
        const label = `${dir}/${name}`;
        if (name.startsWith("pass-")) expect(signals, label).toEqual([]);
        else if (name.startsWith("warn-")) {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.every((s) => s.severity === "warn"),
            label,
          ).toBe(true);
        } else {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.some((s) => s.severity === "block"),
            label,
          ).toBe(true);
        }
      }
    }
  });
});
