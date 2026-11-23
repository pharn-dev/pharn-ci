import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-3. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. A non-empty permissions.additionalDirectories is a P02 finding at warn; the base copy
// raises policy.rules.P02 to block and the head copy lowers it, deletes the key or deletes the whole `policy` object.
// The severity order has no level between warn and block, so the "head raises further" case is a base at warn (the
// finding's own level) and a head at block.

const REPO_ROOT = "/home/runner/work/demo/demo";
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

async function run(head: PolicyDocument, baseDocument: PolicyDocument): Promise<Report> {
  const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
  const base: PolicyFileBase = { kind: "document", document: baseDocument };
  const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
  const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
  const resolved = core.resolveInputs({}, raw, TEXT);
  expect(resolved.ok).toBe(true);
  // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
  if (!resolved.ok) throw new Error("resolveInputs failed");
  const applyPolicy: Uniting = core.applyPolicy;
  const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
  expect(application.policy, "applyPolicy returns the policy the run uses").toBeDefined();
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts", ".claude/settings.json"],
    policy: application.policy,
    policyIgnored: application.ignored,
    policyFileBase: base,
    policySettingsSources: { files: [{ path: ".claude/settings.json", text: SETTINGS }], dropped: [] },
  });
  expectValidReport(report);
  return report;
}

const p02 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P02").map((v) => v.severity);

describe("a file: policy's head copy cannot lower a rule its merge-base copy raised", { timeout: 60_000 }, () => {
  it("AC-3: base P02 block, head warn / key deleted / policy deleted: the P02 violation is block and policy.rules.P02 is named; a head that raises further is applied and not named", async () => {
    const raisedBase: PolicyDocument = { version: 1, policy: { rules: { P02: "block" } } };
    const heads: Array<[string, PolicyDocument]> = [
      ["head warn", { version: 1, policy: { rules: { P02: "warn" } } }],
      ["head deletes the key", { version: 1, policy: { rules: {} } }],
      ["head deletes policy", { version: 1 }],
    ];
    for (const [name, head] of heads) {
      const report = await run(head, raisedBase);
      expect(p02(report), name).toEqual(["block"]);
      expect(ignoredNames(report), name).toContain("policy.rules.P02");
    }

    const further = await run(
      { version: 1, policy: { rules: { P02: "block" } } },
      { version: 1, policy: { rules: { P02: "warn" } } },
    );
    expect(p02(further)).toEqual(["block"]);
    expect(ignoredNames(further)).not.toContain("policy.rules.P02");
  });
});
