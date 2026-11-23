import { describe, expect, it } from "vitest";
import type { PharnConfig } from "../src/config.js";
import type { ResolveInputsResult } from "../src/inputs.js";
import type { IgnoredSetting, ResolvedPolicy } from "../src/policy/resolved.js";
import type { Report, TestIntegrityMode } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import type { TextCheckInput } from "./text-coverage.js";

// applyPolicy(), check() and resolveInputs() are loaded inside the test body: the AC test is written before the
// policy precedence exists, so nothing the build adds may run while the file loads. The layers are built the way the
// adapters build them, and applyPolicy's effective settings are passed to check() as the adapters pass them.

// CORE-123 (R5.6): an app policy's looser record keeps the layer it beat; a policy file's record has none.
/** resolveInputs() succeeded: each case asserts `ok` before it reads `inputs`. */
type Resolved = Extract<ResolveInputsResult, { ok: true }>;

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

const app = (mode: TestIntegrityMode): ResolvedPolicy => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1, test_integrity: { mode } },
});
const file = (mode: TestIntegrityMode): ResolvedPolicy => ({
  source: "file",
  version: null,
  path: "policy/org.json",
  document: { version: 1, test_integrity: { mode } },
});

async function golden(extra: Partial<TextCheckInput>): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    ...extra,
  });
  expectValidReport(report);
  return report;
}

const modeIgnored = (report: Report) => report.messages.filter((m) => m.code === "TEST_INTEGRITY_MODE_IGNORED");

describe("applyPolicy and check(): the test-integrity mode", () => {
  it("AC-21: the app mode is the max of the app and the given values, a file mode only raises, the source is policy when the policy's mode applies, and TEST_INTEGRITY_MODE_IGNORED is as at the base", async () => {
    const core = await import("@pharn-ci/core");
    const cases: Array<[string, PharnConfig, string | undefined, ResolvedPolicy, string, string, IgnoredSetting[]]> = [
      [
        "app block over input warn",
        {},
        "warn",
        app("block"),
        "block",
        "policy",
        [{ setting: "test_integrity.mode", layer: "input", reason: "looser" }],
      ],
      ["app off, nothing given", {}, undefined, app("off"), "off", "policy", []],
      ["app warn under input block", {}, "block", app("warn"), "block", "input", []],
      [
        "app block over config off",
        { testIntegrity: { mode: "off" } },
        undefined,
        app("block"),
        "block",
        "policy",
        [{ setting: "test_integrity.mode", layer: "config", reason: "looser" }],
      ],
      ["file block over the default", {}, undefined, file("block"), "block", "policy", []],
      // Review finding 14: a looser file mode over the default is named in POLICY_OVERRIDE_IGNORED too; the mode in
      // force stays the default warn.
      [
        "file off over the default",
        {},
        undefined,
        file("off"),
        "warn",
        "default",
        [{ setting: "test_integrity.mode", reason: "looser" }],
      ],
      [
        "file off under input warn",
        {},
        "warn",
        file("off"),
        "warn",
        "input",
        [{ setting: "test_integrity.mode", reason: "looser" }],
      ],
    ];
    for (const [name, config, input, policy, mode, source, ignored] of cases) {
      const raw = { coverageFile: "coverage/lcov.info", ...(input === undefined ? {} : { testIntegrity: input }) };
      const resolved = core.resolveInputs(config, raw, TEXT);
      expect(resolved.ok, name).toBe(true);
      const application = core.applyPolicy({ config, raw, resolved: (resolved as Resolved).inputs }, policy);
      expect(application.ignored, name).toEqual(ignored);

      const report = await golden({
        ...(application.inputs.testIntegrityMode === undefined
          ? {}
          : { testIntegrityMode: application.inputs.testIntegrityMode }),
        policy,
        policyIgnored: application.ignored,
      });
      expect(report.testIntegrity.mode, name).toBe(mode);
      expect(report.testIntegrity.source, name).toBe(source);

      // The base commit's check() for the same input and config values, with no policy.
      const base = await golden(
        (resolved as Resolved).inputs.testIntegrityMode === undefined
          ? {}
          : { testIntegrityMode: (resolved as Resolved).inputs.testIntegrityMode },
      );
      expect(modeIgnored(report), name).toEqual(modeIgnored(base));
    }
  });
});
