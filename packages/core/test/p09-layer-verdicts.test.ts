import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";
import { type InputErrorText, type RawInputs, resolveInputs } from "../src/inputs.js";
import { applyPolicy } from "../src/policy/apply.js";
import type { ResolvedPolicy } from "../src/policy/resolved.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";
import { withoutFix } from "./v090-codes.js";

// CORE-123 (R5.6) keeps the layer an app policy beat on each `looser` record, so P09 classes 2 and 3 give main's
// verdicts: class 2 (the PR edits the config) fires only while a .pharn/ci.yml setting is looser than the app policy,
// class 3 (the PR edits a workflow) only while a workflow input is. A looser config does not make every workflow edit
// (a Dependabot pin bump, say) a block, and a looser input does not make every .pharn/ci.yml edit one.
//
// The records come from applyPolicy over real layers: fixtures/inputs/ci.yml sets threshold 80, so an app threshold of
// 90 beats the config; a test-integrity input of off under an app mode of block beats the input. The diffs are the two
// halves of fixtures/policy-rules/p09-violates/gates.diff (its workflow part and its config part).

const TEXT: InputErrorText = {
  coverageFormat: (value) => `bad format "${value}"`,
  threshold: "THRESHOLD",
  exclude: "EXCLUDE",
  coverageRoot: "ROOT",
  noCoverageFile: "no coverage file",
};
const CONFIG = parseConfig(fixture("inputs/ci.yml"));
const APP: ResolvedPolicy = {
  source: "app",
  version: 3,
  fetchedAt: "2026-10-26T12:00:00.000Z",
  document: { version: 1, coverage: { threshold: 90 }, test_integrity: { mode: "block" } },
} as ResolvedPolicy;

function ignoredFor(config: typeof CONFIG, raw: RawInputs) {
  const fullRaw = { coverageFile: "coverage/lcov.info", ...raw };
  const result = resolveInputs(config, fullRaw, TEXT);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join("; "));
  return applyPolicy({ config, raw: fullRaw, resolved: result.inputs }, APP).ignored;
}

const SECTIONS = fixture("policy-rules/p09-violates/gates.diff").split(/^(?=diff --git )/m);
const section = (path: string): string => {
  const found = SECTIONS.find((s) => s.startsWith(`diff --git a/${path} `));
  if (found === undefined) throw new Error(`gates.diff has no section for ${path}`);
  return found;
};
const WORKFLOW_ONLY = section(".github/workflows/ci.yml");
const CONFIG_ONLY = section(".pharn/ci.yml");

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };

function p09(diff: string, ignored: ReturnType<typeof ignoredFor>) {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", ".pharn/ci.yml", ".github/workflows/ci.yml", "src/a.ts"],
    configPath: ".pharn/ci.yml",
    policy: APP,
    policyIgnored: ignored,
  } as never);
  expectValidReport(report);
  const violations = (report.policy?.violations ?? []) as Violation[];
  return {
    violations: withoutFix(violations.filter((v) => v.id === "P09")),
    messages: report.messages.filter((m) => m.code === "POLICY_P09"),
  };
}

describe("P09 classes 2 and 3 read the layer an app policy beat (CORE-123)", { timeout: 60_000 }, () => {
  const configLooser = ignoredFor(CONFIG, {});
  const inputLooser = ignoredFor({}, { testIntegrity: "off" });

  it("builds the records the cases below rely on: one from the config, one from the input", () => {
    expect(configLooser).toEqual([
      { setting: "coverage.threshold", layer: "config", reason: "looser", given: 80, applied: 90 },
    ]);
    expect(inputLooser).toEqual([{ setting: "test_integrity.mode", layer: "input", reason: "looser" }]);
  });

  it("(a) an app policy with only the config looser gives no P09 for a PR that edits only a workflow", () => {
    const result = p09(WORKFLOW_ONLY, configLooser);
    expect(result.violations).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it("(b) a workflow input looser than the app policy gives no P09 for a PR that edits only .pharn/ci.yml", () => {
    const result = p09(CONFIG_ONLY, inputLooser);
    expect(result.violations).toEqual([]);
    expect(result.messages).toEqual([]);
  });

  it("(c) the config looser and a config edit is a class-2 block; an input looser and a workflow edit is a class-3 block", () => {
    const config = p09(CONFIG_ONLY, configLooser);
    expect(config.violations).toEqual([
      {
        id: "P09",
        severity: "block",
        path: ".pharn/ci.yml",
        line: null,
        detail: "this change edits the config, which sets coverage.threshold looser than the policy",
      },
    ]);
    expect(config.messages.map((m) => m.level)).toEqual(["error"]);

    const workflow = p09(WORKFLOW_ONLY, inputLooser);
    expect(workflow.violations).toEqual([
      {
        id: "P09",
        severity: "block",
        path: ".github/workflows/ci.yml",
        line: null,
        detail: "this change edits a workflow while a workflow input is looser than the policy (test_integrity.mode)",
      },
    ]);
    expect(workflow.messages.map((m) => m.level)).toEqual(["error"]);

    // Both layers looser: each edit is blocked by its own class, and only by it.
    const both = [...configLooser, ...inputLooser];
    expect(p09(CONFIG_ONLY, both).violations.map((v) => v.path)).toEqual([".pharn/ci.yml"]);
    expect(p09(WORKFLOW_ONLY, both).violations.map((v) => v.path)).toEqual([".github/workflows/ci.yml"]);
  });
});
