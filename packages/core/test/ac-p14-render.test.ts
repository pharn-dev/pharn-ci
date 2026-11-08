import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agentPolicyOf,
  type Report as CoreReport,
  detectAgentPr,
  evaluatePolicyRules,
  parseUnifiedDiff,
  renderMarkdown,
} from "../src/index.js";
import { AGENT_FACTS, appPolicy, p14Messages, policyFixture, runP14 } from "./p14-run.js";
import { purityViolations } from "./purity-check.js";
import { V060_CODE_TEXT } from "./v060-codes.js";

// Policy rule P14 (agent PR size cap): the PR comment's Policy section, the code in the report schema and the README,
// and the purity of the new module.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const HINT =
  "Split the agent pull request into smaller ones, one per area named, or ask the policy owner to change `agents.max_files` or `agents.max_changed_lines`. Lockfiles, snapshots and `*.generated.*` files do not count.";

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

  it("schema/report.v2.json names POLICY_P14 among the codes added in v0.6.0, and the README's codes table and rules list name it", () => {
    const schema = JSON.parse(read("schema/report.v2.json"));
    const description: string = schema.$defs.message.properties.code.description;
    // Re-pinned when main (P14) was merged with policy-p13: the one v0.6.0 sentence lists POLICY_P13 first, then
    // POLICY_P14 with P14's own words (v060-codes.ts pins the whole sentence).
    expect(description).toContain(V060_CODE_TEXT);
    expect(description).toContain(", POLICY_P14 (error, or the level the org policy sets for P14:");
    const readme = read("README.md");
    expect(readme).toContain("| `POLICY_P14` |");
    expect(readme).toContain("- **P14**, agent PR too large:");
    expect(readme).toContain("set `agents.max_files` / `agents.max_changed_lines` to turn it on");
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
