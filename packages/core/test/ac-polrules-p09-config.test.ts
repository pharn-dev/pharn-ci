import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

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

const p09 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P09");
const configChanged = (report: Report) => report.messages.filter((m) => m.code === "CONFIG_CHANGED_IN_DIFF");

describe("org policy rule P09: the config in use", { timeout: 60_000 }, () => {
  it("AC-8: a diff editing .pharn/ci.yml while a config-layer setting is ignored gives a P09 block violation naming the setting; input-layer records alone give no class-2 violation; CONFIG_CHANGED_IN_DIFF is unchanged", async () => {
    const config = await run({
      policy: APP,
      policyIgnored: [{ setting: "coverage.threshold", layer: "config", reason: "looser" }],
    });
    expect(p09(config)).toEqual([
      {
        id: "P09",
        severity: "block",
        path: ".pharn/ci.yml",
        line: null,
        detail: "this change edits the config, which sets coverage.threshold looser than the policy",
      },
    ]);

    const inputOnly = await run({
      policy: APP,
      policyIgnored: [{ setting: "test_integrity.mode", layer: "input", reason: "looser" }],
    });
    expect(inputOnly.policy).toBeDefined();
    expect(p09(inputOnly).filter((v) => v.path === ".pharn/ci.yml")).toEqual([]);

    const plain = await run({});
    expect(configChanged(plain)).toHaveLength(1);
    expect(configChanged(config)).toEqual(configChanged(plain));
    expect(configChanged(inputOnly)).toEqual(configChanged(plain));
  });
});
