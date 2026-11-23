import { readFileSync } from "node:fs";
import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// CORE-118 (R5.1): a policy the app serves with keys this build does not know is applied without them, with one
// POLICY_KEYS_UNKNOWN warning, instead of being voided. Each input runs the whole Action through the fetch path with a
// fake fetch, on an agent pull request (its label is the policy's agents.labels) that touches a protected path, and is
// compared with the same run under fixtures/policy-api/newer/baseline.json, the same policy with nothing unknown in it.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const newer = (name: string) => read(`fixtures/policy-api/newer/${name}`);

const REPO = "acme/widgets";
const POLICY_PATH = ".pharn/policy.json";

/** A change adding two covered lines to src/a.ts (a protected path) and two uncovered lines to gen/b.ts (excluded). */
const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "new file mode 100644",
  "index 0000000..1111111",
  "--- /dev/null",
  "+++ b/src/a.ts",
  "@@ -0,0 +1,2 @@",
  "+export const a = 1;",
  "+export const b = 2;",
  "diff --git a/gen/b.ts b/gen/b.ts",
  "new file mode 100644",
  "index 0000000..2222222",
  "--- /dev/null",
  "+++ b/gen/b.ts",
  "@@ -0,0 +1,2 @@",
  "+export const c = 3;",
  "+export const d = 4;",
  "",
].join("\n");
const COVERAGE = "TN:\nSF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record\nTN:\nSF:gen/b.ts\nDA:1,0\nDA:2,0\nend_of_record\n";
const COMMITS = [
  {
    sha: "3".repeat(40),
    commit: { message: "Add a and b\n" },
    author: { login: "octocat" },
    committer: { login: "octocat" },
  },
];

/** The PR context: a person's pull request labelled `agent-pr`, which the policy's agents.labels makes an agent PR. */
const context = () => ({
  ...PR_CONTEXT,
  payload: {
    repository: { full_name: REPO },
    pull_request: {
      ...PR_CONTEXT.payload.pull_request,
      user: { login: "octocat", type: "User" },
      labels: [{ name: "agent-pr" }],
      commits: 1,
    },
  },
});

interface RunOptions {
  /** The body the fake app answers the policy request with (200, JSON); none means no fetch is expected. */
  envelope?: string;
  inputs?: Record<string, string>;
  files?: Record<string, string>;
}

