import { describe, expect, it } from "vitest";
import { measureGrowth } from "./growth.js";

// E3 item 24a part B (P11), AC-20. detectP11(), agentPolicyOf() and detectAgentPr() are loaded inside the test body:
// the AC test is written before the build adds rule P11, so nothing the build adds may run while this file loads.

type Finding = { id: string; path: string | null };
interface P11Module {
  detectP11(input: unknown): Finding[];
}
interface Core {
  detectAgentPr(facts: unknown): unknown;
  agentPolicyOf(policy: unknown, from: { base: unknown; diff: readonly unknown[] | null }): unknown;
  parseUnifiedDiff(text: string): unknown[];
}

/** 20 protected globs: ten directories, then nine extensions and one exact path. */
const GLOBS = [
  ...Array.from({ length: 10 }, (_, i) => `guarded${i}/**`),
  ...["lock", "tf", "sql", "pem", "key", "env", "tfvars", "proto", "graphql"].map((ext) => `**/*.${ext}`),
  "package.json",
];

const modification = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -2,0 +3 @@",
    "+x",
  ].join("\n");
/** Entry i is protected when i is even (under guarded<i mod 10>/), else it matches no glob. */
const pathOf = (i: number) => (i % 2 === 0 ? `guarded${(i / 2) % 10}/f${i}.ts` : `open${i % 7}/deep/f${i}.ts`);
const diffText = (count: number) => `${Array.from({ length: count }, (_, i) => modification(pathOf(i))).join("\n")}\n`;

describe("org policy rule P11: linear time", { timeout: 180_000 }, () => {
  it("AC-20: with 20 protected globs, the P11 rule over a 4,000-entry diff takes under 8 times as long as over a 1,000-entry diff", async () => {
    expect(GLOBS).toHaveLength(20);
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const { detectP11 } = (await import("../src/policy/rules/p11.js")) as unknown as P11Module;
    const policy = {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: { version: 1, agents: { protected_paths: GLOBS } },
    };
    const agentPr = core.detectAgentPr({
      pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [] },
    });
    const inputOf = (count: number) => {
      const diff = core.parseUnifiedDiff(diffText(count));
      expect(diff).toHaveLength(count);
      return {
        policy,
        agentSetupFileCount: 1,
        agentTools: [],
        repoFiles: ["AGENTS.md"],
        diff,
        configPath: ".pharn/ci.yml",
        ignored: [],
        agentPr,
        agentPolicy: core.agentPolicyOf(policy, { base: undefined, diff }),
      };
    };
    const small = inputOf(1000);
    const large = inputOf(4000);

    // Warm-up runs, checked: every even entry is protected.
    expect(detectP11(small).filter((f) => f.id === "P11")).toHaveLength(500);
    expect(detectP11(large).filter((f) => f.id === "P11")).toHaveLength(2000);

    const growth = await measureGrowth(
      () => detectP11(small),
      () => detectP11(large),
    );
    expect(growth.ratio, growth.detail).toBeLessThan(8);
  });
});
