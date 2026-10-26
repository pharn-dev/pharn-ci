import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() and the fixtures under fixtures/policy-api/ are loaded inside each test body: the AC tests are written before
// the org policy fetch exists, so nothing the build adds may run while the file loads. The Action runs against the
// in-memory harness plus injected policy deps: a fake fetch that records every call and answers from recorded
// responses, a fake getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. No real server,
// socket or wall-clock budget is used.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const apiFixture = (name: string) => read(`fixtures/policy-api/${name}`);

const TOKEN = "tok-SECRET-123"; // gitleaks:allow (a fake OIDC token the test proves is never printed)
const REPO = "acme/widgets";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const EVIL = "https://evil.example/";

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; diffCoverage: { threshold: number | null } | null } & {
  testIntegrity: { mode: string; source: string };
};

interface FetchCall {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: unknown;
  redirect: unknown;
  signal: AbortSignal | undefined;
}
type Answer = Error | ((call: FetchCall) => Response | Promise<Response>);

const byName = ([a]: [string, string], [b]: [string, string]) => (a < b ? -1 : a > b ? 1 : 0);

function recordCall(input: unknown, init: RequestInit | undefined): FetchCall {
  const request = input instanceof Request ? input : undefined;
  return {
    url: request ? request.url : String(input),
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: [...new Headers(init?.headers ?? request?.headers)].sort(byName),
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

/** A fresh response per call: JSON content type when there is a body. */
const respond =
  (status: number, body: string | null = null, headers: Record<string, string> = {}): Answer =>
  () =>
    new Response(body, {
      status,
      headers: body === null ? headers : { "content-type": "application/json", ...headers },
    });

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

/**
 * A 302 to EVIL: under `redirect: "error"` fetch rejects (a network error); otherwise it follows the redirect, which
 * is recorded as a call to EVIL and answered with a valid envelope.
 */
function redirectToEvil(calls: () => FetchCall[]): Answer {
  return (call) => {
    if (call.redirect === "error")
      return Promise.reject(new TypeError("fetch failed", { cause: "unexpected redirect" }));
    calls().push({ ...call, url: EVIL });
    return new Response(apiFixture("envelope-valid.json"), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

interface PolicyRunOptions {
  inputs?: Record<string, string>;
  answers?: readonly Answer[];
  /** Replaces the fake fetch's answers with a function of its call list (for the redirect case). */
  answersFor?: (calls: () => FetchCall[]) => readonly Answer[];
  timeoutMs?: number;
}

async function policyRun(options: PolicyRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: REPO } } };
  const h = harness({ inputs: { threshold: "80", ...options.inputs }, context: context as never });
  let calls: FetchCall[] = [];
  const answers = options.answersFor ? options.answersFor(() => calls) : (options.answers ?? []);
  const fake = fakeFetch(answers);
  calls = fake.calls;
  const tokenCalls: unknown[] = [];
  const secrets: unknown[] = [];
  const sleeps: unknown[] = [];
  const order: string[] = [];
  Object.assign(h.deps, {
    fetch: (input: unknown, init?: RequestInit) => {
      order.push("fetch");
      return fake.fetch(input, init);
    },
    getIDToken: async (audience?: string) => {
      order.push("token");
      tokenCalls.push(audience);
      return TOKEN;
    },
    setSecret: (secret: string) => {
      order.push("secret");
      secrets.push(secret);
    },
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  const report = text === undefined ? undefined : (JSON.parse(text) as Report);
  return { h, text, report, calls, tokenCalls, secrets, sleeps, order };
}

type PolicyRun = Awaited<ReturnType<typeof policyRun>>;

function reportOf(r: PolicyRun): Report {
  if (r.report === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(r.h.failed)}`);
  expectValidReport(r.report);
  return r.report;
}

const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);
const logLines = (r: PolicyRun) => [...r.h.infos, ...r.h.warnings, ...r.h.failed];

/** The one POLICY_UNAVAILABLE message of a run, asserted to be the only one. */
function unavailable(r: PolicyRun): Message {
  const found = withCode(reportOf(r), "POLICY_UNAVAILABLE");
  expect(found, JSON.stringify(reportOf(r).messages)).toHaveLength(1);
  return found[0] as Message;
}

describe("the org policy request", () => {
  it("AC-1: one GET of https://pharn.dev/api/v1/policy?repo=acme/widgets with exactly three headers, the token masked first and never printed", async () => {
    const r = await policyRun({
      inputs: { policy: "auto" },
      answers: [respond(200, apiFixture("envelope-valid.json"))],
    });

    expect(r.tokenCalls).toEqual(["pharn.dev"]);
    expect(r.secrets).toEqual([TOKEN]);
    expect(r.order.indexOf("secret")).toBeGreaterThanOrEqual(0);
    expect(r.order.indexOf("secret")).toBeLessThan(r.order.indexOf("fetch"));

    expect(r.calls).toHaveLength(1);
    const call = r.calls[0] as FetchCall;
    expect(call.method).toBe("GET");
    const url = new URL(call.url);
    expect(url.origin).toBe("https://pharn.dev");
    expect(url.pathname).toBe("/api/v1/policy");
    expect([...url.searchParams]).toEqual([["repo", REPO]]);
    expect(url.hash).toBe("");
    expect(call.headers).toEqual([
      ["accept", "application/json"],
      ["authorization", `Bearer ${TOKEN}`],
      ["user-agent", `pharn-ci/${VERSION}`],
    ]);
    expect(call.body).toBeNull();
    expect(call.redirect).toBe("error");

    // The policy was applied (the envelope's threshold of 85 over the input's 80), and the token is nowhere.
    const report = reportOf(r);
    expect(report.diffCoverage?.threshold).toBe(85);
    for (const line of logLines(r)) expect(line).not.toContain(TOKEN);
    for (const value of Object.values(r.h.outputs)) expect(value).not.toContain(TOKEN);
    for (const message of report.messages) expect(message.text).not.toContain(TOKEN);
    expect(r.text).not.toContain(TOKEN);
    for (const body of [...r.h.summary, ...r.h.posted]) expect(body).not.toContain(TOKEN);
  });

  it("AC-7: one retry after sleep(1000) on a network error or a 5xx only; 429, 4xx and timeouts are final; a redirect is a network error", async () => {
    const valid = () => respond(200, apiFixture("envelope-valid.json"));
    const network = () => new TypeError("fetch failed");

    for (const [name, answers] of [
      ["500 then 200", [respond(500, '{"code":"internal"}'), valid()]],
      ["reject then 200", [network(), valid()]],
    ] as const) {
      const r = await policyRun({ inputs: { policy: "auto" }, answers });
      expect(r.calls, name).toHaveLength(2);
      expect(r.sleeps, name).toEqual([1000]);
      const report = reportOf(r);
      expect(withCode(report, "POLICY_UNAVAILABLE"), name).toEqual([]);
      expect(report.diffCoverage?.threshold, name).toBe(85);
      expect(report.testIntegrity.mode, name).toBe("block");
      expect(report.testIntegrity.source, name).toBe("policy");
    }

    const twice = await policyRun({ inputs: { policy: "auto" }, answers: [network(), network()] });
    expect(twice.calls).toHaveLength(2);
    expect(unavailable(twice).text).toContain("network");

    for (const [name, answer] of [
      ["429", respond(429, '{"code":"rate_limited"}')],
      ["401", respond(401, '{"code":"token_invalid"}')],
      ["403", respond(403, '{"code":"repo_not_in_installation"}')],
      ["404", respond(404)],
      ["timeout", hang],
    ] as const) {
      const r = await policyRun({ inputs: { policy: "auto" }, answers: [answer], timeoutMs: 30 });
      expect(r.calls, name).toHaveLength(1);
      expect(r.sleeps, name).toEqual([]);
    }

    const redirected = await policyRun({ inputs: { policy: "auto" }, answersFor: (calls) => [redirectToEvil(calls)] });
    expect(unavailable(redirected).text).toContain("network");
    expect(redirected.calls.length).toBeGreaterThan(0);
    for (const call of redirected.calls) expect(new URL(call.url).origin).not.toBe(new URL(EVIL).origin);
    expect(reportOf(redirected).diffCoverage?.threshold).toBe(80);
  });

  it("AC-10: a sanitized x-pharn-request-id is logged once and named in POLICY_UNAVAILABLE; any other value is dropped", async () => {
    const failing = (headers: Record<string, string>) => respond(401, '{"code":"token_invalid"}', headers);
    const baseline = await policyRun({ inputs: { policy: "auto" }, answers: [failing({})] });
    const baselineText = unavailable(baseline).text;

    const id64 = `${"aZ9-".repeat(16)}`;
    expect(id64).toHaveLength(64);
    for (const id of ["req-ABC-123", id64]) {
      const r = await policyRun({ inputs: { policy: "auto" }, answers: [failing({ "x-pharn-request-id": id })] });
      expect(
        r.h.infos.filter((line) => line.includes(id)),
        id,
      ).toHaveLength(1);
      expect(unavailable(r).text, id).toContain(id);
    }

    const id65 = `${id64}x`;
    // A newline cannot be set through Headers, so that response's header lookup is overridden for this one name.
    const newline = (): Answer => (call) => withHeader(failing({})(call) as Response, "x-pharn-request-id", "abc\ndef");
    for (const [id, answer] of [
      [id65, failing({ "x-pharn-request-id": id65 })],
      ["abc\ndef", newline()],
      ["abc%20", failing({ "x-pharn-request-id": "abc%20" })],
      ["", failing({ "x-pharn-request-id": "" })],
    ] as const) {
      const r = await policyRun({ inputs: { policy: "auto" }, answers: [answer] });
      const text = unavailable(r).text;
      // Dropped: the message and the log are those of the same response with no request id at all.
      expect(text, JSON.stringify(id)).toBe(baselineText);
      expect(r.h.infos, JSON.stringify(id)).toEqual(baseline.h.infos);
      if (id !== "") {
        for (const line of logLines(r)) expect(line, JSON.stringify(id)).not.toContain(id);
        for (const message of reportOf(r).messages) expect(message.text, JSON.stringify(id)).not.toContain(id);
      }
    }
  });
});

/** The same response, with `headers.get(name)` (and `has`) answering `value`. */
function withHeader(response: Response, name: string, value: string): Response {
  const real = response.headers;
  const headers = new Proxy(real, {
    get(target, prop) {
      if (prop === "get") return (n: string) => (n.toLowerCase() === name ? value : target.get(n));
      if (prop === "has") return (n: string) => n.toLowerCase() === name || target.has(n);
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return new Proxy(response, {
    get(target, prop) {
      if (prop === "headers") return headers;
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
