import { describe, expect, it } from "vitest";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import type { PolicyDocument, PolicySeverity } from "../src/policy/types.js";
import type { Report } from "../src/report.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-9. check() and consistencySeverity() are loaded inside the test body and
// fixtures/policy-rules/p07/ is read there too: the AC test is written before the build adds rule P07 and its
// fixtures, so nothing the build adds may run while this file loads.

/** Core's index with the check() that takes coverage as text, as the test body builds it. */
type Core = Omit<typeof import("@pharn-ci/core"), "check"> & { check: typeof import("./text-coverage.js")["check"] };

const REPO_ROOT = "/home/runner/work/demo/demo";

/** An app policy with the given setup.consistency and policy.rules.P07. */
function appPolicy(consistency: PolicySeverity | undefined, rule: PolicySeverity | undefined): ResolvedPolicy {
  const document = {
    version: 1,
    ...(consistency === undefined ? {} : { setup: { consistency } }),
    ...(rule === undefined ? {} : { policy: { rules: { P07: rule } } }),
  } as PolicyDocument;
  return { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document };
}

function run(core: Core, policy: ResolvedPolicy): Report {
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", "src/a.ts"],
    policy,
    agentInstructionSources: {
      files: [
        { path: "AGENTS.md", text: fixture("policy-rules/p07/contradiction/agents.txt") },
        { path: "CLAUDE.md", text: fixture("policy-rules/p07/contradiction/claude.txt") },
      ],
      dropped: [],
    },
  });
  expectValidReport(report);
  return report as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P07: severity under an app policy", { timeout: 60_000 }, () => {
  it("AC-9: setup.consistency block blocks, P07 off or consistency off removes the rule, the stricter of the two applies, and P07 info alone gives info; no POLICY_OVERRIDE_IGNORED", async () => {
    const core = {
      ...(await import("@pharn-ci/core")),
      check: (await import("./text-coverage.js")).check,
    };
    expect(typeof core.consistencySeverity).toBe("function");

    const cases: [PolicySeverity | undefined, PolicySeverity | undefined, "block" | "off" | "info"][] = [
      ["block", undefined, "block"],
      [undefined, "off", "off"],
      ["off", undefined, "off"],
      ["info", "block", "block"],
      ["block", "info", "block"],
      [undefined, "info", "info"],
    ];
    for (const [consistency, rule, expected] of cases) {
      const label = `setup.consistency ${consistency ?? "unset"}, policy.rules.P07 ${rule ?? "unset"}`;
      const policy = appPolicy(consistency, rule);
      const report = run(core, policy);
      const severities = p07(report).map((v) => v.severity);
      const levels = withCode(report, "POLICY_P07").map((m) => m.level);
      if (expected === "off") {
        expect(severities, label).toEqual([]);
        expect(levels, label).toEqual([]);
        expect(core.consistencySeverity(policy).severity, label).toBeNull();
      } else if (expected === "block") {
        expect(severities, label).toEqual(["block", "block"]);
        expect(levels, label).toEqual(["error"]);
        expect(report.verdict, label).toBe("fail");
      } else {
        expect(severities, label).toEqual(["info", "info"]);
        expect(levels, label).toEqual(["info"]);
      }
      expect(withCode(report, "POLICY_OVERRIDE_IGNORED"), label).toEqual([]);
    }
  });
});
