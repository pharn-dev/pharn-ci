import { type CheckInput, check } from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Policy rule P14 (agent PR size cap): one check() run with a policy and the facts of a pull request, its report
// validated against schema/report.v2.json. Shared by the ac-p14-* tests.

export type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
export type Message = { level: string; code: string; text: string };
export type Report = {
  verdict: string;
  messages: Message[];
  policy?: { violations: Violation[] };
  meta?: Record<string, unknown>;
};

export const POLICY_PATH = ".pharn/policy.json";

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

const commit = (message: string) => ({ authorLogin: "octocat", committerLogin: "octocat", message });
/** A pull request by a bot account: an agent PR. */
export const AGENT_FACTS = {
  pr: { author: { login: "claude[bot]", type: "Bot" }, labels: [], commits: [commit("Add the feature\n")] },
};
/** A pull request by a person: never subject to P14. */
export const HUMAN_FACTS = {
  pr: { author: { login: "octocat", type: "User" }, labels: [], commits: [commit("Add the feature\n")] },
};

/** A policy document read from fixtures/policy-rules/p14/. */
export const policyFixture = (name: string): Record<string, unknown> =>
  JSON.parse(fixture(`policy-rules/p14/${name}`)) as Record<string, unknown>;

/** An app policy with the given document. */
export const appPolicy = (document: unknown) => ({
  source: "app",
  version: 3,
  fetchedAt: "2026-11-08T12:00:00.000Z",
  document,
});
/** A `file:` policy at POLICY_PATH with the given document. */
export const filePolicy = (document: unknown) => ({ source: "file", version: null, path: POLICY_PATH, document });

export interface P14Run {
  /** A diff under fixtures/policy-rules/p14/, or null for an unavailable diff. */
  diff: string | null;
  /** The resolved policy; absent runs with no policy. */
  policy?: unknown;
  facts?: unknown;
  base?: unknown;
  exclude?: string[];
  configPath?: string;
}

export function runP14(options: P14Run): Report {
  const input = {
    version: "0.1.0",
    coverage: { text: fixture("golden/coverage.info"), format: "lcov" },
    diff:
      options.diff === null
        ? { unavailable: "git diff failed" }
        : { text: fixture(`policy-rules/p14/${options.diff}`) },
    repoRoot: "/home/runner/work/demo/demo",
    threshold: null,
    repoFiles: ["AGENTS.md", POLICY_PATH, "src/a.ts"],
    meta: META,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    agentPrFacts: options.facts ?? AGENT_FACTS,
    ...(options.base === undefined ? {} : { policyFileBase: options.base }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
  } as unknown as CheckInput;
  const report = check(input);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The P14 violations of a report. */
export const p14 = (report: Report): Violation[] => (report.policy?.violations ?? []).filter((v) => v.id === "P14");
/** The POLICY_P14 messages of a report. */
export const p14Messages = (report: Report): Message[] => report.messages.filter((m) => m.code === "POLICY_P14");
