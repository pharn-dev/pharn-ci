import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness } from "./harness.js";

// run() is loaded inside each test body: the AC tests are written before the upload step exists, so nothing the build
// adds may run while this file loads. The Action runs against the in-memory harness plus injected app deps: a fake
// fetch that records every request (URL, method, headers, body, redirect, signal) and answers the app and storage
// calls, a fake getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. The context carries
// the run metadata, so the report has meta. No real network.
//
// The fake token, the signed URL and the canary are assembled at run time, so no complete secret-shaped string is in
// the repository. Every fake response body (success or error) carries the canary.

const APP = "https://pharn.dev";
const TOKEN = ["oidc", "TOK", "Qm7v", "Lr28", "zz"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const SIGNED_HOST = ["bkt-q7z", "blob-store", "example"].join(".");
const SIGNED_PATH = ["", "o", "acme", "zz91-run.tgz"].join("/");
const SIGNED_QUERY = ["X-Sig=Kp4r9Qe1", "X-Exp=1761480000"].join("&");
const SIGNED = `https://${SIGNED_HOST}${SIGNED_PATH}?${SIGNED_QUERY}`;
const CANARY = ["canary", "Zx81", "body"].join("-");
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-10-26T12:15:00Z",
  note: CANARY,
};
const PHRASE = "uploaded to pharn.dev";

const META_CONTEXT = {
  eventName: "pull_request",
  sha: "merge000",
  workflow: "ci",
  job: "check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  payload: {
    repository: { full_name: "acme/widgets", id: 42 },
    pull_request: { number: 7, base: { sha: "a".repeat(40) }, head: { sha: "b".repeat(40) } },
  },
};

type Report = { verdict: string; meta?: Record<string, unknown> };

interface FetchCall {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: unknown;
  redirect: unknown;
  signal: AbortSignal | undefined;
}
type Answer = Error | ((call: FetchCall) => Response | Promise<Response>);
type Kind = "upload-url" | "put" | "runs" | "other";
interface Answers {
  uploadUrl?: readonly Answer[];
  put?: readonly Answer[];
  runs?: readonly Answer[];
}

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

function kindOf(call: FetchCall): Kind {
  if (call.method === "PUT") return "put";
  let url: URL;
  try {
    url = new URL(call.url);
  } catch {
    return "other";
  }
  if (call.method !== "POST" || url.origin !== APP) return "other";
  if (url.pathname === "/api/v1/runs/upload-url") return "upload-url";
  if (url.pathname === "/api/v1/runs") return "runs";
  return "other";
}

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): Answer =>
  () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
/** An error answer whose body carries the canary. */
const fail = (status: number, code: string): Answer => json(status, { code, detail: CANARY });
const bare =
  (status: number, body: string | null = null): Answer =>
  () =>
    new Response(body, { status });
const network = () => new TypeError("fetch failed");

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

/** A fake app and storage: each kind of request gets its own answers in turn (the last one repeats). */
function fakeApp(answers: Answers = {}) {
  const calls: FetchCall[] = [];
  const lists: Record<Exclude<Kind, "other">, readonly Answer[]> = {
    "upload-url": answers.uploadUrl ?? [json(200, UPLOAD_URL_OK)],
    put: answers.put ?? [bare(200, CANARY)],
    runs: answers.runs ?? [json(201, { url: RUN_URL, note: CANARY })],
  };
  const counts = { "upload-url": 0, put: 0, runs: 0 };
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    calls.push(call);
    const kind = kindOf(call);
    if (kind === "other") throw new TypeError("fetch failed");
    counts[kind] += 1;
    const list = lists[kind];
    const answer = list[Math.min(counts[kind], list.length) - 1] as Answer;
    if (answer instanceof Error) throw answer;
    return answer(call);
  };
  return { fetch, calls };
}

interface Case {
  name: string;
  answers?: Answers;
  timeoutMs?: number;
  lsFiles?: string[];
  oidc?: boolean;
}

async function uploadRun(c: Case) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never" },
    context: META_CONTEXT as never,
    ...(c.lsFiles ? { lsFiles: c.lsFiles } : {}),
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(c.answers);
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => {
      tokenCalls.push("token");
      return TOKEN;
    },
    setSecret: () => {},
    hasOidcEnv: c.oidc ?? true,
    now: () => NOW,
    sleep: async () => {},
    ...(c.timeoutMs === undefined ? {} : { timeoutMs: c.timeoutMs }),
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, text, report, calls: app.calls, tokenCalls };
}

type UploadRun = Awaited<ReturnType<typeof uploadRun>>;

const ofKind = (calls: FetchCall[], kind: Kind) => calls.filter((c) => kindOf(c) === kind);

/** Everything the run printed or wrote outside the requests: logs, failures, outputs, report.json, summary, comment. */
const printed = (r: UploadRun) => [
  ...r.h.infos,
  ...r.h.warnings,
  ...r.h.failed,
  ...Object.values(r.h.outputs),
  r.text,
  ...r.h.summary,
  ...r.h.posted,
];

