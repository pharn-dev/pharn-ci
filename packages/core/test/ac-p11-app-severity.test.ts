import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-4. check() is loaded inside the test body and fixtures/policy-rules/p11/ is read there
// too: the AC test is written before the build adds rule P11 and its fixtures, so nothing the build adds may run while
// this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const AGENT_FACTS = {
  pr: {
    author: { login: "claude[bot]", type: "Bot" },
    labels: [],
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
};

/** An app policy from workflows/policy.json with the given protected_paths_mode and policy.rules.P11. */
function appPolicy(mode: string | undefined, rule: string | undefined) {
  const base = JSON.parse(fixture("policy-rules/p11/workflows/policy.json"));
  const document = {
    ...base,
    agents: { ...base.agents, ...(mode === undefined ? {} : { protected_paths_mode: mode }) },
    ...(rule === undefined ? {} : { policy: { rules: { P11: rule } } }),
  };
  return { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document };
}

async function run(mode: string | undefined, rule: string | undefined): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p11/workflows/ci.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".github/workflows/ci.yml", "src/a.ts"],
    policy: appPolicy(mode, rule),
    agentPrFacts: AGENT_FACTS,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
const levels = (report: Report) => report.messages.filter((m) => m.code === "POLICY_P11").map((m) => m.level);

describe("org policy rule P11: severity under an app policy", { timeout: 60_000 }, () => {
  it("AC-4: protected_paths_mode warn gives warn, P11 off removes the rule, P11 info gives info, and the stricter of mode and rule applies, with block by default", async () => {
    const warned = await run("warn", undefined);
    expect(p11(warned).map((v) => v.severity)).toEqual(["warn"]);
    expect(levels(warned)).toEqual(["warn"]);
    expect(warned.verdict).not.toBe("fail");

    const off = await run(undefined, "off");
    expect(p11(off)).toEqual([]);
    expect(levels(off)).toEqual([]);

    const info = await run(undefined, "info");
    expect(p11(info).map((v) => v.severity)).toEqual(["info"]);
    expect(levels(info)).toEqual(["info"]);

    for (const [mode, rule] of [
      ["warn", "block"],
      ["block", "warn"],
      [undefined, undefined],
    ] as const) {
      const label = `mode ${mode ?? "unset"}, rule ${rule ?? "unset"}`;
      const report = await run(mode, rule);
      expect(
        p11(report).map((v) => v.severity),
        label,
      ).toEqual(["block"]);
      expect(levels(report), label).toEqual(["error"]);
      expect(report.verdict, label).toBe("fail");
    }
  });
});
