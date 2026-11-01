import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

// E3 item 24a part B (P11), AC-12. detectAgentPr() and check() are loaded inside the test body: the AC test is written
// before the build adds the listsIncomplete fact and the policy lists, so nothing the build adds may run while this
// file loads. The inputs are generated from a fixed seed, so every run checks the same cases. Part A's monotone test
// (ac-agentpr-monotone.test.ts) is a separate file and stays as it is.

type Commit = { authorLogin: string | null; committerLogin: string | null; message: string };
type Pr = {
  author: { login: string; type: string } | null;
  labels: string[];
  commits: Commit[] | null;
  commitsIncomplete?: boolean;
};
type Facts = { pr: Pr | null; labels?: string[]; extraLogins?: string[]; listsIncomplete?: boolean };
type Detection = { isAgentPr: boolean; evidence: string[]; incomplete: string | null };
type Report = { meta?: Record<string, unknown> };

interface Core {
  detectAgentPr(facts: Facts): Detection;
  check(input: unknown): Report;
}

const SEED = 0x24ab_0011;
const CASES = 400;
const CHECK_CASES = 60;

/** mulberry32: a small deterministic generator. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const chance = (p: number) => next() < p;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
  const subset = <T>(xs: readonly T[]): T[] => xs.filter(() => chance(0.4));
  return { next, chance, pick, subset };
}

const AUTHORS = [
  { login: "octocat", type: "User" },
  { login: "someone", type: "User" },
  { login: "acme-agent", type: "User" },
  { login: "Acme-Agent", type: "User" },
  { login: "claude[bot]", type: "Bot" },
  { login: "renovate[bot]", type: "User" },
  { login: "cursoragent", type: "User" },
];
const LOGINS = ["octocat", "someone", "acme-agent", "claude[bot]", "github-actions[bot]", null];
const MESSAGES = [
  "Fix the parser\n",
  "Add retry\n\nCo-authored-by: Claude <noreply@anthropic.com>\n",
  "Refactor\n\nCo-authored-by: Jane Roe <jane.roe@example.com>\n",
  "Data\n\nCo-authored-by: Acme <12345+acme-agent@users.noreply.github.com>\n",
];
const PR_LABELS = ["bug", "ai-generated", "Bot-PR", "agent", "needs-review", "other"];
const LIST_LABELS = ["bot-pr", "other", "needs-review", "release"];
const LIST_LOGINS = ["acme-agent", "someone", "octocat-bot"];

type Gen = ReturnType<typeof generator>;

function genFacts(g: Gen): Facts {
  if (g.chance(0.1)) return { pr: null, ...(g.chance(0.5) ? { labels: g.subset(LIST_LABELS) } : {}) };
  const commits: Commit[] | null = g.chance(0.12)
    ? null
    : Array.from({ length: Math.floor(g.next() * 4) }, () => ({
        authorLogin: g.pick(LOGINS),
        committerLogin: g.pick(LOGINS),
        message: g.pick(MESSAGES),
      }));
  const pr: Pr = {
    author: g.chance(0.1) ? null : g.pick(AUTHORS),
    labels: g.subset(PR_LABELS),
    commits,
    ...(g.chance(0.1) ? { commitsIncomplete: true } : {}),
  };
  return {
    pr,
    ...(g.chance(0.5) ? { labels: g.subset(LIST_LABELS) } : {}),
    ...(g.chance(0.5) ? { extraLogins: g.subset(LIST_LOGINS) } : {}),
  };
}

/** The additions a policy can make: more labels, more logins, the lists-incomplete fact. */
function genAdditions(g: Gen, facts: Facts): Facts[] {
  const labels = [...(facts.labels ?? []), ...g.subset(LIST_LABELS)];
  const extraLogins = [...(facts.extraLogins ?? []), ...g.subset(LIST_LOGINS)];
  return [
    { ...facts, labels },
    { ...facts, extraLogins },
    { ...facts, listsIncomplete: true },
    { ...facts, labels, extraLogins, listsIncomplete: g.chance(0.5) },
  ];
}

/** The incomplete reason detection must give for a PR with listsIncomplete true, by the fixed precedence. */
function expectedIncomplete(pr: Pr): string {
  if (pr.author === null) return "author-unknown";
  if (pr.commits === null) return "commits-unreadable";
  if (pr.commitsIncomplete === true) return "commits-truncated";
  return "policy-lists-unreadable";
}

