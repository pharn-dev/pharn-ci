import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 23 (policy settings), AC-21. check() is loaded inside the test body, and item 22's fixtures/policy-rules/
// are read there too: the AC test is written before the build adds policySettingsSources, so nothing the build adds
// may run while this file loads.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const NEW_CODES = ["POLICY_P02", "POLICY_P03", "POLICY_P04", "POLICY_P05", "POLICY_P06", "POLICY_SETTINGS_INVALID"];
const ITEM_22_DETAIL = "this change edits a file the policy checks; its direction is not judged yet";

async function run(input: { policy?: unknown; repoFiles: string[]; diff: string; sources?: unknown }): Promise<Report> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: input.diff },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: input.repoFiles,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.sources === undefined ? {} : { policySettingsSources: input.sources }),
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const file = (document: unknown) => ({ source: "file", version: null, path: "policy/org.json", document });
const settingsIds = (report: Report) =>
  (report.policy?.violations ?? []).filter((v) => /^P0[2-6]$/.test(v.id)).map((v) => v.id);
const newCodes = (report: Report) => report.messages.filter((m) => NEW_CODES.includes(m.code));

describe("policySettingsSources absent: item 22's reports", { timeout: 60_000 }, () => {
  it("AC-21: without sources item 22's fixtures give no P02–P06 violation and no new message, P09 class 4 keeps its warn, no policy gives no policy object, and the same policy with sources does run P02", async () => {
    const p09Diff = fixture("policy-rules/p09-violates/pr.diff");
    const emptyDiff = fixture("diff/empty.diff");
    const cases = [
      {
        label: "p01",
        policy: file(JSON.parse(fixture("policy-rules/p01-violates/policy.json"))),
        repoFiles: fixture("policy-rules/p01-violates/files.txt").trim().split("\n"),
        diff: emptyDiff,
      },
      {
        label: "p08",
        policy: file(JSON.parse(fixture("policy-rules/p08-violates/policy.json"))),
        repoFiles: fixture("policy-rules/p08-violates/files.txt").trim().split("\n"),
        diff: emptyDiff,
      },
      {
        label: "p09",
        policy: file(JSON.parse(fixture("policy-rules/p09-violates/policy.json"))),
        repoFiles: ["AGENTS.md", "src/a.ts"],
        diff: p09Diff,
      },
      {
        label: "p10",
        policy: JSON.parse(fixture("policy-rules/p10-violates/resolved.json")),
        repoFiles: ["AGENTS.md", "src/a.ts"],
        diff: emptyDiff,
      },
    ];
    for (const c of cases) {
      const report = await run(c);
      expect(report.policy, `${c.label}: a policy object`).toBeDefined();
      expect(settingsIds(report), `${c.label}: no P02–P06 violation`).toEqual([]);
      expect(newCodes(report), `${c.label}: no new message`).toEqual([]);
    }

    const p09 = await run(cases[2] as (typeof cases)[number]);
    expect((p09.policy?.violations ?? []).filter((v) => v.id === "P09")).toEqual(
      [".claude/settings.json", ".mcp.json", "packages/a/.claude/settings.local.json"].map((path) => ({
        id: "P09",
        severity: "warn",
        path,
        line: null,
        detail: ITEM_22_DETAIL,
      })),
    );

    const none = await run({ repoFiles: ["AGENTS.md", "src/a.ts"], diff: p09Diff });
    expect("policy" in none, "no policy: no policy object").toBe(false);
    expect(newCodes(none)).toEqual([]);

    // Control: the same p09 policy with sources present runs P02 (its fixed defaultMode check needs no list).
    const control = await run({
      ...(cases[2] as (typeof cases)[number]),
      sources: {
        files: [{ path: ".claude/settings.json", text: '{ "permissions": { "defaultMode": "bypassPermissions" } }\n' }],
        dropped: [],
      },
    });
    expect(settingsIds(control), "control: sources present give a P02 violation").toContain("P02");
    expect(newCodes(control).map((m) => m.code)).toContain("POLICY_P02");
  });
});
