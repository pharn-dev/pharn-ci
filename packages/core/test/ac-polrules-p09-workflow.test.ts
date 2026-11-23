import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// E3 item 22 (policy rules), AC-9. check() is loaded inside the test body and fixtures/policy-rules/ is read there
// too: the AC test is written before the build adds the rules and the fixtures, so nothing the build adds may run
// while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const APP = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: { version: 1 } };

async function run(extra: Record<string, unknown>): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("policy-rules/p09-violates/gates.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ".pharn/ci.yml", ".github/workflows/ci.yml", "policy/org.json", "src/a.ts"],
    policy: APP,
    ...extra,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

// fix-hints (H6): every finding now carries a `fix`; the pinned literals are unchanged, so this reads without it.
const p09 = (report: Report) => withoutFix((report.policy?.violations ?? []).filter((v) => v.id === "P09"));

// CORE-123 (R5.6): an ignored record no longer says which layer gave the looser value, so class 3 reads any looser
// record of an app policy (the stricter reading: a config-only record now counts too). gates.diff edits the config as
// well, so class 2 gives its own violation beside this one.
const workflowViolation = (settings: string) => ({
  id: "P09",
  severity: "block",
  path: ".github/workflows/ci.yml",
  line: null,
  detail: `this change edits a workflow while a setting is looser than the policy (${settings})`,
});

describe("org policy rule P09: a workflow", { timeout: 60_000 }, () => {
  // The title is AC-9's as item 22 wrote it. Since CORE-123 a record carries no layer: "an input-layer setting" is a
  // workflow input's looser value, and "no input-layer record" is no record at all (a config record now counts too,
  // in the test below).
  it("AC-9: a diff editing a workflow while an input-layer setting is ignored gives a P09 block violation naming the setting; with no input-layer record there is none", async () => {
    const report = await run({
      policyIgnored: [{ setting: "test_integrity.mode", reason: "looser" }],
    });
    expect(p09(report).filter((v) => v.path === ".github/workflows/ci.yml")).toEqual([
      workflowViolation("test_integrity.mode"),
    ]);

    const none = await run({});
    expect(none.policy).toBeDefined();
    expect(p09(none)).toEqual([]);
  });

  it("a config setting looser than an app policy makes a workflow edit a P09 block too (CORE-123)", async () => {
    const fromConfig = await run({
      policyIgnored: [{ setting: "coverage.threshold", reason: "looser" }],
    });
    expect(p09(fromConfig).filter((v) => v.path === ".github/workflows/ci.yml")).toEqual([
      workflowViolation("coverage.threshold"),
    ]);
  });
});