async function actionRun(options: RunOptions) {
  const { run } = await import("../src/run.js");
  const files: Record<string, string> = { [`${WORKSPACE}/coverage/lcov.info`]: COVERAGE };
  for (const [path, text] of Object.entries(options.files ?? {})) files[`${WORKSPACE}/${path}`] = text;
  const h = harness({
    inputs: { threshold: "70", ...options.inputs },
    files,
    context: context() as never,
    lsFiles: ["AGENTS.md", "gen/b.ts", "src/a.ts"],
  });
  const git = h.deps.git;
  h.deps.git = async (args) => (args[0] === "diff" ? DIFF : git(args));
  h.deps.api = {
    ...h.deps.api,
    compareDiff: async () => DIFF,
    async listPullRequestCommits(_pullNumber: number, page: number) {
      return { commits: page === 1 ? COMMITS : [], hasNext: false };
    },
  } as typeof h.deps.api;
  const fetches: string[] = [];
  const envelope = options.envelope;
  Object.assign(h.deps, {
    fetch: async (input: unknown) => {
      fetches.push(String(input instanceof Request ? input.url : input));
      if (envelope === undefined) throw new Error("no fetch was expected");
      return new Response(envelope, { status: 200, headers: { "content-type": "application/json" } });
    },
    getIDToken: async () => "tok-SECRET-123", // gitleaks:allow (a fake OIDC token)
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    sleep: async () => {},
    // The file: policy reader lstats each segment: .pharn is a directory, the policy file a small regular file.
    lstat: async (path: string) => {
      if (path === `${WORKSPACE}/.pharn`) return { kind: "directory", size: 0 };
      const text = files[path];
      return text === undefined ? null : { kind: "file", size: text.length };
    },
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : (JSON.parse(text) as Report);
  if (report !== undefined) expectValidReport(report);
  return { h, report, fetches };
}

function reportOf(r: Awaited<ReturnType<typeof actionRun>>): Report {
  if (r.report === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(r.h.failed)}`);
  return r.report;
}

const unknownMessages = (report: Report) => report.messages.filter((m) => m.code === "POLICY_KEYS_UNKNOWN");
const withoutUnknown = (report: Report) => report.messages.filter((m) => m.code !== "POLICY_KEYS_UNKNOWN");

/** The five inputs of the ticket (and the envelope fixture that used to void the policy), each with what it names. */
const INPUTS: { name: string; envelope: () => string; names: string[] }[] = [
  { name: "1: signals.TI18", envelope: () => newer("signal-ti18.json"), names: ["policy.test_integrity.signals.TI18"] },
  { name: "2: rules.P15", envelope: () => newer("rule-p15.json"), names: ["policy.policy.rules.P15"] },
  { name: "3: a new envelope key", envelope: () => newer("envelope-key.json"), names: ["policyFormat"] },
  // An RFC 3339 time with a numeric offset is valid, not unknown: it is applied with nothing to skip and no warning.
  { name: "4: updatedAt with +00:00", envelope: () => newer("updated-at-offset.json"), names: [] },
  {
    name: "5: a new tool in setup.expect",
    envelope: () => newer("expect-tool.json"),
    names: ["policy.setup.expect[devin]"],
  },
];

describe("a newer policy does not void an older pin (CORE-118)", () => {
  it("the baseline: the served policy raises the threshold and the mode, and protects src/** on an agent PR", async () => {
    const report = reportOf(await actionRun({ envelope: newer("baseline.json") }));
    expect(report.diffCoverage?.threshold).toBe(85);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.source).toBe("policy");
    expect(report.diffCoverage?.excludedFiles ?? []).toContain("gen/b.ts");
    expect(report.policy?.source).toBe("app");
    expect(report.policy?.violations.some((v) => v.id === "P11" && v.path === "src/a.ts")).toBe(true);
    expect(report.messages.some((m) => m.code === "POLICY_P11" && m.level === "error")).toBe(true);
    expect(report.messages.some((m) => m.code === "POLICY_UNAVAILABLE")).toBe(false);
    expect(unknownMessages(report)).toEqual([]);
  });

  for (const input of INPUTS) {
    it(`input ${input.name}: the threshold, the mode and the protected paths stay in force, with ${input.names.length === 0 ? "no" : "exactly one"} warning`, async () => {
      const baseline = reportOf(await actionRun({ envelope: newer("baseline.json") }));
      const r = await actionRun({ envelope: input.envelope() });
      const report = reportOf(r);
      expect(r.fetches).toHaveLength(1);
      expect(report.diffCoverage?.threshold).toBe(85);
      expect(report.testIntegrity.mode).toBe("block");
      expect(report.policy?.source).toBe("app");
      expect(report.policy?.violations).toEqual(baseline.policy?.violations);
      expect(report.policy?.violations.some((v) => v.id === "P11" && v.path === "src/a.ts")).toBe(true);
      expect(report.messages.some((m) => m.code === "POLICY_UNAVAILABLE")).toBe(false);
      // Every other message is the baseline's, in the same order: only the one warning is added.
      expect(withoutUnknown(report)).toEqual(baseline.messages);
      const unknown = unknownMessages(report);
      if (input.names.length === 0) {
        expect(unknown).toEqual([]);
        expect(report.verdict).toBe(baseline.verdict);
        return;
      }
      expect(unknown).toHaveLength(1);
      expect(unknown[0]?.level).toBe("warn");
      for (const name of input.names) expect(unknown[0]?.text).toContain(`\`${name}\``);
      expect(report.verdict).toBe(baseline.verdict);
    });
  }

  it("the envelope fixture that used to void the policy is applied with one warning naming its key", async () => {
    const report = reportOf(await actionRun({ envelope: read("fixtures/policy-api/envelope-unknown-key.json") }));
    expect(report.diffCoverage?.threshold).toBe(85);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.messages.some((m) => m.code === "POLICY_UNAVAILABLE")).toBe(false);
    const unknown = unknownMessages(report);
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.text).toContain("`zzz-unknown`");
  });

  it("control: a known key with a value of the wrong type voids the policy as before, unknown keys or not", async () => {
    const report = reportOf(await actionRun({ envelope: newer("bad-value.json") }));
    const unavailable = report.messages.filter((m) => m.code === "POLICY_UNAVAILABLE");
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.text).toContain("invalid-response");
    expect(unknownMessages(report)).toEqual([]);
    // The run falls back to the workflow inputs: the policy's threshold and mode are not in force.
    expect(report.diffCoverage?.threshold).toBe(70);
    expect(report.testIntegrity.source).not.toBe("policy");
  });

  it("control: a file: policy with an unknown key still fails the step, and nothing is fetched", async () => {
    const r = await actionRun({
      inputs: { policy: `file:${POLICY_PATH}` },
      files: { [POLICY_PATH]: newer("file-policy-ti18.json") },
    });
    expect(r.fetches).toEqual([]);
    expect(r.h.failed).toHaveLength(1);
    expect(r.h.failed[0]).toContain("is not a valid policy document");
    expect(r.h.failed[0]).toContain("/test_integrity/signals/TI18: is not a known key");
    expect(r.report).toBeUndefined();
  });
});
