import type { Report } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { run } from "../src/run.js";
import { fixture, harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// CORE-122: a job that grants `id-token: write` asked for the org policy. When the runner offers OIDC and the token
// request then throws, times out or returns an empty token, the report says so (`POLICY_UNAVAILABLE`, reason
// `no-oidc-token`): a warning under `auto`, an error under `required`. A runner that offers no OIDC stays silent under
// `auto`, and `never` and `file:` request no token. The message holds no token, no URL and no runner error text; the
// one job-log line names the error class only. The same failed token skips the upload, which stays out of the verdict.
// run() goes through the in-memory harness with a fake getIDToken; the app's answer is fixtures/policy-api/.

const TOKEN = "tok-SECRET-122"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const RUNNER_ERROR = "connect ECONNREFUSED https://pipelines.actions.example/idtoken?audience=pharn.dev";
const NOW = new Date("2026-11-22T12:00:00.000Z");
const POLICY_FILE = ".pharn/policy.json";
/** The harness context plus the run metadata, so the report has meta and the upload reaches its token request. */
const META_CONTEXT = {
  ...PR_CONTEXT,
  workflow: "ci",
  job: "check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets", id: 42 } },
};

/** How the fake getIDToken answers. */
type TokenAnswer = "token" | "throws" | "hangs" | "empty";

interface TokenRunOptions {
  policy: string;
  /** The runner offers OIDC (both request variables are set). */
  oidc: boolean;
  answer?: TokenAnswer;
  /** The `upload` input; the default (`auto`) when absent. */
  upload?: string;
}

