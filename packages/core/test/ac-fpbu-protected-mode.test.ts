import { describe, expect, it } from "vitest";
import type { AgentPrFacts } from "../src/agents.js";
import type { InputErrorText, RawInputs } from "../src/inputs.js";
import type { PolicyFileBase } from "../src/policy/agents.js";
import type { PolicyApplication, PolicyLayers } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument } from "../src/policy/types.js";
import type { Report, ReportMeta } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-348 (file-policy-base-union), AC-8. applyPolicy(), resolveInputs() and check() are loaded inside the test body:
// the AC test is written before applyPolicy unites a `file:` policy with its merge-base copy, so nothing the build adds
// may run while this file loads. An agent pull request changes migrations/002.sql; the base copy protects
// migrations/** with protected_paths_mode block, and the head copy sets warn or deletes the mode. A deleted mode the
// base sets is named too (the plan's decided exception for this one key).

const REPO_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const TEXT: InputErrorText = {
  coverageFormat: () => "unsupported coverage format",
  threshold: "threshold",
  exclude: "exclude",
  coverageRoot: "coverage root",
  noCoverageFile: "no coverage file",
};
const META: ReportMeta = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};
const AGENT_FACTS: AgentPrFacts = {
  pr: {
    author: { login: "claude[bot]", type: "Bot" },
    labels: [],
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
};

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

describe("a file: policy's head copy cannot lower the protected-paths mode", { timeout: 60_000 }, () => {
  it("AC-8: base protected_paths_mode block, head warn / mode deleted: P11 on the protected path is block and agents.protected_paths_mode is recorded looser", async () => {
    const core = { ...(await import("@pharn-ci/core")), check: (await import("./text-coverage.js")).check };
    const applyPolicy: Uniting = core.applyPolicy;
    const base: PolicyFileBase = {
      kind: "document",
      document: { version: 1, agents: { protected_paths: ["migrations/**"], protected_paths_mode: "block" } },
    };
    const raw: RawInputs = { coverageFile: "coverage/lcov.info" };
    const resolved = core.resolveInputs({}, raw, TEXT);
    expect(resolved.ok).toBe(true);
    // Narrows the type only: the expect above has already failed the test when resolveInputs did not succeed.
    if (!resolved.ok) throw new Error("resolveInputs failed");

    const heads: Array<[string, PolicyDocument]> = [
      ["head warn", { version: 1, agents: { protected_paths: ["migrations/**"], protected_paths_mode: "warn" } }],
      ["head deletes the mode", { version: 1, agents: { protected_paths: ["migrations/**"] } }],
    ];
    for (const [name, head] of heads) {
      const policy: ResolvedPolicy = { source: "file", version: null, path: POLICY_PATH, document: head };
      const application = applyPolicy({ config: {}, raw, resolved: resolved.inputs }, policy, base);
      expect(application.policy, `${name}: applyPolicy returns the policy the run uses`).toBeDefined();

      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        // Changes migrations/002.sql and leaves the policy file alone.
        diff: { text: fixture("policy-rules/p11/edited-file/no-edit.diff") },
        repoRoot: REPO_ROOT,
        threshold: null,
        repoFiles: ["AGENTS.md", POLICY_PATH, "migrations/002.sql", "src/a.ts"],
        meta: META,
        policy: application.policy,
        policyIgnored: application.ignored,
        policyFileBase: base,
        agentPrFacts: AGENT_FACTS,
      });
      expectValidReport(report);
      const p11 = (report.policy?.violations ?? []).filter((v) => v.id === "P11");
      expect(
        p11.map((v) => [v.path, v.severity]),
        name,
      ).toEqual([["migrations/002.sql", "block"]]);
      expect(ignoredNames(report), name).toContain("agents.protected_paths_mode");
    }
  });
});
