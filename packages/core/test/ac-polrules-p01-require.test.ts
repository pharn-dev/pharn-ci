import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-1. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const ORG_TEXT =
  "No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found, and agent setup is required by the org policy.";

async function run(repoFiles: string[], document: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("diff/empty.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles,
    policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document },
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const lines = (path: string) => fixture(path).trim().split("\n");

describe("org policy rule P01: setup.require", { timeout: 60_000 }, () => {
  it("AC-1: an app policy with setup.require and an empty inventory gives a P01 block violation and NO_AGENT_SETUP_FILES at error with the org-policy text; AGENTS.md tracked gives none", async () => {
    const document = JSON.parse(fixture("policy-rules/p01-violates/policy.json"));
    expect(document.setup?.require).toBe(true);

    const report = await run(lines("policy-rules/p01-violates/files.txt"), document);
    expect(report.policy?.violations).toContainEqual({
      id: "P01",
      severity: "block",
      path: null,
      line: null,
      detail: "no agent setup files found",
    });
    const noFiles = report.messages.filter((m) => m.code === "NO_AGENT_SETUP_FILES");
    expect(noFiles).toEqual([{ level: "error", code: "NO_AGENT_SETUP_FILES", text: ORG_TEXT }]);
    expect(report.verdict).toBe("fail");

    const complies = await run(["AGENTS.md", "package.json", "src/a.ts"], document);
    expect(complies.policy).toBeDefined();
    expect(complies.policy?.violations.filter((v) => v.id === "P01")).toEqual([]);
    expect(complies.messages.filter((m) => m.code === "NO_AGENT_SETUP_FILES")).toEqual([]);
  });
});
