import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// E3 item 24a part B (P11), AC-19. check(), renderMarkdown() and run() are loaded inside the test body and
// fixtures/policy-rules/p11/sentinel/ is read there too: the AC test is written before the build adds rule P11 and its
// fixtures, so nothing the build adds may run while this file loads. The Action run uses the in-memory harness, a fake
// policy fetch serving the sentinel policy as an app policy, and a fake listPullRequestCommits.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const SENTINELS = ["secret-SENTINEL-glob", "label-SENTINEL", "login-sentinel", "msg-SENTINEL"];
const COMMIT_MESSAGE = "msg-SENTINEL\n\nCo-authored-by: Jane Roe <jane.roe@example.com>\n";
const EVIDENCE_WORDS = "It counts as an agent PR by: a bot author; a known agent as author.";
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -2,0 +3 @@",
  "+x",
  "",
].join("\n");

type Violation = { id: string; severity: string; path: string | null; line: number | null; detail: string };
type Message = { level: string; code: string; text: string };
type Report = Record<string, unknown> & { messages: Message[]; policy?: { violations: Violation[] } };
interface Core {
  check(input: unknown): Report;
  renderMarkdown(report: Report): string;
}

function expectNoSentinel(text: string, label: string) {
  const lower = text.toLowerCase();
  for (const sentinel of SENTINELS) expect(lower.includes(sentinel.toLowerCase()), `${label}: ${sentinel}`).toBe(false);
}

const p11Paths = (report: Report) => (report.policy?.violations ?? []).filter((v) => v.id === "P11").map((v) => v.path);
const p11Text = (report: Report) => report.messages.find((m) => m.code === "POLICY_P11")?.text ?? "";

describe("P11 never echoes a glob, label, login or commit text", { timeout: 120_000 }, () => {
  it("AC-19: through check() and the renderer, and through the Action, the report, markdown, summary and logs hold src/a.ts and the fixed evidence words but none of the policy's globs, labels, logins or the commit message", async () => {
    const document = JSON.parse(read("fixtures/policy-rules/p11/sentinel/policy.json"));
    expect(JSON.stringify(document)).toContain("secret-SENTINEL-glob");

    // check() and renderMarkdown().
    const core = (await import("@pharn-ci/core")) as unknown as Core;
    const report = core.check({
      version: "0.1.0",
      coverage: { text: read("fixtures/golden/coverage.info"), format: "lcov" },
      diff: { text: DIFF },
      repoRoot: "/home/runner/work/demo/demo",
      threshold: null,
      repoFiles: ["AGENTS.md", "src/a.ts"],
      meta: {
        event: "pull_request",
        repository: "acme/widgets",
        prNumber: 7,
        headSha: "b".repeat(40),
        baseSha: "a".repeat(40),
        scope: "ci/check",
        runId: 9,
        runAttempt: 1,
        upload: { status: "skipped" },
      },
      policy: { source: "app", version: 7, fetchedAt: "2026-10-26T12:00:00.000Z", document },
      agentPrFacts: {
        pr: {
          author: { login: "claude[bot]", type: "Bot" },
          labels: [],
          commits: [{ authorLogin: "octocat", committerLogin: "octocat", message: COMMIT_MESSAGE }],
        },
      },
    });
    expectValidReport(report);
    const markdown = core.renderMarkdown(report);
    expect(p11Paths(report)).toEqual(["src/a.ts"]);
    expect(p11Text(report).endsWith(EVIDENCE_WORDS), p11Text(report)).toBe(true);
    expect(markdown).toContain("src/a.ts");
    expectNoSentinel(JSON.stringify(report), "check() report");
    expectNoSentinel(markdown, "markdown");

    // The Action.
    const { run } = await import("../src/run.js");
    const context = {
      ...PR_CONTEXT,
      workflow: "ci",
      job: "check",
      runId: 9,
      runAttempt: 1,
      actor: "octocat",
      payload: {
        repository: { full_name: "acme/widgets", id: 42 },
        pull_request: {
          number: 7,
          base: { sha: "a".repeat(40) },
          head: { sha: "b".repeat(40) },
          user: { login: "claude[bot]", type: "Bot" },
          labels: [],
          commits: 1,
        },
      },
    };
    const h = harness({ context: context as never, inputs: { policy: "auto" } });
    const git = h.deps.git;
    h.deps.git = async (args) => (args[0] === "diff" ? DIFF : git(args));
    h.deps.api = {
      ...h.deps.api,
      compareDiff: async () => DIFF,
      async listPullRequestCommits(_pullNumber: number, page: number) {
        const commits = [
          {
            sha: "1".repeat(40),
            commit: { message: COMMIT_MESSAGE },
            author: { login: "octocat" },
            committer: { login: "octocat" },
          },
        ];
        return { commits: page === 1 ? commits : [], hasNext: false };
      },
    } as typeof h.deps.api;
    const envelope = { ...JSON.parse(read("fixtures/policy-api/envelope-valid.json")), policy: document };
    Object.assign(h.deps, {
      fetch: async () =>
        new Response(JSON.stringify(envelope), { status: 200, headers: { "content-type": "application/json" } }),
      getIDToken: async () => "tok-SECRET-123",
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => new Date("2026-10-26T12:00:00.000Z"),
      sleep: async () => {},
    });
    await run(h.deps);
    const text = h.written[h.outputs["report-path"] ?? ""];
    if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
    const actionReport = JSON.parse(text) as Report;
    expectValidReport(actionReport);
    expect(p11Paths(actionReport)).toEqual(["src/a.ts"]);
    expect(p11Text(actionReport).endsWith(EVIDENCE_WORDS), p11Text(actionReport)).toBe(true);
    const summary = h.summary.join("\n");
    expect(summary).toContain("src/a.ts");

    expectNoSentinel(text, "report.json");
    expectNoSentinel(summary, "job summary");
    expectNoSentinel(h.posted.join("\n"), "PR comment");
    expectNoSentinel(h.infos.join("\n"), "info logs");
    expectNoSentinel(h.warnings.join("\n"), "warnings");
    expectNoSentinel(h.failed.join("\n"), "failure message");
    for (const [name, value] of Object.entries(h.outputs)) expectNoSentinel(value, `output ${name}`);
  });
});