const POLICY_PATH = ".pharn/policy.json";
const modification = (path: string) =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -2,0 +3 @@",
    "+x",
  ].join("\n");
const META = {
  event: "pull_request",
  repository: "pharn-dev/pharn-ci",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  upload: { status: "skipped" },
};

function genAgents(g: Gen): Record<string, unknown> {
  return {
    ...(g.chance(0.7) ? { labels: g.subset(LIST_LABELS) } : {}),
    ...(g.chance(0.7) ? { extra_logins: g.subset(LIST_LOGINS) } : {}),
    ...(g.chance(0.7) ? { protected_paths: g.chance(0.5) ? ["src/**"] : [] } : {}),
  };
}

/** A generated policy and base: app or file, with lists, and for a file a base document, absent, unreadable or none. */
function genPolicy(g: Gen): { policy: unknown; policyFileBase?: unknown; editsPolicy: boolean } {
  const document = { version: 1, agents: genAgents(g) };
  if (g.chance(0.5)) {
    return {
      policy: { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document },
      editsPolicy: false,
    };
  }
  const bases = [
    { kind: "document", document: { version: 1, agents: genAgents(g) } },
    { kind: "absent" },
    { kind: "unreadable" },
    undefined,
  ];
  const base = g.pick(bases);
  return {
    policy: { source: "file", version: null, path: POLICY_PATH, document },
    ...(base === undefined ? {} : { policyFileBase: base }),
    editsPolicy: g.chance(0.5),
  };
}

describe("agent PR detection with the policy lists: evidence only adds", { timeout: 120_000 }, () => {
  it("AC-12: over seeded generated facts, lists, bases and listsIncomplete, no addition turns an agent PR into a human one; listsIncomplete gives policy-lists-unreadable after the three earlier reasons and is ignored without a PR; check() with a policy and base never clears an agent flag", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const g = generator(SEED);

    let agentCases = 0;
    for (let i = 0; i < CASES; i++) {
      const facts = genFacts(g);
      const original = core.detectAgentPr(facts);
      if (original.isAgentPr) agentCases++;
      for (const added of genAdditions(g, facts)) {
        const result = core.detectAgentPr(added);
        if (original.isAgentPr) expect(result.isAgentPr, `case ${i}: ${JSON.stringify(added)}`).toBe(true);
      }

      const incomplete = core.detectAgentPr({ ...facts, listsIncomplete: true });
      if (facts.pr === null) {
        expect(incomplete.isAgentPr, `case ${i}: pr null`).toBe(false);
        expect(incomplete.incomplete, `case ${i}: pr null`).toBeNull();
      } else {
        expect(incomplete.isAgentPr, `case ${i}: listsIncomplete`).toBe(true);
        expect(incomplete.incomplete, `case ${i}: listsIncomplete ${JSON.stringify(facts)}`).toBe(
          expectedIncomplete(facts.pr),
        );
      }
    }
    expect(agentCases, "the generator yields agent PRs").toBeGreaterThan(CASES / 10);
    expect(agentCases, "the generator yields human PRs").toBeLessThan(CASES - CASES / 10);

    const coverage = fixture("golden/coverage.info");
    for (let i = 0; i < CHECK_CASES; i++) {
      let facts = genFacts(g);
      while (facts.pr === null) facts = genFacts(g);
      const generated = genPolicy(g);
      const diffPaths = generated.editsPolicy ? [POLICY_PATH, "src/a.ts"] : ["src/a.ts"];
      const input = {
        version: "0.1.0",
        coverage: { text: coverage, format: "lcov" },
        diff: { text: `${diffPaths.map(modification).join("\n")}\n` },
        repoRoot: "/home/runner/work/demo/demo",
        threshold: null,
        repoFiles: ["AGENTS.md", POLICY_PATH, "src/a.ts"],
        meta: META,
        agentPrFacts: facts,
      };
      const without = core.check(input);
      expect(without.meta?.isAgentPr, `check case ${i}: without a policy`).toBe(core.detectAgentPr(facts).isAgentPr);
      const withPolicy = core.check({
        ...input,
        policy: generated.policy,
        ...(generated.policyFileBase === undefined ? {} : { policyFileBase: generated.policyFileBase }),
      });
      if (without.meta?.isAgentPr === true) {
        expect(withPolicy.meta?.isAgentPr, `check case ${i}: ${JSON.stringify(generated)}`).toBe(true);
      }
    }
  });
});
