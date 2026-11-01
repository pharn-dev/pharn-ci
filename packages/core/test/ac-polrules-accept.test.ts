import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-14. check() and acceptTestIntegrity() are loaded inside the test body and
// fixtures/policy-rules/ is read there too: the AC test is written before the build adds the rules and the fixtures,
// so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  testIntegrity: { verdict: string; signals: Array<{ severity: string }> };
  policy?: { violations: Violation[] };
};

interface Core {
  check(input: unknown): Report;
  acceptTestIntegrity(report: Report, accepted: { label: string; by: string }): Report;
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const ACCEPTED = { label: "pharn/accepted", by: "Reviewer-1" };

describe("the accept label and policy violations", { timeout: 60_000 }, () => {
  it("AC-14: accepting a report with a P08 block violation and a test-integrity block finding leaves the verdict fail, POLICY_P08 an error and report.policy unchanged", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const run = (policy: unknown) => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: fixture("accept-label/block.diff") },
        repoRoot: REPO_ROOT,
        threshold: null,
        repoFiles: [...fixture("accept-label/files.txt").trim().split("\n"), "CLAUDE.local.md"],
        testIntegrityMode: { input: "block" },
        ...(policy === undefined ? {} : { policy }),
      });
      expectValidReport(report);
      return report;
    };

    // Control: without the policy, accepting the test-integrity finding is enough to stop failing.
    const control = run(undefined);
    expect(control.testIntegrity.signals.some((s) => s.severity === "block")).toBe(true);
    expect(control.verdict).toBe("fail");
    const acceptedControl = core.acceptTestIntegrity(control, ACCEPTED);
    expectValidReport(acceptedControl);
    expect(acceptedControl.verdict).not.toBe("fail");

    const report = run({
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: JSON.parse(fixture("policy-rules/p08-violates/policy.json")),
    });
    expect(report.testIntegrity.signals.some((s) => s.severity === "block")).toBe(true);
    expect(report.policy?.violations.filter((v) => v.id === "P08").map((v) => v.severity)).toEqual(["block"]);
    expect(report.verdict).toBe("fail");
    const before = structuredClone(report.policy);

    const accepted = core.acceptTestIntegrity(report, ACCEPTED);
    expectValidReport(accepted);
    expect(accepted.verdict).toBe("fail");
    expect(accepted.messages.filter((m) => m.code === "POLICY_P08").map((m) => m.level)).toEqual(["error"]);
    expect(accepted.policy).toEqual(before);
  });
});
