import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// E3 item 24a part B (P11), AC-9. check() is loaded inside the test body: the AC test is written before the build adds
// rule P11, so nothing the build adds may run while this file loads. The diffs are generated here.

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; policy?: { violations: Violation[] } };

const REPO_ROOT = "/home/runner/work/demo/demo";
const AGENT_FACTS = {
  pr: {
    author: { login: "claude[bot]", type: "Bot" },
    labels: [],
    commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: "Fix the parser\n" }],
  },
};

const name = (i: number) => `gen/f${String(i).padStart(2, "0")}.ts`;
const modification = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -2,0 +3 @@",
    "+x",
  ].join("\n");

async function run(count: number): Promise<{ report: Report; paths: string[] }> {
  const { check } = await import("@pharn-ci/core");
  const paths = Array.from({ length: count }, (_, i) => name(i));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    // The entries in reverse order: the kept violations must be the first in path order, not in diff order.
    diff: { text: `${[...paths].reverse().map(modification).join("\n")}\n` },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: ["AGENTS.md", ...paths],
    policy: {
      source: "app",
      version: 3,
      fetchedAt: "2026-10-26T12:00:00.000Z",
      document: { version: 1, agents: { protected_paths: ["gen/**"] } },
    },
    agentPrFacts: AGENT_FACTS,
  } as never);
  expectValidReport(report);
  return { report: report as unknown as Report, paths };
}

const p11 = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11");
function p11Text(report: Report): string {
  const messages = report.messages.filter((m) => m.code === "POLICY_P11");
  expect(messages).toHaveLength(1);
  return messages[0]?.text ?? "";
}

describe("org policy rule P11: the cap", { timeout: 60_000 }, () => {
  it("AC-9: 60 protected paths keep 50 violations and the message counts 60, names 20 and says and 40 more and 10 not listed; 51 says 1 is not listed; 1 path uses the singular and lists all", async () => {
    const sixty = await run(60);
    const kept = p11(sixty.report);
    expect(kept).toHaveLength(50);
    expect(kept.map((v) => v.path)).toEqual(sixty.paths.slice(0, 50));
    const text = p11Text(sixty.report);
    expect(text.startsWith("This agent pull request changes 60 paths the org policy protects: "), text).toBe(true);
    const named = [...text.matchAll(/`(gen\/f\d\d\.ts)`/g)].map((m) => m[1]);
    expect(named).toEqual(sixty.paths.slice(0, 20));
    expect(text).toContain(" and 40 more");
    expect(text.indexOf(" and 40 more")).toBeGreaterThan(text.indexOf("`gen/f19.ts`"));
    expect(text).toContain(" 10 of them are not listed in the report.");

    const fiftyOne = await run(51);
    expect(p11(fiftyOne.report)).toHaveLength(50);
    expect(p11Text(fiftyOne.report)).toContain(" 1 of them is not listed in the report.");

    const one = await run(1);
    expect(p11(one.report).map((v) => v.path)).toEqual(["gen/f00.ts"]);
    const single = p11Text(one.report);
    expect(single.startsWith("This agent pull request changes 1 path the org policy protects: "), single).toBe(true);
    expect(single).toContain("`gen/f00.ts`");
    expect(single).not.toContain("not listed");
  });
});
