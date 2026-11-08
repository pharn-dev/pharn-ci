import { describe, expect, it } from "vitest";
import {
  AGENT_FACTS,
  appPolicy,
  filePolicy,
  HUMAN_FACTS,
  p14Messages,
  p14 as p14WithFix,
  policyFixture,
  runP14,
} from "./p14-run.js";
import { withoutFix } from "./v090-codes.js";

// fix-hints (H6): every finding now carries a `fix`; the pinned literals are unchanged, so p14 reads without it.
const p14 = (report: Parameters<typeof p14WithFix>[0]) => withoutFix(p14WithFix(report));

// Policy rule P14 (agent PR size cap): the caps at their boundary, who and what the rule applies to, its severity, the
// areas a detail names and a missing diff. Every report is validated against schema/report.v2.json.

const sizeFinding = (detail: string, severity = "block") => ({ id: "P14", severity, path: null, line: null, detail });

describe("org policy rule P14: the caps", () => {
  it("max_files: a PR of exactly N files passes and one of N+1 files fails, naming the count, the cap and the areas", () => {
    const policy = appPolicy(policyFixture("files/policy.json"));
    const atCap = runP14({ diff: "files/at-cap.diff", policy });
    expect(p14(atCap)).toEqual([]);
    expect(p14Messages(atCap)).toEqual([]);

    const over = runP14({ diff: "files/over-cap.diff", policy });
    expect(p14(over)).toEqual([sizeFinding("agent PR changes 4 files (cap 3); split it by area: ., docs, src")]);
    expect(p14Messages(over).map((m) => m.level)).toEqual(["error"]);
    expect(over.verdict).toBe("fail");
  });

  it("max_changed_lines: added plus removed lines, N passes and N+1 fails", () => {
    const policy = appPolicy(policyFixture("lines/policy.json"));
    // 6 added and 4 removed lines.
    expect(p14(runP14({ diff: "lines/at-cap.diff", policy }))).toEqual([]);
    const over = runP14({ diff: "lines/over-cap.diff", policy });
    expect(p14(over)).toEqual([sizeFinding("agent PR changes 11 lines (cap 10); split it by area: lib, src")]);
    expect(over.verdict).toBe("fail");
  });

  it("both caps exceeded: two path-less findings and one message naming both", () => {
    const report = runP14({ diff: "both/over-both.diff", policy: appPolicy(policyFixture("both/policy.json")) });
    expect(p14(report)).toEqual([
      sizeFinding("agent PR changes 12 lines (cap 10); split it by area: docs, fixtures, packages"),
      sizeFinding("agent PR changes 4 files (cap 3); split it by area: docs, fixtures, packages"),
    ]);
    const messages = p14Messages(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain(
      "This agent pull request changes 4 files (cap 3) and 12 lines (cap 10), more than the org policy allows; split it by area: docs, fixtures, packages.",
    );
    expect(messages[0]?.text).toContain(
      "Lockfiles, snapshots and *.generated.* files are not counted, nor are coverage.exclude paths unless the pull request edits the config or a workflow.",
    );
    expect(messages[0]?.text).toContain("It counts as an agent PR by: a bot author; a known agent as author.");
  });

  it("the areas: distinct top-level directories in code-unit order, `.` for a root file, at most 10 then a count", () => {
    const report = runP14({ diff: "areas/thirteen-areas.diff", policy: appPolicy(policyFixture("areas/policy.json")) });
    expect(p14(report)).toEqual([
      sizeFinding(
        "agent PR changes 13 files (cap 1); split it by area: ., alpha, bravo, charlie, delta, echo, foxtrot, golf, hotel, india and 3 more",
      ),
    ]);
  });
});

describe("org policy rule P14: where it applies", () => {
  it("a person's pull request over the cap gets no finding", () => {
    const report = runP14({
      diff: "both/over-both.diff",
      policy: appPolicy(policyFixture("both/policy.json")),
      facts: HUMAN_FACTS,
    });
    expect(report.meta?.isAgentPr).toBe(false);
    expect(p14(report)).toEqual([]);
    expect(p14Messages(report)).toEqual([]);
  });

  it("no policy, a policy of source none, and a policy with no cap give no finding: there is no default cap", () => {
    for (const [label, policy] of [
      ["no policy", undefined],
      ["source none", { source: "none", version: null, document: null }],
      ["app policy without caps", appPolicy({ version: 1, agents: { labels: ["bot-pr"] } })],
      ["file policy without caps", filePolicy({ version: 1 })],
    ] as const) {
      const report = runP14({ diff: "areas/thirteen-areas.diff", policy, facts: AGENT_FACTS });
      expect(p14(report), label).toEqual([]);
      expect(p14Messages(report), label).toEqual([]);
    }
  });

  it("an unavailable diff fails closed with one path-less finding, only when a cap is set and the PR is an agent PR", () => {
    const policy = appPolicy(policyFixture("both/policy.json"));
    const report = runP14({ diff: null, policy });
    expect(p14(report)).toEqual([sizeFinding("diff unavailable; the size of the agent PR could not be checked")]);
    expect(p14Messages(report)[0]?.text).toContain(
      "This agent pull request could not be checked against the org policy's size caps, because the diff is unavailable.",
    );
    expect(p14(runP14({ diff: null, policy, facts: HUMAN_FACTS }))).toEqual([]);
    expect(p14(runP14({ diff: null, policy: appPolicy({ version: 1 }) }))).toEqual([]);
  });
});

describe("org policy rule P14: severity", () => {
  it("block by default; an app policy may set warn, info or off", () => {
    const document = policyFixture("files/policy.json");
    const withRule = (rule: string) => appPolicy({ ...document, policy: { rules: { P14: rule } } });

    const warned = runP14({ diff: "files/over-cap.diff", policy: withRule("warn") });
    expect(p14(warned).map((v) => v.severity)).toEqual(["warn"]);
    expect(p14Messages(warned).map((m) => m.level)).toEqual(["warn"]);
    expect(warned.verdict).not.toBe("fail");

    const info = runP14({ diff: "files/over-cap.diff", policy: withRule("info") });
    expect(p14Messages(info).map((m) => m.level)).toEqual(["info"]);

    const off = runP14({ diff: "files/over-cap.diff", policy: withRule("off") });
    expect(p14(off)).toEqual([]);
    expect(p14Messages(off)).toEqual([]);
  });

  it("a policy file cannot lower it: P14 off in the file still blocks and is named in POLICY_OVERRIDE_IGNORED", () => {
    const report = runP14({
      diff: "edited-file/no-edit.diff",
      policy: filePolicy(policyFixture("edited-file/head-off.json")),
    });
    expect(p14(report)).toEqual([sizeFinding("agent PR changes 4 files (cap 3); split it by area: docs, src")]);
    expect(report.verdict).toBe("fail");
    const ignored = report.messages.filter((m) => m.code === "POLICY_OVERRIDE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.text).toContain("policy.rules.P14");
  });

  it("a policy file cannot set warn either: the rule stays at block", () => {
    const document = { ...policyFixture("files/policy.json"), policy: { rules: { P14: "warn" } } };
    const report = runP14({ diff: "files/over-cap.diff", policy: filePolicy(document) });
    expect(p14(report).map((v) => v.severity)).toEqual(["block"]);
  });
});
