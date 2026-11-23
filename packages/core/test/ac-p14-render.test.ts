import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Report as CoreReport, detectAgentPr, parseUnifiedDiff, renderMarkdown } from "../src/index.js";
import { agentPolicyOf } from "../src/policy/agents.js";
import { evaluatePolicyRules } from "../src/policy/rules/evaluate.js";
import { codeRow } from "./codeTable.js";
import { AGENT_FACTS, appPolicy, p14Messages, policyFixture, runP14 } from "./p14-run.js";
import { purityViolations } from "./purity-check.js";

// Policy rule P14 (agent PR size cap): the PR comment's Policy section, the code in the report schema, and the purity
// of the new module. (CORE-133: the README wording checks moved out; docs-contract.test.ts checks the README code row.)

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
// CORE-140: the comment's hint is the code's fix.hint, the one advice text of POLICY_P14.
const HINT = "Split the change into smaller pull requests within the org policy's size caps.";

/** The lines of a `### ` section whose heading starts with `heading`, up to the next `### ` heading. */
function section(md: string, heading: string): string[] {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => l.startsWith(heading));
  expect(at, heading).toBeGreaterThanOrEqual(0);
  const next = lines.findIndex((l, i) => i > at && l.startsWith("### "));
  return lines.slice(at, next === -1 ? undefined : next);
}

describe("org policy rule P14 in the PR comment, the schema and the docs", () => {
  it("the Policy section lists each path-less P14 violation with the POLICY_P14 hint; the message is not repeated in Messages", () => {
    const report = runP14({ diff: "both/over-both.diff", policy: appPolicy(policyFixture("both/policy.json")) });
    const markdown = renderMarkdown(report as unknown as CoreReport);
    const policy = section(markdown, "### 📜 Policy");
    const filesLine = policy.findIndex((l) => l.startsWith("- ❌ **P14** — agent PR changes 4 files (cap 3)"));
    expect(filesLine, "the files violation").toBeGreaterThanOrEqual(0);
    expect(policy[filesLine + 1]).toBe(`  - Hint: ${HINT}`);
    expect(policy.some((l) => l.startsWith("- ❌ **P14** — agent PR changes 12 lines (cap 10)"))).toBe(true);
    expect(markdown).not.toContain("`POLICY_P14`");
    expect(p14Messages(report)).toHaveLength(1);
  });

  it("a directory name with control or bidirectional characters is shown with U+FFFD in its place", () => {
    const policy = appPolicy({ version: 1, agents: { max_files: 1 } }) as never;
    const diff = parseUnifiedDiff(
      ["a‮b/x.ts", "c\u0007d/y.ts"]
        .map((path) =>
          [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -1,0 +2 @@", "+x"].join("\n"),
        )
        .join("\n"),
    );
    expect(diff).toHaveLength(2);
    const evaluation = evaluatePolicyRules({
      policy,
      agentSetupFileCount: 1,
      agentTools: [],
      repoFiles: [],
      diff,
      configPath: ".pharn/ci.yml",
      ignored: [],
      agentPr: detectAgentPr(AGENT_FACTS as never),
      agentPolicy: agentPolicyOf(policy, { base: undefined, diff }),
    });
    expect(evaluation.violations.map((v) => v.detail)).toEqual([
      "agent PR changes 2 files (cap 1); split it by area: a�b, c�d",
    ]);
  });

  it("the code table documents POLICY_P13 and POLICY_P14 with their levels, and schema/policy.v1.json describes the caps", () => {
    // CORE-132: the byte-for-byte pin of the whole v0.6.0 sentence (v060-codes.ts, a history-pin helper) is removed.
    // CORE-140: the schema's code description is one sentence and a link to the code table, so the rows are read.
    expect(codeRow("POLICY_P13")).toContain("(`error`, or the level an app policy sets for P13)");
    expect(codeRow("POLICY_P14")).toContain("(`error`, or the level the policy sets for P14)");
    const policySchema = JSON.parse(read("schema/policy.v1.json"));
    for (const key of ["max_files", "max_changed_lines"]) {
      const text: string = policySchema.properties.agents.properties[key].description;
      expect(text, key).toContain("there is no default cap");
      expect(text, key).not.toContain("item 20 decides");
    }
  });

  it("policy/rules/p14.ts passes the purity check", () => {
    expect(purityViolations(readFileSync(new URL("../src/policy/rules/p14.ts", import.meta.url), "utf8"))).toEqual([]);
  });
});
