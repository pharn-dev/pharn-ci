import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// E3 item 22 (policy rules), AC-8. check() is loaded inside the test body and fixtures/policy-rules/ is read there
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
    configPath: ".pharn/ci.yml",
    ...extra,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

// fix-hints (H6): every message and finding now carries a `fix`; the pinned literals are unchanged, so these read without it.
const p09 = (report: Report) => withoutFix((report.policy?.violations ?? []).filter((v) => v.id === "P09"));
const configChanged = (report: Report) =>
  withoutFix(report.messages.filter((m) => m.code === "CONFIG_CHANGED_IN_DIFF"));

// CORE-123 (R5.6): an ignored record no longer says which layer (workflow input or config) gave the looser value, so
// class 2 reads any looser record of an app policy, the stricter reading: an edit of the config while the workflow input
// alone is looser is now a block too (it was no class-2 violation). A record that is not `looser`, and every record of a
// policy file (its own values), still give none.
const configViolation = (settings: string) => ({
  id: "P09",
  severity: "block",
  path: ".pharn/ci.yml",
  line: null,
  detail: `this change edits the config while a setting is looser than the policy (${settings})`,
});

describe("org policy rule P09: the config in use", { timeout: 60_000 }, () => {
  it("AC-8: a diff editing .pharn/ci.yml while a setting is looser than an app policy gives a P09 block violation naming the setting, whichever layer gave it; no record gives none; CONFIG_CHANGED_IN_DIFF is unchanged", async () => {
    const config = await run({
      policy: APP,
      policyIgnored: [{ setting: "coverage.threshold", reason: "looser" }],
    });
    // gates.diff also edits .github/workflows/ci.yml, which class 3 reads from the same records.
    const workflow = (settings: string) => ({
      ...configViolation(settings),
      path: ".github/workflows/ci.yml",
      detail: `this change edits a workflow while a setting is looser than the policy (${settings})`,
    });
    expect(p09(config)).toEqual([workflow("coverage.threshold"), configViolation("coverage.threshold")]);

    const fromInput = await run({
      policy: APP,
      policyIgnored: [{ setting: "test_integrity.mode", reason: "looser" }],
    });
    expect(p09(fromInput)).toEqual([workflow("test_integrity.mode"), configViolation("test_integrity.mode")]);

    const none = await run({ policy: APP });
    expect(none.policy).toBeDefined();
    expect(p09(none).filter((v) => v.path === ".pharn/ci.yml")).toEqual([]);

    const fileRecords = await run({
      policy: { source: "file", version: null, path: "policy/org.json", document: { version: 1 } },
      policyIgnored: [{ setting: "coverage.threshold", reason: "looser", given: 60, applied: 70 }],
    });
    expect(fileRecords.policy).toBeDefined();
    expect(p09(fileRecords).filter((v) => v.path === ".pharn/ci.yml")).toEqual([]);

    const plain = await run({});
    expect(configChanged(plain)).toHaveLength(1);
    expect(configChanged(config)).toEqual(configChanged(plain));
    expect(configChanged(fromInput)).toEqual(configChanged(plain));
  });
});
