import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-16. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. The signals fixture gives TI06 at warn in mode block, and a non-empty
// permissions.additionalDirectories is a P02 finding at warn. The base copy sets TI06 and P02 to warn (their own levels)
// and the head copy deletes both keys: nothing is looser than the base, so nothing is recorded.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DIR = "policy-precedence/signals";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const SETTINGS = '{\n  "permissions": {\n    "additionalDirectories": ["../shared"]\n  }\n}\n';

/** applyPolicy() as this change gives it: the merge-base copy as a third argument, the policy it used in `policy`. */
type Uniting = (
  layers: PolicyLayers,
  policy: ResolvedPolicy,
  base?: PolicyFileBase,
) => PolicyApplication & { policy?: ResolvedPolicy };

describe("a merge-base copy that sets a signal and a rule to their default levels", { timeout: 60_000 }, () => {
  it("AC-16: the head deletes both keys: TI06 and P02 keep their default levels and there is no POLICY_OVERRIDE_IGNORED", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const head: PolicyDocument = { version: 1, test_integrity: { mode: "block" } };
    const base: PolicyFileBase = {
      kind: "document",
      document: {
        version: 1,
        test_integrity: { mode: "block", signals: { TI06: "warn" } },
        policy: { rules: { P02: "warn" } },
      },
    };
    const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info", testIntegrity: "block" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
    expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
    expect(application.policy?.source).toBe("file");
    expect(application.ignored).toEqual([]);

    const report = core.check({
      version: "0.1.0",
      coverage: { text: fixture(`${DIR}/coverage.info`), format: "lcov" },
      diff: { text: fixture(`${DIR}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: application.inputs.threshold,
      repoFiles: [...fixture(`${DIR}/files.txt`).trim().split("\n"), ".claude/settings.json"],
      testSources: JSON.parse(fixture(`${DIR}/sources.json`)),
      testIntegrityMode: application.inputs.testIntegrityMode,
      policy: application.policy,
      policyIgnored: application.ignored,
      signalOverrides: application.signalOverrides,
      policyFileBase: base,
      policySettingsSources: { files: [{ path: ".claude/settings.json", text: SETTINGS }], dropped: [] },
    });
    expectValidReport(report);
    const ti06 = report.testIntegrity.signals.filter((s) => s.id === "TI06");
    expect(ti06.length, "control: the fixture triggers TI06").toBeGreaterThan(0);
    expect(ti06.map((s) => s.severity)).toEqual(ti06.map(() => "warn"));
    expect((report.policy?.violations ?? []).filter((v) => v.id === "P02").map((v) => v.severity)).toEqual(["warn"]);
    expect(report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED")).toEqual([]);
  });
});
