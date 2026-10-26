import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT, WORKSPACE } from "./harness.js";

// run(), fetchPolicy() and the fixtures under fixtures/policy-api/ are loaded inside each test body: the AC tests are
// written before the org policy fetch exists, so nothing the build adds may run while the file loads. The Action runs
// against the in-memory harness plus injected policy deps: a fake fetch that records every call and answers from
// recorded responses, a fake getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. No real
// server, socket or wall-clock budget is used.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const apiFixture = (name: string) => read(`fixtures/policy-api/${name}`);

const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const REPO = "acme/widgets";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const CAP = 1_048_576;
const CHUNK = 64 * 1024;
const BODY_MARKER = "BODY-MARKER-7f3a";

type Message = { level: string; code: string; text: string };
type Report = {
  verdict: string;
  messages: Message[];
  diffCoverage: { threshold: number | null; files: { path: string }[]; excludedFiles?: string[] } | null;
  testIntegrity: { mode: string; source: string };
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  redirect: unknown;
  signal: AbortSignal | undefined;
}
type Answer = Error | ((call: FetchCall) => Response | Promise<Response>);

function recordCall(input: unknown, init: RequestInit | undefined): FetchCall {
  const request = input instanceof Request ? input : undefined;
  return {
    url: request ? request.url : String(input),
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    body: init?.body ?? null,
    redirect: init?.redirect ?? request?.redirect,
    signal: init?.signal ?? request?.signal ?? undefined,
  };
}

/** A fake fetch answering the n-th call with the n-th answer (the last answer repeats). */
function fakeFetch(answers: readonly Answer[]) {
  const calls: FetchCall[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    calls.push(call);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === undefined) throw new Error("the fake fetch has no answer for this call");
    if (answer instanceof Error) throw answer;
    return answer(call);
  };
  return { fetch, calls };
}

/** A fresh response per call; `contentType` defaults to JSON when there is a body. */
const respond =
  (status: number, body: string | null = null, contentType = "application/json"): Answer =>
  () =>
    new Response(body, { status, headers: body === null ? {} : { "content-type": contentType } });

/** A 200 whose body is `chunks` chunks of 64 KiB, counting how many were pulled. */
function streamed(chunks: number, state: { pulled: number }): Answer {
  return () =>
    new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            state.pulled++;
            // A guard, so that a reader that reads to the end of an endless body fails instead of hanging.
            if (state.pulled > 400) {
              controller.error(new Error("the body stream was read far past the cap"));
              return;
            }
            if (state.pulled > chunks) {
              controller.close();
              return;
            }
            controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
          },
        },
        { highWaterMark: 0 },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
}

