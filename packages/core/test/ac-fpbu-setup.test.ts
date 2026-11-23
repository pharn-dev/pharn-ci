import { describe, expect, it } from "vitest";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-6. applyPolicy(), resolveInputs() and check() are loaded inside the test body,
// and fixtures/policy-rules/p07/ is read there too: the AC test is written before applyPolicy unites a `file:` policy
// with its merge-base copy, so nothing the build adds may run while this file loads. The base copy requires agent setup,
// expects cursor, forbids a tracked CLAUDE.local.md and runs P07 at block; the head copy drops each of them (a false, a
// removed entry and a lower level; the keys deleted; the setup object deleted). AGENTS.md and CLAUDE.md name different
// package managers, so P07 has a contradiction to report.

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
  setup: { require: true, expect: ["cursor"], forbidden_files: ["CLAUDE.local.md"], consistency: "block" },
};
const SETTINGS = ["setup.require", "setup.expect", "setup.forbidden_files", "setup.consistency"];

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

const violations = (report: Report, id: string) => (report.policy?.violations ?? []).filter((v) => v.id === id);
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("a file: policy's head copy cannot drop the base copy's setup settings", { timeout: 60_000 }, () => {
  it("AC-6: setup stays required, cursor stays expected, the tracked CLAUDE.local.md keeps its P08, P07 runs at block, and each dropped setting is named", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = { kind: "document", document: BASE_DOCUMENT };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");
    expect(resolved.inputs.requireAgentSetup, "control: the layers do not require setup").toBe(false);

    const heads: Array<[string, PolicyDocument]> = [
      [
        "head loosens each",
        {
          version: 1,
          setup: { require: false, expect: ["copilot"], forbidden_files: ["*.secret"], consistency: "warn" },
        },
      ],
      ["head deletes the keys", { version: 1, setup: {} }],
      ["head deletes setup", { version: 1 }],
    ];
    for (const [name, head] of heads) {
      const policy: ResolvedPolicy = { source: "file", version: null, path: "policy/org.json", document: head };
      const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
      expect(application.policy, `${name}: applyPolicy returns the policy the run uses`).toBeDefined();
      expect(application.inputs.requireAgentSetup, `${name}: agent setup stays required`).toBe(true);
      expect(application.inputs.expectAgentSetup ?? [], `${name}: cursor stays expected`).toContain("cursor");

      const runCheck = (repoFiles: string[], withInstructions: boolean) => {
        const report = core.check({
          version: "0.1.0",
          coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
          diff: { text: fixture("diff/empty.diff") },
          repoRoot: REPO_ROOT,
          threshold: null,
          repoFiles,
          requireAgentSetup: application.inputs.requireAgentSetup,
          expectAgentSetup: application.inputs.expectAgentSetup,
          policy: application.policy,
          policyIgnored: application.ignored,
          policyFileBase: base,
          ...(withInstructions
            ? {
                agentInstructionSources: {
                  files: [
                    { path: "AGENTS.md", text: fixture("policy-rules/p07/contradiction/agents.txt") },
                    { path: "CLAUDE.md", text: fixture("policy-rules/p07/contradiction/claude.txt") },
                  ],
                  dropped: [],
                },
              }
            : {}),
        });
        expectValidReport(report);
        return report;
      };

      const report = runCheck(["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "policy/org.json", "src/a.ts"], true);
      expect(
        violations(report, "P08").map((v) => v.path),
        `${name}: P08 for the tracked file`,
      ).toEqual(["CLAUDE.local.md"]);
      const p07 = violations(report, "P07");
      expect(p07.length, `${name}: control, P07 has a contradiction`).toBeGreaterThan(0);
      expect(
        p07.map((v) => v.severity),
        `${name}: P07 runs at block`,
      ).toEqual(p07.map(() => "block"));
      const named = ignoredNames(report);
      for (const setting of SETTINGS) expect(named, `${name}: ${setting}`).toContain(setting);

      // No agent setup file tracked (AGENTS.md above configures cursor too): the requirement and the expected tool the
      // base copy sets still fail the check.
      const empty = runCheck(["src/a.ts", "policy/org.json"], false);
      expect(
        violations(empty, "P01").map((v) => v.detail),
        `${name}: setup still required`,
      ).toContain("no agent setup files found");
      expect(empty.agentSetup.missing ?? [], `${name}: the base's expected tool is still expected`).toContain("cursor");
      expect(
        violations(empty, "P01").map((v) => v.detail),
        name,
      ).toContain("no setup file for cursor");
      expect(
        withCode(empty, "NO_AGENT_SETUP_FILES").map((m) => m.level),
        name,
      ).toEqual(["error"]);
    }
  });
});
