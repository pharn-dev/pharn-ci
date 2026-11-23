import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-10. applyPolicy(), resolveInputs(), resolveDependencySettings() and check() are
// loaded inside the test body: the AC test is written before applyPolicy unites a `file:` policy with its merge-base
// copy, so nothing the build adds may run while this file loads. The base copy sets every key a policy file may not set;
// the head copy sets none of them. None of the base's values is applied, and none is recorded.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const BASE_DOCUMENT: PolicyDocument = {
  version: 1,
  coverage: { exclude: ["gen/**"], root: "pkg" },
  test_integrity: { accept_label: "pharn/base-accepted" },
  policy: { required: true },
  dependencies: { registries: ["npm"], allowed_hosts: ["npm.example.com"] },
  injection: { exempt: ["docs/**"] },
};
const HEAD_ONLY = [
  "coverage.exclude",
  "coverage.root",
  "test_integrity.accept_label",
  "policy.required",
  "dependencies.registries",
  "dependencies.allowed_hosts",
  "injection.exempt",
];

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

/** The settings POLICY_OVERRIDE_IGNORED names, without the numbers a threshold carries. */
function ignoredNames(report: Report): string[] {
  return report.messages
    .filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")
    .flatMap((m) => {
      const at = m.text.indexOf("applies: ");
      expect(at, "the message lists the settings after 'applies: '").toBeGreaterThan(-1);
      return m.text
        .slice(at + "applies: ".length)
        .replace(/\.$/, "")
        .split(", ")
        .map((entry) => entry.split(" ")[0] ?? "");
    });
}

describe("the keys a policy file may not set stay the head copy's", { timeout: 60_000 }, () => {
  it("AC-10: a base copy's coverage.exclude, coverage.root, accept_label, policy.required, registries, allowed_hosts and injection.exempt are neither applied nor named", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: BASE_DOCUMENT };
    const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: { version: 1 } };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);

    expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
    const document = application.policy?.document;
    expect(document?.coverage?.exclude).toBeUndefined();
    expect(document?.coverage?.root).toBeUndefined();
    expect(document?.test_integrity?.accept_label).toBeUndefined();
    expect(document?.policy?.required).toBeUndefined();
    expect(document?.dependencies?.registries).toBeUndefined();
    expect(document?.dependencies?.allowed_hosts).toBeUndefined();
    expect(document?.injection?.exempt).toBeUndefined();

    expect(application.inputs.exclude).toEqual(resolved.inputs.exclude);
    expect(application.inputs.coverageRoot).toEqual(resolved.inputs.coverageRoot);
    expect(application.acceptLabel).toBeUndefined();
    expect(core.resolveDependencySettings(application.inputs.dependencies).registries).toEqual(["npm", "pypi"]);
    const recorded = application.ignored.map((r) => r.setting);
    for (const setting of HEAD_ONLY) expect(recorded, setting).not.toContain(setting);

    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
      diff: { text: fixture("golden/pr.diff") },
      repoRoot: REPO_ROOT,
      threshold: application.inputs.threshold,
      exclude: application.inputs.exclude,
      coverageRoot: application.inputs.coverageRoot,
      repoFiles: fixture("golden/files.txt").trim().split("\n"),
      policy: application.policy,
      policyIgnored: application.ignored,
      policyFileBase: base,
    });
    expectValidReport(report);
    const named = ignoredNames(report);
    for (const setting of HEAD_ONLY) expect(named, setting).not.toContain(setting);
  });
});