/** A fetch that never answers, and rejects as fetch does when its abort signal fires. */
const hang: Answer = (call) =>
  new Promise<Response>((_, reject) => {
    const signal = call.signal;
    const guard = setTimeout(() => reject(new Error("the fake fetch was given no abort signal")), 5000);
    const abort = () => {
      clearTimeout(guard);
      reject(signal?.reason ?? new DOMException("This operation was aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });

interface PolicyRunOptions {
  inputs?: Record<string, string>;
  answers?: readonly Answer[];
  /** Workspace-relative path -> text. */
  files?: Record<string, string>;
  timeoutMs?: number;
  /** The change under review: its diff, tracked files and lcov coverage. */
  change?: { diff: string; files: string[]; coverage: string };
}

function policyDeps(h: ReturnType<typeof harness>, answers: readonly Answer[], timeoutMs?: number) {
  const fake = fakeFetch(answers);
  const tokenCalls: unknown[] = [];
  const sleeps: unknown[] = [];
  Object.assign(h.deps, {
    fetch: fake.fetch,
    getIDToken: async (audience?: string) => {
      tokenCalls.push(audience);
      return TOKEN;
    },
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { calls: fake.calls, tokenCalls, sleeps };
}

const prContext = () => ({ ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: REPO } } });

async function policyRun(options: PolicyRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const files: Record<string, string> = {};
  for (const [path, text] of Object.entries(options.files ?? {})) files[`${WORKSPACE}/${path}`] = text;
  if (options.change) files[`${WORKSPACE}/coverage/lcov.info`] = options.change.coverage;
  const h = harness({
    inputs: { threshold: "80", ...options.inputs },
    files,
    context: prContext() as never,
    ...(options.change ? { lsFiles: options.change.files } : {}),
  });
  const change = options.change;
  if (change) {
    const git = h.deps.git;
    h.deps.git = async (args) => (args[0] === "diff" ? change.diff : git(args));
    h.deps.api = { ...h.deps.api, compareDiff: async () => change.diff };
  }
  const recorded = policyDeps(h, options.answers ?? [], options.timeoutMs);
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : (JSON.parse(text) as Report);
  return { h, report, ...recorded };
}

type PolicyRun = Awaited<ReturnType<typeof policyRun>>;

function reportOf(r: PolicyRun): Report {
  if (r.report === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(r.h.failed)}`);
  expectValidReport(r.report);
  return r.report;
}

const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);
const policyCodes = (report: Report) => report.messages.filter((m) => m.code.startsWith("POLICY_"));

/** fetchPolicy() called directly, with the deps a policy run gives run(). */
async function fetchDirect(mode: "auto" | "required", answers: readonly Answer[]) {
  const { fetchPolicy } = await import("../src/policy-fetch.js");
  const h = harness({ context: prContext() as never });
  policyDeps(h, answers);
  return (await fetchPolicy(h.deps as never, { mode, origin: new URL("https://pharn.dev"), repository: REPO })) as {
    source: string;
    version: number | null;
    fetchedAt?: string;
    document: unknown;
    noApp?: boolean;
    unavailable?: unknown;
  };
}

/** A change adding two covered lines to src/a.ts and two uncovered lines to gen/b.ts. */
const SRC_AND_GEN = {
  diff: [
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
  ].join("\n"),
  files: ["AGENTS.md", "gen/b.ts", "src/a.ts"],
  coverage: "TN:\nSF:src/a.ts\nDA:1,1\nDA:2,1\nend_of_record\nTN:\nSF:gen/b.ts\nDA:1,0\nDA:2,0\nend_of_record\n",
};

const CONFIG_75 = { ".pharn/ci.yml": "coverage:\n  threshold: 75\n" };

interface FailureCase {
  name: string;
  answers: () => readonly Answer[];
  reason: string;
  status?: string;
  /** Text of the body that must never reach the message. */
  body?: string;
  timeoutMs?: number;
}

const FAILURES: FailureCase[] = [
  {
    name: "401",
    answers: () => [respond(401, `{"code":"token_invalid","detail":"${BODY_MARKER}"}`)],
    reason: "token_invalid",
    body: BODY_MARKER,
  },
  {
    name: "403",
    answers: () => [respond(403, `{"code":"repo_not_in_installation","detail":"${BODY_MARKER}"}`)],
    reason: "repo_not_in_installation",
    body: BODY_MARKER,
  },
  {
    name: "429",
    answers: () => [respond(429, `{"code":"rate_limited","detail":"${BODY_MARKER}"}`)],
    reason: "rate-limited",
    body: BODY_MARKER,
  },
  { name: "304", answers: () => [respond(304)], reason: "unexpected-status", status: "304" },
  {
    name: "500 twice",
    answers: () => [respond(500, `{"detail":"${BODY_MARKER}"}`), respond(500, `{"detail":"${BODY_MARKER}"}`)],
    reason: "unexpected-status",
    status: "500",
    body: BODY_MARKER,
  },
  {
    name: "418",
    answers: () => [respond(418, `{"detail":"${BODY_MARKER}"}`)],
    reason: "unexpected-status",
    status: "418",
    body: BODY_MARKER,
  },
  { name: "timeout", answers: () => [hang], reason: "timeout", timeoutMs: 30 },
  {
    name: "body over 1 MiB",
    answers: () => [streamed(CAP / CHUNK + 1, { pulled: 0 })],
    reason: "response-too-large",
  },
  {
    name: "text/html",
    answers: () => [respond(200, `<html>${BODY_MARKER}</html>`, "text/html")],
    reason: "invalid-response",
    body: BODY_MARKER,
  },
  {
    name: "not JSON",
    answers: () => [respond(200, `{not json ${BODY_MARKER}`)],
    reason: "invalid-response",
    body: BODY_MARKER,
  },
  {
    name: "unknown key",
    answers: () => [respond(200, apiFixture("envelope-unknown-key.json"))],
    reason: "invalid-response",
  },
  {
    name: "invalid policy",
    answers: () => [respond(200, apiFixture("envelope-invalid-policy.json"))],
    reason: "invalid-response",
  },
];

describe("the org policy fetch outcomes", () => {
  it("AC-2: a served policy raises the threshold and the mode and replaces the exclusions, and the input values it beat are named", async () => {
    const envelope = JSON.parse(apiFixture("envelope-valid.json"));
    const r = await policyRun({
      inputs: { policy: "auto", threshold: "70", exclude: "src/**" },
      answers: [respond(200, apiFixture("envelope-valid.json"))],
      change: SRC_AND_GEN,
    });
    const report = reportOf(r);
    expect(report.diffCoverage?.threshold).toBe(85);
    expect(report.testIntegrity.mode).toBe("block");
    expect(report.testIntegrity.source).toBe("policy");
    const measured = report.diffCoverage?.files.map((f) => f.path) ?? [];
    expect(measured).toContain("src/a.ts");
    expect(measured).not.toContain("gen/b.ts");
    expect(report.diffCoverage?.excludedFiles ?? []).toContain("gen/b.ts");
    expect(report.diffCoverage?.excludedFiles ?? []).not.toContain("src/a.ts");

    const ignored = withCode(report, "POLICY_OVERRIDE_IGNORED");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.text).toContain("coverage.threshold (input) 70 → 85");
    expect(ignored[0]?.text).toContain("coverage.exclude (input)");
    expect(ignored[0]?.text).not.toContain("src/**");

    const policy = await fetchDirect("auto", [respond(200, apiFixture("envelope-valid.json"))]);
    expect(policy.source).toBe("app");
    expect(policy.version).toBe(envelope.version);
    expect(policy.fetchedAt).toBe(NOW.toISOString());
    expect(policy.document).toEqual(envelope.policy);
    expect(policy.unavailable).toBeUndefined();
  });

  it("AC-3: 204 and 404 are silent under auto and equal the policy: never report; under required they are POLICY_UNAVAILABLE errors", async () => {
    const never = reportOf(await policyRun({ inputs: { policy: "never" } }));
    for (const [name, answer, reason] of [
      ["204", respond(204), "no-policy"],
      ["404 installation_not_found", respond(404, apiFixture("installation-not-found.json")), "installation_not_found"],
      ["404 no body", respond(404), "installation_not_found"],
    ] as const) {
      const auto = await policyRun({ inputs: { policy: "auto" }, answers: [answer] });
      expect(auto.calls, name).toHaveLength(1);
      const autoReport = reportOf(auto);
      expect(policyCodes(autoReport), name).toEqual([]);
      expect(autoReport, name).toEqual(never);

      const policy = await fetchDirect("auto", [answer]);
      expect(policy.source, name).toBe("none");
      expect(policy.noApp, name).toBe(true);
      expect(policy.unavailable, name).toBeUndefined();

      const required = reportOf(await policyRun({ inputs: { policy: "required" }, answers: [answer] }));
      const messages = withCode(required, "POLICY_UNAVAILABLE");
      expect(messages, name).toHaveLength(1);
      expect(messages[0]?.level, name).toBe("error");
      expect(messages[0]?.text, name).toContain(reason);
      expect(messages[0]?.text, name).toMatch(/requires a policy/i);
      expect(required.verdict, name).toBe("fail");
    }
  });

  it("AC-4: every failing response under auto is one POLICY_UNAVAILABLE warning, last, and the check runs with the inputs and .pharn/ci.yml", async () => {
    const never = reportOf(await policyRun({ inputs: { policy: "never", threshold: "" }, files: CONFIG_75 }));
    expect(never.diffCoverage?.threshold).toBe(75);
    for (const c of FAILURES) {
      const r = await policyRun({
        inputs: { policy: "auto", threshold: "" },
        files: CONFIG_75,
        answers: c.answers(),
        ...(c.timeoutMs === undefined ? {} : { timeoutMs: c.timeoutMs }),
      });
      const report = reportOf(r);
      const messages = withCode(report, "POLICY_UNAVAILABLE");
      expect(messages, c.name).toHaveLength(1);
      const message = messages[0] as Message;
      expect(message.level, c.name).toBe("warn");
      expect(report.messages.at(-1), c.name).toEqual(message);
      expect(message.text, c.name).toContain(c.reason);
      if (c.status !== undefined) expect(message.text, c.name).toContain(c.status);
      expect(message.text, c.name).toMatch(/workflow inputs/i);
      expect(message.text, c.name).toContain(".pharn/ci.yml");
      expect(message.text, c.name).not.toContain(TOKEN);
      if (c.body !== undefined) expect(message.text, c.name).not.toContain(c.body);
      for (const line of [...r.h.infos, ...r.h.warnings, ...r.h.failed]) {
        expect(line, c.name).not.toContain(TOKEN);
        if (c.body !== undefined) expect(line, c.name).not.toContain(c.body);
      }
      expect(report.diffCoverage?.threshold, c.name).toBe(75);
      // Every other effective setting is the policy: never run's: the reports differ by the one message only.
      expect({ ...report, messages: report.messages.filter((m) => m !== message) }, c.name).toEqual(never);
    }
  });

  it("AC-5: every failing response under required is one POLICY_UNAVAILABLE error naming the same reason, and the verdict fails", async () => {
    for (const c of FAILURES) {
      const r = await policyRun({
        inputs: { policy: "required", threshold: "" },
        files: CONFIG_75,
        answers: c.answers(),
        ...(c.timeoutMs === undefined ? {} : { timeoutMs: c.timeoutMs }),
      });
      const report = reportOf(r);
      const messages = withCode(report, "POLICY_UNAVAILABLE");
      expect(messages, c.name).toHaveLength(1);
      expect(messages[0]?.level, c.name).toBe("error");
      expect(messages[0]?.text, c.name).toContain(c.reason);
      expect(messages[0]?.text, c.name).toMatch(/requires a policy/i);
      expect(report.verdict, c.name).toBe("fail");
    }
  });

  it("AC-6: an endless body is unavailable response-too-large and is not pulled more than one chunk past the 1 MiB cap", async () => {
    const state = { pulled: 0 };
    const r = await policyRun({ inputs: { policy: "auto" }, answers: [streamed(Number.POSITIVE_INFINITY, state)] });
    const messages = withCode(reportOf(r), "POLICY_UNAVAILABLE");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toContain("response-too-large");
    expect(state.pulled).toBeGreaterThan(0);
    expect(state.pulled).toBeLessThanOrEqual(CAP / CHUNK + 1);
  });
});
