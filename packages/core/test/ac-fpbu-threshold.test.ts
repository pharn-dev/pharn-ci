import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-4. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. The layers give no threshold; the base copy sets 90 and the head copy sets 50, deletes
// the key, deletes the whole coverage object, or sets 95.

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

describe("a file: policy's head copy cannot lower the threshold its merge-base copy set", { timeout: 60_000 }, () => {
  it("AC-4: base 90, head 50 / key deleted / coverage deleted: the threshold is 90 and coverage.threshold is recorded looser; head 95: 95 and no record", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: { version: 1, coverage: { threshold: 90 } } };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    expect(resolved.inputs.threshold, "control: the layers give no threshold").toBeNull();

    const cases: Array<[string, PolicyDocument, number, boolean]> = [
      ["head 50", { version: 1, coverage: { threshold: 50 } }, 90, true],
      ["head deletes the key", { version: 1, coverage: {} }, 90, true],
      ["head deletes coverage", { version: 1 }, 90, true],
      ["head 95", { version: 1, coverage: { threshold: 95 } }, 95, false],
    ];
    for (const [name, head, threshold, recorded] of cases) {
      const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
      const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
      expect(application.policy, `${name}: applyPolicy returns the policy the run uses`).toBeDefined();
      expect(application.inputs.threshold, name).toBe(threshold);
      const records = application.ignored.filter((r) => r.setting === "coverage.threshold");
      if (recorded) {
        expect(records.length, name).toBeGreaterThan(0);
        expect(
          records.every((r) => r.reason === "looser"),
          name,
        ).toBe(true);
      } else {
        expect(records, name).toEqual([]);
      }

      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("golden/pr.diff") },
        repoRoot: REPO_ROOT,
        threshold: application.inputs.threshold,
        repoFiles: fixture("golden/files.txt").trim().split("\n"),
        policy: application.policy,
        policyIgnored: application.ignored,
        policyFileBase: base,
      });
      expectValidReport(report);
      expect(report.diffCoverage?.threshold, name).toBe(threshold);
    }
  });
});
