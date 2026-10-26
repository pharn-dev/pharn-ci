import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-2. check() is loaded inside the test body: the AC test is written before the build
// adds the rules, so nothing the build adds may run while this file loads. expectAgentSetup carries the policy's
// setup.expect, as the adapters pass it after applyPolicy.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const DOCUMENT = { version: 1, setup: { expect: ["cursor"] } };

async function run(repoFiles: string[]): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    expectAgentSetup: ["cursor"],
    policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: DOCUMENT },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("org policy rule P01: setup.expect", { timeout: 60_000 }, () => {
  it("AC-2: an app policy expecting cursor with only CLAUDE.md tracked gives a P01 block violation and AGENT_SETUP_EXPECTED_MISSING at error; a cursor rules file gives none", async () => {
    const report = await run(["CLAUDE.md"]);
    expect(report.policy?.violations.filter((v) => v.id === "P01")).toEqual([
      { id: "P01", severity: "block", path: null, line: null, detail: "no setup file for cursor" },
    ]);
    const missing = report.messages.filter((m) => m.code === "AGENT_SETUP_EXPECTED_MISSING");
    expect(missing).toHaveLength(1);
    expect(missing[0]?.level).toBe("error");
    expect(report.verdict).toBe("fail");

    const complies = await run(["CLAUDE.md", ".cursor/rules/x.mdc"]);
    expect(complies.policy).toBeDefined();
    expect(complies.policy?.violations.filter((v) => v.id === "P01")).toEqual([]);
    expect(complies.messages.filter((m) => m.code === "AGENT_SETUP_EXPECTED_MISSING")).toEqual([]);
  });
});