function bytesOf(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error(`the PUT body is not bytes: ${Object.prototype.toString.call(body)}`);
}

const malformedUploadUrl = (patch: Record<string, unknown>): Answer => json(200, { ...UPLOAD_URL_OK, ...patch });

/** The cases of AC-17 to AC-26 that run in an ordinary harness (the over-limit report is added in AC-27). */
const UPLOAD_URL_CASES: Case[] = [
  { name: "ok" },
  { name: "runs 200", answers: { runs: [json(200, { url: RUN_URL, note: CANARY })] } },
  { name: "runs 202", answers: { runs: [json(202, { url: RUN_URL, note: CANARY })] } },
  { name: "upload-url 503 then 200", answers: { uploadUrl: [fail(503, "internal"), json(200, UPLOAD_URL_OK)] } },
  { name: "upload-url 401", answers: { uploadUrl: [fail(401, "token_invalid")] } },
  { name: "upload-url 403", answers: { uploadUrl: [fail(403, "repo_not_in_installation")] } },
  { name: "upload-url 404", answers: { uploadUrl: [fail(404, "not_found")] } },
  { name: "upload-url 413", answers: { uploadUrl: [fail(413, "too_large")] } },
  { name: "upload-url 429", answers: { uploadUrl: [fail(429, "rate_limited")] } },
  { name: "upload-url 503 twice", answers: { uploadUrl: [fail(503, "internal"), fail(503, "internal")] } },
  { name: "upload-url timeout", answers: { uploadUrl: [hang] }, timeoutMs: 30 },
  { name: "upload-url network", answers: { uploadUrl: [network(), network()] } },
  {
    name: "upload-url http: url",
    answers: { uploadUrl: [malformedUploadUrl({ uploadUrl: SIGNED.replace("https:", "http:") })] },
  },
  { name: "upload-url maxBytes 0", answers: { uploadUrl: [malformedUploadUrl({ maxBytes: 0 })] } },
  {
    name: "upload-url text/plain",
    answers: {
      uploadUrl: [
        () => new Response(JSON.stringify(UPLOAD_URL_OK), { status: 200, headers: { "content-type": "text/plain" } }),
      ],
    },
  },
  { name: "upload-url maxBytes 1", answers: { uploadUrl: [malformedUploadUrl({ maxBytes: 1 })] } },
];

/** The PUT and runs failure cases (AC-24, AC-26), which AC-28 runs with the ok case. */
const PUT_AND_RUNS_CASES: Case[] = [
  { name: "PUT 201", answers: { put: [bare(201, CANARY)] } },
  { name: "PUT 204", answers: { put: [bare(204)] } },
  { name: "PUT 403", answers: { put: [bare(403, CANARY)] } },
  { name: "PUT 500", answers: { put: [bare(500, CANARY)] } },
  { name: "PUT timeout", answers: { put: [hang] }, timeoutMs: 30 },
  { name: "PUT network", answers: { put: [network()] } },
  { name: "runs 409", answers: { runs: [fail(409, "pr_head_mismatch")] } },
  { name: "runs 422", answers: { runs: [fail(422, "report_invalid")] } },
  { name: "runs 401", answers: { runs: [fail(401, "token_invalid")] } },
  { name: "runs 403", answers: { runs: [fail(403, "repo_not_in_installation")] } },
  { name: "runs 429", answers: { runs: [fail(429, "rate_limited")] } },
  { name: "runs 502 twice", answers: { runs: [fail(502, "internal"), fail(502, "internal")] } },
  { name: "runs timeout", answers: { runs: [hang] }, timeoutMs: 30 },
  { name: "runs network", answers: { runs: [network(), network()] } },
  {
    name: "runs text/html",
    answers: {
      runs: [
        () =>
          new Response(JSON.stringify({ url: RUN_URL, note: CANARY }), {
            status: 201,
            headers: { "content-type": "text/html" },
          }),
      ],
    },
  },
  { name: "runs http: url", answers: { runs: [json(201, { url: RUN_URL.replace("https:", "http:"), note: CANARY })] } },
  {
    name: "runs other origin",
    answers: { runs: [json(201, { url: "https://evil.example/acme/widgets/runs/9-1", note: CANARY })] },
  },
  {
    name: "runs user name",
    answers: { runs: [json(201, { url: RUN_URL.replace("https://", "https://u@"), note: CANARY })] },
  },
  { name: "runs long url", answers: { runs: [json(201, { url: `${APP}/r/${"a".repeat(2048)}`, note: CANARY })] } },
];

