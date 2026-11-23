import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-5. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. No input or config names a mode; the base copy sets test_integrity.mode block and the
// head copy sets warn, deletes the key or deletes the whole test_integrity object.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("a file: policy's head copy cannot lower the mode its merge-base copy set", { timeout: 60_000 }, () => {
  it("AC-5: base mode block, head warn / key deleted / test_integrity deleted: the report's mode is block and test_integrity.mode is recorded looser", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: { version: 1, test_integrity: { mode: "block" } } };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");

    const heads: Array<[string, PolicyDocument]> = [
      ["head warn", { version: 1, test_integrity: { mode: "warn" } }],
      ["head deletes the key", { version: 1, test_integrity: {} }],
      ["head deletes test_integrity", { version: 1 }],
    ];
    for (const [name, head] of heads) {
      const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
      const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
      expect(application.policy, `${name}: applyPolicy returns the policy the run uses`).toBeDefined();
      expect(application.ignored, name).toContainEqual(
        expect.objectContaining({ setting: "test_integrity.mode", reason: "looser" }),
      );

      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
        testIntegrityMode: application.inputs.testIntegrityMode,
        policy: application.policy,
        policyIgnored: application.ignored,
        policyFileBase: base,
      });
      expectValidReport(report);
      expect(report.testIntegrity.mode, name).toBe("block");
    }
  });
});
