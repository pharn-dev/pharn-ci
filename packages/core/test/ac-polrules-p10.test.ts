import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-11. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";

async function run(policy: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("org policy rule P10: policy unavailable", { timeout: 60_000 }, () => {
  it("AC-11: an unavailable required policy gives a P10 block violation, one POLICY_UNAVAILABLE error, no POLICY_P10 code and a failing verdict; not required gives a warn violation", async () => {
    const resolved = JSON.parse(fixture("policy-rules/p10-violates/resolved.json"));
    expect(resolved.unavailable).toEqual({ reason: "timeout", required: true });

    const required = await run(resolved);
    expect(required.policy?.violations).toEqual([
      { id: "P10", severity: "block", path: null, line: null, detail: "org policy could not be read (timeout)" },
    ]);
    const unavailable = required.messages.filter((m) => m.code === "POLICY_UNAVAILABLE");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.level).toBe("error");
    expect(JSON.stringify(required)).not.toContain("POLICY_P10");
    expect(required.verdict).toBe("fail");

    const optional = await run({ ...resolved, unavailable: { reason: "timeout", required: false } });
    expect(optional.policy?.violations).toEqual([
      { id: "P10", severity: "warn", path: null, line: null, detail: "org policy could not be read (timeout)" },
    ]);
    expect(optional.messages.filter((m) => m.code === "POLICY_UNAVAILABLE").map((m) => m.level)).toEqual(["warn"]);
    expect(JSON.stringify(optional)).not.toContain("POLICY_P10");
  });
});