/** One over-limit report (AC-22): tens of thousands of agent setup files make report.json larger than 5242880 bytes. */
function overLimitCase(): Case {
  const segment = "nested-directory-level/".repeat(6);
  return {
    name: "report over the limit",
    lsFiles: [
      ...fixture("golden/files.txt").trim().split("\n"),
      ...Array.from({ length: 26_000 }, (_, i) => `packages/p${String(i).padStart(5, "0")}/${segment}CLAUDE.md`),
    ],
  };
}

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("no secret leaves the upload", { timeout: 300_000 }, () => {
  it("AC-27: the token appears only in the Authorization header of requests to the app origin, never in the PUT, a log line, an output, report.json, the summary or the comment", async () => {
    let authorized = 0;
    for (const c of [...UPLOAD_URL_CASES, ...PUT_AND_RUNS_CASES, overLimitCase()]) {
      const r = await uploadRun(c);
      for (const call of r.calls) {
        const appOrigin = new URL(call.url).origin === APP;
        for (const [name, value] of call.headers) {
          if (name === "authorization" && appOrigin) {
            expect(value, `${c.name}: the app request's Authorization`).toBe(`Bearer ${TOKEN}`);
            authorized += 1;
          } else {
            expect(value.includes(TOKEN), `${c.name}: header ${name} of ${call.method}`).toBe(false);
          }
        }
        expect(call.url.includes(TOKEN), `${c.name}: a request URL`).toBe(false);
        if (kindOf(call) === "put") {
          expect(
            call.headers.some(([name]) => name === "authorization"),
            `${c.name}: the PUT has no Authorization`,
          ).toBe(false);
          expect(gunzipSync(bytesOf(call.body)).toString("latin1").includes(TOKEN), `${c.name}: the PUT body`).toBe(
            false,
          );
        } else if (typeof call.body === "string") {
          expect(call.body.includes(TOKEN), `${c.name}: a request body`).toBe(false);
        }
      }
      for (const text of printed(r)) expect((text ?? "").includes(TOKEN), `${c.name}: printed`).toBe(false);
    }
    expect(authorized, "the app requests carried the token").toBeGreaterThan(0);
  });

  it("AC-28: no part of the signed upload URL appears in any log line, output, report.json, summary, comment or failure message", async () => {
    const parts = [SIGNED, SIGNED_HOST, SIGNED_PATH, SIGNED_QUERY, "X-Sig=Kp4r9Qe1", "zz91-run.tgz"];
    let puts = 0;
    for (const c of [{ name: "ok" }, ...PUT_AND_RUNS_CASES]) {
      const r = await uploadRun(c);
      const sent = ofKind(r.calls, "put");
      expect(sent, `${c.name}: one PUT`).toHaveLength(1);
      expect(sent[0]?.url, `${c.name}: the PUT goes to the signed URL`).toBe(SIGNED);
      puts += sent.length;
      for (const text of printed(r)) {
        for (const part of parts) expect((text ?? "").includes(part), `${c.name}: printed ${part}`).toBe(false);
      }
    }
    expect(puts).toBe(1 + PUT_AND_RUNS_CASES.length);
  });

  it("AC-29: each outcome that reached the token request logs exactly one uploaded-to-pharn.dev line, info for ok and skipped, a warning naming the reason for failed and too_large, and no response body", async () => {
    const cases: Array<Case & { as: "info" | "warning"; reason?: string }> = [
      { name: "ok", as: "info" },
      { name: "no OIDC env", oidc: false, as: "info" },
      { name: "upload-url 404", answers: { uploadUrl: [fail(404, "not_found")] }, as: "info" },
      {
        name: "upload-url 401",
        answers: { uploadUrl: [fail(401, "token_invalid")] },
        as: "warning",
        reason: "upload-url:token_invalid",
      },
      { name: "PUT 403", answers: { put: [bare(403, CANARY)] }, as: "warning", reason: "put:status-403" },
      {
        name: "runs 409",
        answers: { runs: [fail(409, "pr_head_mismatch")] },
        as: "warning",
        reason: "runs:pr_head_mismatch",
      },
      {
        name: "runs malformed",
        answers: { runs: [json(201, { url: "https://evil.example/r", note: CANARY })] },
        as: "warning",
        reason: "runs:malformed",
      },
      { name: "upload-url 413", answers: { uploadUrl: [fail(413, "too_large")] }, as: "warning" },
      { name: "upload-url maxBytes 1", answers: { uploadUrl: [malformedUploadUrl({ maxBytes: 1 })] }, as: "warning" },
    ];
    for (const c of cases) {
      const r = await uploadRun(c);
      const infos = r.h.infos.filter((l) => l.includes(PHRASE));
      const warnings = r.h.warnings.filter((l) => l.includes(PHRASE));
      expect(infos.length + warnings.length, `${c.name}: exactly one line`).toBe(1);
      expect(
        r.h.failed.filter((l) => l.includes(PHRASE)),
        c.name,
      ).toEqual([]);
      if (c.as === "info") {
        expect(infos, c.name).toHaveLength(1);
      } else {
        expect(warnings, c.name).toHaveLength(1);
        expect(warnings[0], c.name).toMatch(/check is not affected/);
      }
      if (c.reason !== undefined) expect(warnings[0], c.name).toContain(c.reason);
      for (const line of [...r.h.infos, ...r.h.warnings, ...r.h.failed]) {
        expect(line.includes(CANARY), `${c.name}: a response body in a log line`).toBe(false);
      }
    }
  });
});
