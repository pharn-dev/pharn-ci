import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-12. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy takes a merge-base copy, so nothing the build adds may run while this file
// loads. An app policy is authoritative and is never united with anything: given any base document, the application
// and the report equal the run without a base, and the policy applyPolicy says it used is the app policy as given.
// The adapters read a merge-base copy for a `file:` policy only, so check() gets no base here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const APP: ResolvedPolicy = {
  source: "app",
  version: 3,
  fetchedAt: "2026-11-23T12:00:00.000Z",
  document: {
    version: 1,
    coverage: { threshold: 30 },
    test_integrity: { mode: "warn", signals: { TI01: "warn", TI06: "info" } },
    setup: { forbidden_files: ["*.secret"] },
  },
};
const BASE: PolicyFileBase = {
  kind: "document",
  document: {
    version: 1,
    coverage: { threshold: 99 },
    test_integrity: { mode: "block", signals: { TI01: "block", TI06: "block" } },
    setup: { require: true, forbidden_files: ["src/**"], consistency: "block" },
    policy: { rules: { P02: "block" } },
    flaky: { quarantine: false },
  },
};

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("an app policy is never united with a merge-base copy", { timeout: 60_000 }, () => {
  it("AC-12: an app policy with a base document gives the application and the report of the run without a base", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "block" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const layers: PolicyLayers = { config: {}, raw, resolved: resolved.inputs };

    const runCheck = (application: PolicyApplication, policy: ResolvedPolicy | undefined): Report => {
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
      });
      expectValidReport(report);
      return report;
    };

    const alone = applyPolicy(layers, APP);
    const aloneReport = runCheck(alone, APP);

    const application = applyPolicy(layers, APP, BASE);
    expect(application.policy, "the policy used is the app policy as given").toEqual(APP);
    expect(application).toEqual(alone);
    expect(runCheck(application, application.policy)).toEqual(aloneReport);
  });
});
