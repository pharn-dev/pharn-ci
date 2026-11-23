import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../src/index.js";
import { evaluatePolicyRules, MAX_RULE_VIOLATIONS } from "../src/policy/rules/evaluate.js";
import type { PolicyRuleInput } from "../src/policy/rules/types.js";
import type { Report } from "../src/report.js";
import { byCodeUnit } from "../src/text.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";
import { withoutFix } from "./without-fix.js";

// R1.1 (CORE-35): the per-rule cap of 50 keeps blocking violations first. 50 or more decoy settings files whose paths
// sort before the real one (`.aNN/.claude/settings.json` < `.claude/settings.json`, and < `policy/org.json`), each
// giving a weaker violation of the same rule, must not push the blocking violation out of the kept set and turn the
// rule's message from an error into a warning.

const DIR = "policy-settings/cap-severity/";
const REPO_ROOT = "/home/runner/work/demo/demo";
const REAL = ".claude/settings.json";
const POLICY_PATH = "policy/org.json";
const POLICY_DOCUMENT = JSON.parse(fixture(`${DIR}policy.json`)) as unknown;
const REAL_TEXT = fixture(`${DIR}real-settings.json.txt`);
const DECOY_TEXT = fixture(`${DIR}decoy-settings.json.txt`);
const FILE_POLICY = { source: "file", version: null, path: POLICY_PATH, document: POLICY_DOCUMENT } as const;
const RANK: Record<string, number> = { block: 0, warn: 1, info: 2 };

const decoyPaths = (count: number) =>
  Array.from({ length: count }, (_, i) => `.a${String(i).padStart(3, "0")}/.claude/settings.json`);

/** A unified diff that adds each of `added` with `text`, and modifies each of `modified` (one line changed). */
function diffText(added: readonly string[], text: string, modified: readonly string[]): string {
  const lines = text.trimEnd().split("\n");
  const out: string[] = [];
  for (const path of added) {
    out.push(
      `diff --git a/${path} b/${path}`,
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    );
  }
  for (const path of modified) {
    out.push(
      `diff --git a/${path} b/${path}`,
      "index 1111111..2222222 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@ -1 +1 @@",
      "-export const a = 1;",
      "+export const a = 2;",
    );
  }
  return `${out.join("\n")}\n`;
}

function run(input: { diff: string; files: { path: string; text: string }[]; repoFiles: string[] }): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", POLICY_PATH, "src/a.ts", ...input.repoFiles],
    policy: FILE_POLICY,
    policySettingsSources: { files: input.files, dropped: [] },
  } as never);
  expectValidReport(report);
  return report;
}

const policyMessage = (report: Report, code: string) => withoutFix(report.messages.filter((m) => m.code === code));
const ofRule = (report: Report, id: string) => (report.policy?.violations ?? []).filter((v) => v.id === id);

describe("the per-rule policy cap keeps blocking violations first", { timeout: 60_000 }, () => {
  it("60 violations of one rule: the single block one, last by path, is kept; omitted counts 10; within a severity the order is path, line, detail", () => {
    const decoys = decoyPaths(59);
    const files = [{ path: REAL, text: REAL_TEXT }, ...decoys.map((path) => ({ path, text: DECOY_TEXT }))];
    const input = {
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: POLICY_DOCUMENT },
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: files.map((file) => file.path),
      diff: [],
      configPath: null,
      ignored: [],
      settingsSources: { files, dropped: [] },
    } as unknown as PolicyRuleInput;
    const evaluation = evaluatePolicyRules(input);
    const p02 = evaluation.violations.filter((v) => v.id === "P02");

    expect(p02).toHaveLength(MAX_RULE_VIOLATIONS);
    // The block one is the last by path of the 60, and the first kept.
    expect(p02[0]).toMatchObject({ id: "P02", severity: "block", path: REAL, line: 3 });
    expect(p02.filter((v) => v.severity === "block")).toHaveLength(1);
    // 60 violations, 50 kept: the count of the omitted ones is what it was before the fix.
    expect(evaluation.omitted).toEqual({ P02: 10 });
    // The 49 warn ones kept are the first 49 decoys by path, in path order.
    const warns = p02.filter((v) => v.severity === "warn");
    expect(warns.map((v) => v.path)).toEqual(decoys.slice(0, 49));
    // Within one severity the order is unchanged: path (null first), line (null first), detail.
    const sorted = [...p02].sort(
      (a, b) =>
        (RANK[a.severity] as number) - (RANK[b.severity] as number) ||
        (a.path === b.path ? 0 : a.path === null ? -1 : b.path === null ? 1 : byCodeUnit(a.path, b.path)) ||
        (a.line === b.line ? 0 : a.line === null ? -1 : b.line === null ? 1 : a.line - b.line) ||
        byCodeUnit(a.detail, b.detail),
    );
    expect(p02).toEqual(sorted);
  });

  for (const count of [50, 51, 200]) {
    it(`P02: with ${count} decoy settings files the forbidden allow rule still fails the run, POLICY_P02 at error`, () => {
      const decoys = decoyPaths(count);
      const report = run({
        diff: diffText([], "", ["src/a.ts"]),
        files: [{ path: REAL, text: REAL_TEXT }, ...decoys.map((path) => ({ path, text: DECOY_TEXT }))],
        repoFiles: [REAL, ...decoys],
      });
      expect(report.verdict).toBe("fail");
      expect(policyMessage(report, "POLICY_P02").map((m) => m.level)).toEqual(["error"]);
      expect(withoutFix(ofRule(report, "P02").filter((v) => v.severity === "block"))).toEqual([
        {
          id: "P02",
          severity: "block",
          path: REAL,
          line: 3,
          detail: "allow rule overlaps forbidden permission Bash(curl:*)",
        },
      ]);
      expect(ofRule(report, "P02")).toHaveLength(MAX_RULE_VIOLATIONS);
      // The message still counts every finding, the kept and the omitted ones, and names the block one first.
      expect(policyMessage(report, "POLICY_P02")[0]?.text).toContain(
        `: ${count + 1} findings at \`${REAL}\` line 3, \`.a000/`,
      );
    });

    it(`P09: with ${count} decoy settings files added, an edit of the file: policy still fails the run, POLICY_P09 at error`, () => {
      const decoys = decoyPaths(count);
      const report = run({
        diff: diffText(decoys, DECOY_TEXT, [POLICY_PATH]),
        files: decoys.map((path) => ({ path, text: DECOY_TEXT })),
        repoFiles: decoys,
      });
      expect(report.verdict).toBe("fail");
      expect(policyMessage(report, "POLICY_P09").map((m) => m.level)).toEqual(["error"]);
      expect(withoutFix(ofRule(report, "P09").filter((v) => v.severity === "block"))).toEqual([
        {
          id: "P09",
          severity: "block",
          path: POLICY_PATH,
          line: null,
          detail: "this change edits the policy file it is checked against",
        },
      ]);
      expect(ofRule(report, "P09")).toHaveLength(MAX_RULE_VIOLATIONS);
      // The decoys alone are warnings: P02 stays at warn.
      expect(policyMessage(report, "POLICY_P02").map((m) => m.level)).toEqual(["warn"]);
    });
  }

  it("the diff the P09 cases use parses to the decoys and the policy file", () => {
    const parsed = parseUnifiedDiff(diffText(decoyPaths(2), DECOY_TEXT, [POLICY_PATH]));
    expect(parsed.map((file) => file.path)).toEqual([...decoyPaths(2), POLICY_PATH]);
  });
});
