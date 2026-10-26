import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 22 (policy rules), AC-12. check(), evaluatePolicyRules() and the helpers they share are loaded inside the
// test body and fixtures/policy-rules/ is read there too: the AC test is written before the build adds the rules and
// the fixtures, so nothing the build adds may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type ReportPolicy = { source: string; version: number | null; fetchedAt?: string; violations: Violation[] };
type Report = Record<string, unknown> & { verdict: string; messages: Message[]; policy?: ReportPolicy };
type Evaluation = { violations: Violation[]; omitted: Record<string, number>; lowered: string[] };

interface Core {
  check(input: unknown): Report;
  evaluatePolicyRules(input: unknown): Evaluation;
  parseUnifiedDiff(text: string): unknown[];
  scanAgentSetup(paths: readonly string[]): { files: unknown[] };
  summarizeAgentSetup(files: readonly unknown[]): { tools: string[] };
}

const REPO_ROOT = "/home/runner/work/demo/demo";
const FETCHED_AT = "2026-10-26T12:00:00.000Z";
const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  upload: { status: "skipped" },
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** By id, then path (null first), then detail, in code-unit order. */
const order = (a: Violation, b: Violation) =>
  cmp(a.id, b.id) ||
  (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : cmp(a.path, b.path)) ||
  cmp(a.detail, b.detail);

describe("the report's policy object", { timeout: 60_000 }, () => {
  it("AC-12: app, file and unavailable policies write source, version, fetchedAt and sorted violations right before meta, and evaluatePolicyRules returns the same violations", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const repoFiles = fixture("policy-rules/p08-violates/files.txt").trim().split("\n");
    const diffText = fixture("policy-rules/p09-violates/pr.diff");
    const p08 = JSON.parse(fixture("policy-rules/p08-violates/policy.json"));
    const p09 = JSON.parse(fixture("policy-rules/p09-violates/policy.json"));
    const document = { version: 1, setup: { ...p08.setup, ...p09.setup } };

    const run = (policy: unknown) => {
      const report = core.check({
        version: "0.1.0",
        coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
        diff: { text: diffText },
        repoRoot: REPO_ROOT,
        threshold: null,
        repoFiles,
        meta: META,
        policy,
      });
      expectValidReport(report);
      return report;
    };

    const APP = { source: "app", version: 3, fetchedAt: FETCHED_AT, document };
    const app = run(APP);
    expect(Object.keys(app.policy ?? {})).toEqual(["source", "version", "fetchedAt", "violations"]);
    expect(app.policy?.source).toBe("app");
    expect(app.policy?.version).toBe(3);
    expect(app.policy?.fetchedAt).toBe(FETCHED_AT);
    const violations = app.policy?.violations ?? [];
    expect(violations.map((v) => [v.id, v.path])).toEqual([
      ["P08", "CLAUDE.local.md"],
      ["P09", ".claude/settings.json"],
      ["P09", ".mcp.json"],
      ["P09", "packages/a/.claude/settings.local.json"],
    ]);
    expect([...violations].sort(order)).toEqual(violations);

    const file = run({ source: "file", version: null, path: "policy/org.json", document });
    expect(Object.keys(file.policy ?? {})).toEqual(["source", "version", "violations"]);
    expect(file.policy).toEqual({ source: "input", version: null, violations });

    const none = run(JSON.parse(fixture("policy-rules/p10-violates/resolved.json")));
    expect(Object.keys(none.policy ?? {})).toEqual(["source", "version", "violations"]);
    expect(none.policy).toEqual({
      source: "none",
      version: null,
      violations: [
        { id: "P10", severity: "block", path: null, line: null, detail: "org policy could not be read (timeout)" },
      ],
    });

    for (const report of [app, file, none]) {
      const keys = Object.keys(report);
      expect(keys).toContain("meta");
      expect(keys.indexOf("policy")).toBe(keys.indexOf("meta") - 1);
      expect(keys.indexOf("policy")).toBeGreaterThan(keys.indexOf("testIntegrity"));
    }

    // The exported evaluator gives the report's violations for the same inputs.
    const inventory = core.scanAgentSetup(repoFiles);
    const evaluation = core.evaluatePolicyRules({
      policy: APP,
      agentSetupFileCount: inventory.files.length,
      agentTools: core.summarizeAgentSetup(inventory.files).tools,
      repoFiles,
      diff: core.parseUnifiedDiff(diffText),
      configPath: ".pharn/ci.yml",
      ignored: [],
    });
    expect(evaluation.violations).toEqual(violations);
    expect(evaluation.lowered).toEqual([]);
  });
});
