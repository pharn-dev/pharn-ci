import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-10. check() is loaded inside the test body and fixtures/policy-rules/p07/ is read there too: the
// AC test is written before the build adds rule P07 and its fixtures, so nothing the build adds may run while this
// file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(extra: Record<string, unknown>): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", ".pharn/policy.json", "src/a.ts"],
    policy: { source: "file", version: null, path: ".pharn/policy.json", document: { version: 1, ...extra } },
    agentInstructionSources: {
      files: [
        { path: "AGENTS.md", text: fixture("policy-rules/p07/contradiction/agents.txt") },
        { path: "CLAUDE.md", text: fixture("policy-rules/p07/contradiction/claude.txt") },
      ],
      dropped: [],
    },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

describe("org policy rule P07: a file: policy only tightens", { timeout: 60_000 }, () => {
  it("AC-10: under a file: policy, setup.consistency off and policy.rules.P07 info leave P07 at warn and are each named in one POLICY_OVERRIDE_IGNORED; setup.consistency block blocks with no POLICY_OVERRIDE_IGNORED", async () => {
    for (const [extra, named] of [
      [{ setup: { consistency: "off" } }, "setup.consistency (policy-file)"],
      [{ policy: { rules: { P07: "info" } } }, "policy.rules.P07 (policy-file)"],
    ] as const) {
      const report = await run(extra);
      expect(
        p07(report).map((v) => v.severity),
        named,
      ).toEqual(["warn", "warn"]);
      const ignored = withCode(report, "POLICY_OVERRIDE_IGNORED");
      expect(ignored, named).toHaveLength(1);
      expect(ignored[0]?.text, named).toContain(named);
    }

    const blocked = await run({ setup: { consistency: "block" } });
    expect(p07(blocked).map((v) => v.severity)).toEqual(["block", "block"]);
    expect(withCode(blocked, "POLICY_P07").map((m) => m.level)).toEqual(["error"]);
    expect(blocked.verdict).toBe("fail");
    expect(withCode(blocked, "POLICY_OVERRIDE_IGNORED")).toEqual([]);
  });
});
