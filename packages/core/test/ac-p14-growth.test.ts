import { describe, expect, it } from "vitest";
import { agentPolicyOf, detectAgentPr, parseUnifiedDiff } from "../src/index.js";
import { detectP14 } from "../src/policy/rules/p14.js";
import { measureGrowth } from "./growth.js";

// Policy rule P14 (agent PR size cap): the count is one pass over the diff, with 16 generated-file globs and the
// exclude patterns tried on each path. The time over a diff of 4,000 entries stays under 8 times that over 1,000 (a
// ratio near 4 is linear, near 16 quadratic). Measured with measureGrowth, never against a wall-clock budget.

const EXCLUDE = Array.from({ length: 10 }, (_, i) => `vendor${i}/**`);
const modification = (path: string) =>
  [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, "@@ -2 +2,2 @@", "-a", "+b", "+c"].join("\n");
/** Every third entry is a lockfile, every third a vendored file, the rest are counted, in 50 top-level directories. */
const pathOf = (i: number) =>
  i % 3 === 0
    ? `pkg${i % 50}/deep/pnpm-lock.yaml`
    : i % 3 === 1
      ? `vendor${i % 10}/f${i}.js`
      : `area${i % 50}/f${i}.ts`;
const diffText = (count: number) => `${Array.from({ length: count }, (_, i) => modification(pathOf(i))).join("\n")}\n`;

describe("org policy rule P14: linear time", { timeout: 180_000 }, () => {
  it("the P14 rule over a 4,000-entry diff takes under 8 times as long as over a 1,000-entry diff", async () => {
    const policy = { source: "app", version: 3, document: { version: 1, agents: { max_files: 1 } } } as never;
    const agentPr = detectAgentPr({
      pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [] },
    } as never);
    const inputOf = (count: number) => {
      const diff = parseUnifiedDiff(diffText(count));
      expect(diff).toHaveLength(count);
      return {
        policy,
        agentSetupFileCount: 1,
        agentTools: [],
        repoFiles: [],
        diff,
        configPath: ".pharn/ci.yml",
        ignored: [],
        agentPr,
        agentPolicy: agentPolicyOf(policy, { base: undefined, diff }),
        coverageExclude: EXCLUDE,
      };
    };
    const small = inputOf(1000);
    const large = inputOf(4000);

    // Warm-up runs, checked: a third of the entries count.
    expect(detectP14(small).map((f) => f.detail)).toEqual([
      "agent PR changes 333 files (cap 1); split it by area: area0, area1, area10, area11, area12, area13, area14, area15, area16, area17 and 40 more",
    ]);
    expect(detectP14(large).map((f) => f.detail)[0]).toMatch(/^agent PR changes 1333 files \(cap 1\)/);

    const growth = await measureGrowth(
      () => detectP14(small),
      () => detectP14(large),
    );
    expect(growth.ratio, growth.detail).toBeLessThan(8);
  });
});
