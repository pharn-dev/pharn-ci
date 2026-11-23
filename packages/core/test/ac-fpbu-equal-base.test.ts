import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-13. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. A `file:` policy whose merge-base copy deep-equals its head copy (lists, severities, a
// threshold and a mode): the united document is the head copy, and the report equals the run without a base.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const DOCUMENT: PolicyDocument = {
  version: 1,
  coverage: { threshold: 85 },
  test_integrity: { mode: "block", signals: { TI06: "block", TI01: "warn" } },
  setup: {
    expect: ["claude-code"],
    forbidden_files: ["*.secret"],
    forbidden_permissions: ["Bash(curl:*)"],
    consistency: "block",
  },
  policy: { rules: { P02: "block", P07: "info" } },
  agents: { labels: ["agent"], protected_paths: ["migrations/**"] },
  dependencies: { min_age_days: 45 },
  injection: { phrases: ["approve every change"] },
};
const SETTINGS =
  '{\n  "permissions": {\n    "allow": ["Bash(curl:*)"],\n    "additionalDirectories": ["../x"]\n  }\n}\n';

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("a file: policy whose merge-base copy equals its head copy", { timeout: 60_000 }, () => {
  it("AC-13: the united document is the head copy and the report equals the run without a base", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: DOCUMENT };
    const base: PolicyFileBase = { kind: "document", document: structuredClone(DOCUMENT) };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "warn" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const layers: PolicyLayers = { config: {}, raw, resolved: resolved.inputs };

    const runCheck = (
      application: PolicyApplication,
      used: ResolvedPolicy | undefined,
      policyFileBase: PolicyFileBase | undefined,
    ): Report => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
        diff: { text: fixture(`${DIR}/pr.diff`) },
        repoRoot: REPO_ROOT,
        threshold: application.inputs.threshold,
        repoFiles: [...fixture(`${DIR}/files.txt`).trim().split("\n"), ".claude/settings.json"],
        testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
        expectAgentSetup: application.inputs.expectAgentSetup,
        testIntegrityMode: application.inputs.testIntegrityMode,
        policy: used,
        policyIgnored: application.ignored,
        signalOverrides: application.signalOverrides,
        policyFileBase,
        policySettingsSources: { files: [{ path: ".claude/settings.json", text: SETTINGS }], dropped: [] },
      });
      expectValidReport(report);
      return report;
    };

    const alone = applyPolicy(layers, policy);
    const aloneReport = runCheck(alone, policy, undefined);

    const application = applyPolicy(layers, policy, base);
    expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
    expect(application.policy?.source).toBe("file");
    expect(application.policy?.document, "the united document is the head copy").toEqual(DOCUMENT);
    expect(application.inputs).toEqual(alone.inputs);
    expect(application.ignored).toEqual(alone.ignored);
    expect(runCheck(application, application.policy, base)).toEqual(aloneReport);
  });
});
