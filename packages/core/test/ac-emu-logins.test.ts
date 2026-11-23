import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { GITHUB_LOGIN } from "../src/acceptLabel.js";
import { agentPrMetaFields } from "../src/agents.js";
import { decideAcceptLabel, detectAgentPr, LOGIN_PATTERN, validatePolicyResponse } from "../src/index.js";
import { POLICY_PATTERNS } from "../src/policy/grammar.js";
import { validatePolicy } from "../src/policy/validate.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { check } from "./text-coverage.js";

// CORE-44 (R1.6): Enterprise Managed User logins (`handle_shortcode`) are valid logins. The table in
// fixtures/emu-logins/logins.json is run through every place that reads a login: the PR author (LOGIN_PATTERN and the
// report meta), the accept label's actor (GITHUB_LOGIN and decideAcceptLabel), and agents.extra_logins (the policy
// grammar, validatePolicy, the app's envelope and schema/policy.v1.json).

type Case = { name: string; login: string; user: boolean; author: boolean };
type Violation = { id: string };
type Report = {
  verdict: string;
  messages: Array<{ code: string }>;
  meta?: Record<string, unknown>;
  policy?: { violations: Violation[] };
};

const CASES = (JSON.parse(fixture("emu-logins/logins.json")) as { cases: Case[] }).cases;
const POLICY = JSON.parse(fixture("emu-logins/policy.json")) as Record<string, unknown>;
const SCHEMA = JSON.parse(readFileSync(new URL("../../../schema/policy.v1.json", import.meta.url), "utf8")) as object;
const validateSchema = new Ajv2020({ strict: true, allErrors: true }).compile(SCHEMA);
const POLICY_LOGIN = new RegExp(POLICY_PATTERNS.LOGIN, "u");

const LABEL = "pharn/accepted";
const labeled = (login: string) => [
  { event: "labeled", actor: { login, type: "User" }, label: { name: LABEL }, created_at: "2026-10-20T10:00:00Z" },
];
const extraLogins = (login: string) => ({ version: 1, agents: { extra_logins: [login] } });

const META = {
  event: "pull_request",
  repository: "acme/widgets",
  repositoryId: 123,
  prNumber: 68,
  headSha: "b".repeat(40),
  baseSha: "a".repeat(40),
  scope: "ci/check",
  runId: 9,
  runAttempt: 1,
  actor: "mona-lisa_acme",
  upload: { status: "skipped" },
};
const prBy = (login: string) => ({
  pr: {
    author: { login, type: "User" },
    labels: [],
    commits: [{ authorLogin: login, committerLogin: login, message: "Refactor the parser\n" }],
  },
});
const app = { source: "app", version: 3, fetchedAt: "2026-10-26T12:00:00.000Z", document: POLICY };
const file = { source: "file", version: null, path: ".pharn/policy.json", document: POLICY };

function run(policy: unknown, agentPrFacts: unknown): Report {
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff: { text: fixture("golden/pr.diff") },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    meta: META,
    policy,
    agentPrFacts,
  } as never);
  expectValidReport(report);
  return report as unknown as Report;
}

const ruleIds = (report: Report) => (report.policy?.violations ?? []).map((v) => v.id);

