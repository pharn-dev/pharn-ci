import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-10. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const DETAIL = "this change edits a file the policy checks; its direction is not judged yet";
const PATHS = [".claude/settings.json", ".mcp.json", "packages/a/.claude/settings.local.json"];

async function run(policy: unknown): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p09-violates/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", "src/a.ts"],
    policy,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const app = (document: unknown) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document,
});
const p09 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P09");
const p09Messages = (report: Report) => report.messages.filter((m) => m.code === "POLICY_P09");

describe("org policy rule P09: a file the policy will read", { timeout: 60_000 }, () => {
  it("AC-10: editing three agent-settings files under a policy with an agent-settings list gives three P09 warn violations and a POLICY_P09 warning; empty lists, no lists, app off and an unavailable policy give none; a file block raises them", async () => {
    const violates = JSON.parse(fixture("policy-rules/p09-violates/policy.json"));
    const complies = JSON.parse(fixture("policy-rules/p09-complies/policy.json"));

    const warned = await run(app(violates));
    expect(p09(warned)).toEqual(
      PATHS.map((path) => ({ id: "P09", severity: "warn", path, line: null, detail: DETAIL })),
    );
    const messages = p09Messages(warned);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toContain("This change edits 3 files that the org policy guards: ");
    for (const path of PATHS) expect(messages[0]?.text).toContain(path);

    for (const document of [complies, { version: 1 }]) {
      const none = await run(app(document));
      expect(none.policy).toBeDefined();
      expect(p09(none)).toEqual([]);
      expect(p09Messages(none)).toEqual([]);
    }

    const raised = await run({
      source: "file",
      version: null,
      path: "org-policy.json",
      document: { ...violates, policy: { rules: { P09: "block" } } },
    });
    expect(p09(raised)).toEqual(
      PATHS.map((path) => ({ id: "P09", severity: "block", path, line: null, detail: DETAIL })),
    );
    expect(p09Messages(raised).map((m) => m.level)).toEqual(["error"]);

    const off = await run(app({ ...violates, policy: { rules: { P09: "off" } } }));
    expect(off.policy).toBeDefined();
    expect(p09(off)).toEqual([]);
    expect(p09Messages(off)).toEqual([]);

    const unavailable = await run(JSON.parse(fixture("policy-rules/p10-violates/resolved.json")));
    expect(unavailable.policy).toBeDefined();
    expect(p09(unavailable)).toEqual([]);
    expect(p09Messages(unavailable)).toEqual([]);
  });
});
