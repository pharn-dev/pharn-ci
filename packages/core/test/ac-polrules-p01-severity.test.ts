import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-4. check() is loaded inside the test body and fixtures/policy-rules/ is read there
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
    repoFiles: fixture("policy-rules/p01-violates/files.txt").trim().split("\n"),
    requireAgentSetup: true,
    ...(policy === undefined ? {} : { policy }),
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);
const p01 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P01");

describe("org policy rule P01: severity from policy.rules", { timeout: 60_000 }, () => {
  it("AC-4: app warn lowers P01 and NO_AGENT_SETUP_FILES to warn, app off removes the violation and keeps today's level, a file warn stays block and is reported ignored", async () => {
    const document = JSON.parse(fixture("policy-rules/p01-violates/policy.json"));
    const rules = (P01: string) => ({ ...document, policy: { rules: { P01 } } });
    const app = (P01: string) => ({
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: rules(P01),
    });

    // App warn: every P01 violation is warn, and so is NO_AGENT_SETUP_FILES.
    const warned = await run(app("warn"));
    expect(p01(warned).length).toBeGreaterThan(0);
    expect(p01(warned).map((v) => v.detail)).toContain("no agent setup files found");
    expect(new Set(p01(warned).map((v) => v.severity))).toEqual(new Set(["warn"]));
    expect(withCode(warned, "NO_AGENT_SETUP_FILES").map((m) => m.level)).toEqual(["warn"]);

    // App off: no P01 violation; NO_AGENT_SETUP_FILES keeps the level and text it has today with requireAgentSetup.
    const today = await run(undefined);
    const todayNoFiles = withCode(today, "NO_AGENT_SETUP_FILES");
    expect(todayNoFiles.map((m) => m.level)).toEqual(["error"]);
    const off = await run(app("off"));
    expect(off.policy).toBeDefined();
    expect(p01(off)).toEqual([]);
    expect(withCode(off, "NO_AGENT_SETUP_FILES")).toEqual(todayNoFiles);

    // File warn: a policy file can only raise, so the violation stays block and the setting is reported ignored.
    const file = await run({ source: "file", version: null, path: "policy/org.json", document: rules("warn") });
    expect(p01(file).length).toBeGreaterThan(0);
    expect(new Set(p01(file).map((v) => v.severity))).toEqual(new Set(["block"]));
    const ignored = withCode(file, "POLICY_OVERRIDE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.text).toContain("policy.rules.P01 (policy-file)");
  });
});