describe("CORE-44: Enterprise Managed User logins", () => {
  it("the table covers an EMU login, a plain login, a bot login and the three invalid kinds", () => {
    const names = CASES.map((c) => c.login);
    for (const login of ["mona-lisa_acme", "name_shortcd", "octocat", "dependabot[bot]"]) {
      expect(CASES.find((c) => c.login === login)?.author, login).toBe(true);
    }
    expect(names).toContain("name_shortcode");
    expect(CASES.some((c) => c.login.includes(" ") && !c.author)).toBe(true);
    expect(CASES.some((c) => c.login.includes("/") && !c.author)).toBe(true);
    expect(CASES.some((c) => [...c.login].some((ch) => ch.charCodeAt(0) < 0x20) && !c.author)).toBe(true);
    // A user login is always an author login; only an App's [bot] login is an author login and not a user login.
    for (const c of CASES) if (c.user) expect(c.author, c.name).toBe(true);
    for (const c of CASES) if (c.author && !c.user) expect(c.login.endsWith("[bot]"), c.name).toBe(true);
  });

  it("the author pattern, the user pattern, the policy grammar and the schema agree with the table", () => {
    for (const c of CASES) {
      expect(LOGIN_PATTERN.test(c.login), `LOGIN_PATTERN: ${c.name}`).toBe(c.author);
      expect(POLICY_LOGIN.test(c.login), `POLICY_PATTERNS.LOGIN: ${c.name}`).toBe(c.author);
      expect(GITHUB_LOGIN.test(c.login), `GITHUB_LOGIN: ${c.name}`).toBe(c.user);
      expect(validateSchema(extraLogins(c.login)), `schema: ${c.name}`).toBe(c.author);
      expect(validatePolicy(extraLogins(c.login)).ok, `validatePolicy: ${c.name}`).toBe(c.author);
    }
  });

  it("PR author: the report meta keeps exactly the valid author logins", () => {
    for (const c of CASES) {
      const facts = { pr: { author: { login: c.login, type: "User" }, labels: [], commits: [] } };
      const fields = agentPrMetaFields(detectAgentPr(facts as never), facts as never);
      expect(fields.prAuthor ?? null, c.name).toEqual(c.author ? { login: c.login, type: "User" } : null);
    }
  });

  it("label actor: the accept label applied by a user who is not the author is honoured exactly for the user logins", () => {
    for (const c of CASES) {
      const decision = decideAcceptLabel({ label: LABEL, authorLogin: "mona-lisa_acme", events: labeled(c.login) });
      if (c.login === "mona-lisa_acme") {
        expect(decision, c.name).toEqual({ honoured: false, reason: "author" });
      } else if (c.user) {
        expect(decision, c.name).toEqual({ honoured: true, by: c.login });
      } else {
        expect(decision, c.name).toEqual({ honoured: false, reason: "unreadable" });
      }
    }
    // The author check compares EMU logins case-insensitively too.
    expect(decideAcceptLabel({ label: LABEL, authorLogin: "Reviewer_ACME", events: labeled("reviewer_acme") })).toEqual(
      { honoured: false, reason: "author" },
    );
  });

  it("agents.extra_logins: ['dev_acme'] validates in a policy file, in the app's envelope and against the schema", () => {
    const document = extraLogins("dev_acme");
    expect(validatePolicy(document)).toEqual({ ok: true, policy: document });
    expect(validateSchema(document), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validatePolicy(POLICY).ok).toBe(true);
    expect(validateSchema(POLICY)).toBe(true);

    const envelope = JSON.parse(fixture("policy-response/valid.json")) as Record<string, unknown>;
    const accepted = validatePolicyResponse({ ...envelope, policy: POLICY });
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    if (accepted.ok) expect(accepted.response.policy).toEqual(POLICY);
  });

  it("a PR by mona-lisa_acme is not an agent PR, so P11 and P14 do not apply to it; dev_acme from the policy makes one", () => {
    for (const [source, policy] of [
      ["app", app],
      ["file", file],
    ] as const) {
      const human = run(policy, prBy("mona-lisa_acme"));
      expect(human.meta?.isAgentPr, source).toBe(false);
      expect(human.meta?.prAuthor, source).toEqual({ login: "mona-lisa_acme", type: "User" });
      const humanRules = ruleIds(human);
      for (const id of ["P11", "P13", "P14"]) expect(humanRules, `${source} ${id}`).not.toContain(id);
      expect(human.messages.map((m) => m.code)).not.toContain("AGENT_PR_DETECTION_INCOMPLETE");

      // The same pull request by the login the policy lists is an agent PR, and the agent rules apply.
      const agent = run(policy, prBy("dev_acme"));
      expect(agent.meta?.isAgentPr, source).toBe(true);
      expect(agent.meta?.prAuthor, source).toEqual({ login: "dev_acme", type: "User" });
      const agentRules = ruleIds(agent);
      expect(agentRules, source).toContain("P11");
      expect(agentRules, source).toContain("P14");
    }
  });
});
