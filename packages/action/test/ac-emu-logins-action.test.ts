import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// CORE-44 (R1.6): Enterprise Managed User logins (`handle_shortcode`) through the Action. The PR author is read from
// the API with LOGIN_PATTERN, the accept label's actor with GITHUB_LOGIN, agents.extra_logins from an app policy and a
// file: policy, and the repository name the policy request sends may have an EMU owner. run() is loaded inside each
// test body like the other Action tests; fixtures/emu-logins/ holds the policy and the label events.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const GOLDEN_ROOT = "/home/runner/work/demo/demo";
const POLICY_PATH = ".pharn/policy.json";
const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token)
const NOW = new Date("2026-10-26T12:00:00.000Z");

async function realReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

const apiCommit = (login: string) => ({
  sha: "1".repeat(40),
  commit: { message: "Refactor the parser\n" },
  author: { login },
  committer: { login },
});

function prContext(login: string, repository: string) {
  return {
    eventName: "pull_request",
    sha: "merge000",
    workflow: "ci",
    job: "check",
    runId: 9,
    runAttempt: 1,
    actor: login,
    payload: {
      repository: { full_name: repository, id: 42 },
      pull_request: {
        number: 7,
        base: { sha: "a".repeat(40) },
        head: { sha: "b".repeat(40) },
        user: { login, type: "User" },
        labels: [],
        commits: 1,
      },
    },
  };
}

interface PrRunOptions {
  author: string;
  repository?: string;
  inputs: Record<string, string>;
  /** A real workspace for a file: policy; the in-memory one otherwise. */
  workspace?: string;
  /** The body the fake fetch answers with (an app policy envelope). */
  envelope?: unknown;
}

