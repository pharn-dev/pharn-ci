import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-11. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy takes the merge-base copy, so nothing the build adds may run while this file
// loads. A head copy that lowers settings, with a base that is absent, unreadable or not given: the run is today's run
// for that head copy alone, and the policy applyPolicy says it used is the head copy as given.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const POLICY: ResolvedPolicy = {
  source: "file",
  version: null,
  path: "policy/org.json",
  document: {
    version: 1,
    coverage: { threshold: 10 },
    test_integrity: { mode: "off", signals: { TI01: "warn", TI06: "off" } },
    setup: { consistency: "off" },
    policy: { rules: { P02: "info" } },
  },
};

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("a file: policy with no readable merge-base copy is applied as today", { timeout: 60_000 }, () => {
  it("AC-11: with the base absent, unreadable or not given, the application and the report equal the run without a base", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "block", threshold: "20" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const layers: PolicyLayers = { config: {}, raw, resolved: resolved.inputs };

    const runCheck = (
      application: PolicyApplication,
      policy: ResolvedPolicy | undefined,
      base: PolicyFileBase | undefined,
    ): Report => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
        diff: { text: fixture(`${DIR}/pr.diff`) },
        repoRoot: REPO_ROOT,
        threshold: application.inputs.threshold,
        repoFiles: fixture(`${DIR}/files.txt`).trim().split("\n"),
        testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
        testIntegrityMode: application.inputs.testIntegrityMode,
        policy,
        policyIgnored: application.ignored,
        signalOverrides: application.signalOverrides,
        policyFileBase: base,
        policySettingsSources: {
          files: [
            { path: ".claude/settings.json", text: '{ "permissions": { "additionalDirectories": ["../x"] } }\n' },
          ],
          dropped: [],
        },
      });
      expectValidReport(report);
      return report;
    };

    const alone = applyPolicy(layers, POLICY);
    const aloneReport = runCheck(alone, POLICY, undefined);
    expect(
      aloneReport.messages.some((m) => m.code === "POLICY_OVERRIDE_IGNORED"),
      "control: the head copy lowers settings, which today's records name",
    ).toBe(true);

    const bases: Array<[string, PolicyFileBase | undefined]> = [
      ["absent", { kind: "absent" }],
      ["unreadable", { kind: "unreadable" }],
      ["not given", undefined],
    ];
    for (const [name, base] of bases) {
      const application = applyPolicy(layers, POLICY, base);
      expect(application.policy, `${name}: the policy used is the head copy as given`).toEqual(POLICY);
      expect(application, name).toEqual(alone);
      expect(runCheck(application, application.policy, base), name).toEqual(aloneReport);
    }
  });
});
