import { describe, expect, it } from "vitest";
import { agentPolicyOf, parseUnifiedDiff } from "../src/index.js";
import { fixture } from "./helpers.js";
import { filePolicy, HUMAN_FACTS, p14Messages, p14 as p14WithFix, policyFixture, runP14 } from "./p14-run.js";
import { withoutFix } from "./v090-codes.js";

// fix-hints (H6): every finding now carries a `fix`; the pinned literals are unchanged, so p14 reads without it.
const p14 = (report: Parameters<typeof p14WithFix>[0]) => withoutFix(p14WithFix(report));

// Policy rule P14 (agent PR size cap): a `file:` policy is carried by the pull request, so it may only lower a cap.
// When the PR edits the file, each cap is the smaller of the merge-base and head values; a cap set on one side only
// applies. A base that cannot be read fails closed. Every report is validated against schema/report.v2.json.

const base = { kind: "document", document: policyFixture("edited-file/base.json") };
const detailsOf = (head: string, policyFileBase: unknown, diff = "edited-file/edit.diff") =>
  p14(runP14({ diff, policy: filePolicy(policyFixture(head)), base: policyFileBase })).map((v) => v.detail);

describe("org policy rule P14: a policy file the PR edits can lower a cap, never raise or remove it", () => {
  it("raising the cap in the PR: the merge-base value applies", () => {
    expect(detailsOf("edited-file/head-raised.json", base)).toEqual([
      "agent PR changes 4 files (cap 3); split it by area: .pharn, docs, src",
    ]);
  });

  it("lowering the cap in the PR: the head value applies", () => {
    expect(detailsOf("edited-file/head-lowered.json", base)).toEqual([
      "agent PR changes 4 files (cap 2); split it by area: .pharn, docs, src",
    ]);
  });

  it("removing the caps in the PR: the merge-base values still apply", () => {
    expect(detailsOf("edited-file/head-removed.json", base)).toEqual([
      "agent PR changes 4 files (cap 3); split it by area: .pharn, docs, src",
    ]);
  });

  it("a cap absent at the base and set at head applies: the PR adds the file", () => {
    expect(detailsOf("edited-file/head-lowered.json", { kind: "absent" })).toEqual([
      "agent PR changes 4 files (cap 2); split it by area: .pharn, docs, src",
    ]);
    expect(detailsOf("edited-file/head-raised.json", { kind: "absent" })).toEqual([]);
  });

  it("agentPolicyOf gives the smaller value of each cap; an app policy's caps apply as given", () => {
    const diff = parseUnifiedDiff(fixture("policy-rules/p14/edited-file/edit.diff"));
    const raised = agentPolicyOf(filePolicy(policyFixture("edited-file/head-raised.json")) as never, {
      base: base as never,
      diff,
    });
    expect([raised.maxFiles, raised.maxChangedLines]).toEqual([3, 10]);
    const lowered = agentPolicyOf(filePolicy(policyFixture("edited-file/head-lowered.json")) as never, {
      base: base as never,
      diff,
    });
    expect([lowered.maxFiles, lowered.maxChangedLines]).toEqual([2, 10]);
    const app = agentPolicyOf(
      { source: "app", version: 3, document: policyFixture("edited-file/head-raised.json") } as never,
      { base: base as never, diff },
    );
    expect([app.maxFiles, app.maxChangedLines]).toEqual([50, 1000]);
    const none = agentPolicyOf(filePolicy({ version: 1 }) as never, { base: undefined, diff });
    expect([none.maxFiles, none.maxChangedLines]).toEqual([null, null]);
  });

  it("an edited policy file unreadable at the merge base fails closed, even for a person's PR (it counts as an agent PR)", () => {
    const unreadable = runP14({
      diff: "edited-file/edit.diff",
      policy: filePolicy(policyFixture("edited-file/head-raised.json")),
      base: { kind: "unreadable" },
      facts: HUMAN_FACTS,
    });
    expect(unreadable.meta?.isAgentPr).toBe(true);
    expect(p14(unreadable)).toEqual([
      {
        id: "P14",
        severity: "block",
        path: null,
        line: null,
        detail: "policy file edited and unreadable at the merge base; the size caps could not be checked",
      },
    ]);
    expect(p14Messages(unreadable)[0]?.text).toContain(
      "This agent pull request edits the policy file, and its version at the merge base could not be read, so the size caps that version sets could not be checked.",
    );
    expect(p14Messages(unreadable)[0]?.text).toContain("evidence it could not read (`policy-lists-unreadable`)");
  });

  it("an unreadable base with the policy file not edited adds nothing: the head caps apply", () => {
    expect(detailsOf("edited-file/base.json", { kind: "unreadable" }, "edited-file/no-edit.diff")).toEqual([
      "agent PR changes 4 files (cap 3); split it by area: docs, src",
    ]);
  });
});