async function prRun(options: PrRunOptions) {
  const { run } = await import("../src/run.js");
  const h = harness({
    context: prContext(options.author, options.repository ?? "acme/widgets") as never,
    // No upload: only the policy request may call the app.
    inputs: { upload: "never", ...options.inputs },
  });
  const fetched: string[] = [];
  h.deps.api = {
    ...h.deps.api,
    async listPullRequestCommits(_pullNumber: number, page: number) {
      return { commits: page === 1 ? [apiCommit(options.author)] : [], hasNext: false };
    },
  } as typeof h.deps.api;
  Object.assign(h.deps, {
    ...(options.workspace === undefined ? {} : { workspace: options.workspace, readFile: realReadFile }),
    fetch: async (input: unknown) => {
      fetched.push(String(input instanceof Request ? input.url : input));
      if (options.envelope === undefined) throw new Error("no fetch was expected");
      return new Response(JSON.stringify(options.envelope), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: options.envelope !== undefined,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, fetched };
}

const ruleIds = (report: Report) => (report.policy?.violations ?? []).map((v) => v.id);
const codes = (report: Report) => report.messages.map((m) => m.code);

/** The human PR by mona-lisa_acme is no agent PR; the same PR by dev_acme, which the policy lists, is one. */
function expectHumanAndAgent(human: Report, agent: Report, label: string) {
  expect(human.meta?.isAgentPr, label).toBe(false);
  expect(human.meta?.prAuthor, label).toEqual({ login: "mona-lisa_acme", type: "User" });
  for (const id of ["P11", "P13", "P14"]) expect(ruleIds(human), `${label} ${id}`).not.toContain(id);
  expect(codes(human), label).not.toContain("AGENT_PR_DETECTION_INCOMPLETE");
  expect(codes(human), label).not.toContain("POLICY_UNAVAILABLE");

  expect(agent.meta?.isAgentPr, label).toBe(true);
  expect(agent.meta?.prAuthor, label).toEqual({ login: "dev_acme", type: "User" });
  expect(ruleIds(agent), label).toContain("P11");
  expect(ruleIds(agent), label).toContain("P14");
}

describe("action: Enterprise Managed User logins", { timeout: 120_000 }, () => {
  it("a file: policy with agents.extra_logins ['dev_acme'] applies; a PR by mona-lisa_acme is not an agent PR, so P11, P13 and P14 do not apply", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-emu-logins-")));
    try {
      mkdirSync(join(dir, "coverage"), { recursive: true });
      writeFileSync(
        join(dir, "coverage/lcov.info"),
        read("fixtures/golden/coverage.info").replaceAll(GOLDEN_ROOT, dir),
      );
      mkdirSync(join(dir, ".pharn"), { recursive: true });
      writeFileSync(join(dir, POLICY_PATH), read("fixtures/emu-logins/policy.json"));
      const inputs = { policy: `file:${POLICY_PATH}` };
      const human = await prRun({ author: "mona-lisa_acme", inputs, workspace: dir });
      const agent = await prRun({ author: "dev_acme", inputs, workspace: dir });
      expectHumanAndAgent(human.report, agent.report, "file:");
      expect(human.fetched).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an app policy with agents.extra_logins ['dev_acme'] applies, fetched for a repository whose owner is an EMU login", async () => {
    const envelope = {
      ...(JSON.parse(read("fixtures/policy-api/envelope-valid.json")) as Record<string, unknown>),
      policy: JSON.parse(read("fixtures/emu-logins/policy.json")),
    };
    const inputs = { policy: "required" };
    const repository = "mona-cat_octo/widgets";
    const human = await prRun({ author: "mona-lisa_acme", repository, inputs, envelope });
    const agent = await prRun({ author: "dev_acme", repository, inputs, envelope });
    expectHumanAndAgent(human.report, agent.report, "app");
    expect(human.fetched).toHaveLength(1);
    expect(new URL(human.fetched[0] as string).searchParams.get("repo")).toBe(repository);
  });

  it("a repository owner that is neither a login nor an EMU login still requests no token: no-repository", async () => {
    const envelope = JSON.parse(read("fixtures/policy-api/envelope-valid.json"));
    for (const repository of [
      "_acme/widgets",
      "mona_ac/widgets",
      "mona_lisa_acme/widgets",
      "mona acme_x/widgets",
      `${"o".repeat(31)}_acmecorp/widgets`,
    ]) {
      const { report, fetched } = await prRun({
        author: "mona-lisa_acme",
        repository,
        inputs: { policy: "required" },
        envelope,
      });
      expect(fetched, repository).toEqual([]);
      const unavailable = report.messages.filter((m) => m.code === "POLICY_UNAVAILABLE");
      expect(
        unavailable.map((m) => m.level),
        repository,
      ).toEqual(["error"]);
      expect(unavailable[0]?.text, repository).toContain("no-repository");
    }
  });

  it("the accept label applied by reviewer_acme, who is not the author mona-lisa_acme, is honoured; applied by the author it is not", async () => {
    const { run } = await import("../src/run.js");
    const LABEL = "pharn/accepted";
    const files = read("fixtures/accept-label/files.txt").trim().split("\n");
    const diff = read("fixtures/accept-label/block.diff");
    const signoff = async (events: unknown) => {
      const h = harness({ inputs: { "test-integrity": "block" }, lsFiles: files, context: PR_CONTEXT });
      const git = h.deps.git;
      h.deps.git = async (args) => (args[0] === "diff" ? diff : git(args));
      h.deps.api = {
        ...h.deps.api,
        compareDiff: async () => diff,
        getPullRequestSignoff: async () => ({
          author: { login: "mona-lisa_acme", type: "User" },
          labels: [{ name: LABEL, color: "0e8a16" }],
          commits: undefined,
        }),
        listIssueEvents: async () => ({ events, hasNext: false }),
      };
      await run(h.deps);
      const report = JSON.parse(h.written[h.outputs["report-path"] ?? ""] as string) as Report;
      expectValidReport(report);
      return { h, report };
    };

    const events = JSON.parse(read("fixtures/emu-logins/events.json")) as unknown[];
    const honoured = await signoff(events);
    expect(honoured.report.testIntegrity.accepted).toEqual({ label: LABEL, by: "reviewer_acme" });
    expect(codes(honoured.report)).toContain("TEST_INTEGRITY_ACCEPTED");
    expect(codes(honoured.report)).not.toContain("TEST_INTEGRITY_ACCEPT_IGNORED");
    expect(honoured.report.verdict).toBe("warn");
    expect(honoured.h.failed).toEqual([]);
    expect(honoured.h.posted.at(-1)).toContain("@reviewer_acme");

    // The author's own EMU login applying the label is still refused.
    const byAuthor = events.map((e) => {
      const event = e as { actor: { login: string } };
      return event.actor.login === "reviewer_acme"
        ? { ...event, actor: { ...event.actor, login: "Mona-Lisa_ACME" } }
        : e;
    });
    const refused = await signoff(byAuthor);
    expect(refused.report.testIntegrity.accepted ?? null).toBeNull();
    const ignored = refused.report.messages.filter((m) => m.code === "TEST_INTEGRITY_ACCEPT_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(refused.h.failed.length).toBeGreaterThan(0);
  });
});
