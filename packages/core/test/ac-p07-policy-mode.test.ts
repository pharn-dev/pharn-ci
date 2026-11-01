import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24 (P07), AC-11. check() and consistencySeverity() are loaded inside the test body and
// fixtures/policy-rules/p07/ is read there too: the AC test is written before the build adds rule P07 and its
// fixtures, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };
interface Core {
  check(input: unknown): unknown;
  consistencySeverity(policy: unknown): { severity: string | null; ignored: unknown[]; lowered: boolean };
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };
const NONE = { source: "none", version: null, document: null };
const UNAVAILABLE = {
  source: "none",
  version: null,
  document: null,
  unavailable: { reason: "timeout", required: false },
};

function run(core: Core, policy: unknown, withSources: boolean): Report {
  const report = core.check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "CLAUDE.md", "src/a.ts"],
    ...(policy === undefined ? {} : { policy }),
    ...(withSources
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
  return report as Report;
}

const p07 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P07");
const p07Messages = (report: Report) => report.messages.filter((m) => m.code === "POLICY_P07");

describe("org policy rule P07: policy mode only", { timeout: 60_000 }, () => {
  it("AC-11: with no policy, a none policy or an unavailable one, instruction sources change no byte of the report; an app policy with no sources adds nothing; consistencySeverity is null for none and unavailable", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;

    expect(core.consistencySeverity(NONE).severity, "none").toBeNull();
    expect(core.consistencySeverity(UNAVAILABLE).severity, "unavailable").toBeNull();

    for (const [label, policy] of [
      ["no policy", undefined],
      ["none", NONE],
      ["unavailable", UNAVAILABLE],
    ] as const) {
      const withSources = run(core, policy, true);
      const without = run(core, policy, false);
      expect(JSON.stringify(withSources), label).toBe(JSON.stringify(without));
      expect(p07(withSources), label).toEqual([]);
      expect(p07Messages(withSources), label).toEqual([]);
    }

    const appWithout = run(core, APP, false);
    expect(p07(appWithout)).toEqual([]);
    expect(p07Messages(appWithout)).toEqual([]);
  });
});