async function tokenRun(options: TokenRunOptions) {
  const h = harness({
    inputs: {
      // Below the fixture's diff coverage, so only the policy can make the verdict fail.
      threshold: "50",
      policy: options.policy,
      ...(options.upload === undefined ? {} : { upload: options.upload }),
    },
    context: META_CONTEXT as never,
    files: { [`${WORKSPACE}/${POLICY_FILE}`]: fixture("policy/valid/coverage.json") },
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const fetched: string[] = [];
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: async (input: unknown) => {
      fetched.push(String(input));
      return new Response(fixture("policy-api/envelope-valid.json"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    getIDToken: (audience?: string): Promise<string> => {
      tokenCalls.push(audience);
      const answer = options.answer ?? "token";
      if (answer === "throws") return Promise.reject(new TypeError(RUNNER_ERROR));
      if (answer === "hangs") return new Promise<string>(() => {});
      if (answer === "empty") return Promise.resolve("");
      return Promise.resolve(TOKEN);
    },
    setSecret: () => {},
    hasOidcEnv: options.oidc,
    tokenTimeoutMs: 20,
    now: () => NOW,
    sleep: async () => {},
    lstat: async (path: string) =>
      path.endsWith(".json") ? { kind: "file", size: 200 } : { kind: "directory", size: 0 },
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, fetched, tokenCalls };
}

const unavailable = (report: Report) => report.messages.filter((m) => m.code === "POLICY_UNAVAILABLE");

describe("CORE-122: an offered OIDC token request that fails is reported", () => {
  it("AC-1: OIDC offered, getIDToken throws, policy auto: one POLICY_UNAVAILABLE warning with reason no-oidc-token", async () => {
    const r = await tokenRun({ policy: "auto", oidc: true, answer: "throws" });
    expect(r.tokenCalls).toEqual(["pharn.dev", "pharn.dev"]); // the policy, then the upload
    expect(r.fetched).toEqual([]);
    const messages = unavailable(r.report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toContain("(no-oidc-token)");
    expect(r.report.verdict).not.toBe("fail");
  });

  it("AC-2: OIDC offered, the token request times out (or answers an empty token), policy auto: the same warning", async () => {
    for (const answer of ["hangs", "empty"] as const) {
      const r = await tokenRun({ policy: "auto", oidc: true, answer });
      expect(r.fetched, answer).toEqual([]);
      const messages = unavailable(r.report);
      expect(messages, answer).toHaveLength(1);
      expect(messages[0]?.level, answer).toBe("warn");
      expect(messages[0]?.text, answer).toContain("(no-oidc-token)");
    }
  });

  it("AC-3: OIDC offered and failed, policy required: a POLICY_UNAVAILABLE error and a failing check, as before", async () => {
    for (const answer of ["throws", "hangs", "empty"] as const) {
      const r = await tokenRun({ policy: "required", oidc: true, answer });
      expect(r.fetched, answer).toEqual([]);
      const messages = unavailable(r.report);
      expect(messages, answer).toHaveLength(1);
      expect(messages[0]?.level, answer).toBe("error");
      expect(messages[0]?.text, answer).toContain("(no-oidc-token)");
      expect(r.report.verdict, answer).toBe("fail");
    }
  });

  it("AC-4: OIDC not offered, policy auto: no message, no token request, and the same report as policy never", async () => {
    const never = await tokenRun({ policy: "never", oidc: false });
    const r = await tokenRun({ policy: "auto", oidc: false });
    expect(r.tokenCalls).toEqual([]);
    expect(r.fetched).toEqual([]);
    expect(unavailable(r.report)).toEqual([]);
    expect(r.report).toEqual(never.report);
    expect(r.h.infos.filter((line) => line.includes("id-token: write"))).toHaveLength(1);
  });

  it("AC-5: policy never and policy file:<path> request no token, even with OIDC offered", async () => {
    for (const policy of ["never", `file:${POLICY_FILE}`]) {
      // upload: never, so any token request would be the policy's own.
      const r = await tokenRun({ policy, oidc: true, answer: "throws", upload: "never" });
      expect(r.tokenCalls, policy).toEqual([]);
      expect(r.fetched, policy).toEqual([]);
      expect(unavailable(r.report), policy).toEqual([]);
      // With the upload on, only the upload asks (once), and a failure of it is still no policy message.
      const withUpload = await tokenRun({ policy, oidc: true, answer: "throws" });
      expect(withUpload.tokenCalls, policy).toEqual(["pharn.dev"]);
      expect(unavailable(withUpload.report), policy).toEqual([]);
    }
  });

  it("AC-6: the message and the log hold no token, no URL and no runner error text; the log line names the error class", async () => {
    for (const policy of ["auto", "required"]) {
      const r = await tokenRun({ policy, oidc: true, answer: "throws" });
      const [message] = unavailable(r.report);
      expect(message, policy).toBeDefined();
      for (const forbidden of [TOKEN, RUNNER_ERROR, "ECONNREFUSED", "https://", "pipelines.actions", "audience="]) {
        expect(message?.text, policy).not.toContain(forbidden);
      }
      const log = [...r.h.infos, ...r.h.warnings, ...r.h.failed];
      for (const line of log) {
        expect(line, policy).not.toContain(RUNNER_ERROR);
        expect(line, policy).not.toContain("ECONNREFUSED");
        expect(line, policy).not.toContain(TOKEN);
      }
      const failedLine = r.h.infos.filter((line) => line.includes("OIDC token request for the org policy failed"));
      expect(failedLine, policy).toEqual([
        "pharn-ci: the job grants `id-token: write`, but the OIDC token request for the org policy failed (TypeError)",
      ]);
    }
  });

  it("AC-7: the failed token also skips the upload, silently in the verdict: one info line, no warning, meta.upload skipped", async () => {
    const r = await tokenRun({ policy: "auto", oidc: true, answer: "throws" });
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });
    expect(r.h.infos.filter((line) => line.includes("not uploaded to pharn.dev"))).toHaveLength(1);
    expect(r.h.warnings.filter((line) => line.includes("upload"))).toEqual([]);
    expect(r.report.messages.filter((m) => m.code.startsWith("UPLOAD_"))).toEqual([]);
  });
});
