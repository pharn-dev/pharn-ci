import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { commentScopeLine } from "../src/run.js";
import { BOT, harness } from "./harness.js";

// run() and the fixtures under fixtures/upload/responses/ are loaded inside each test body: the AC tests are written
// before the upload step exists, so nothing the build adds may run while this file loads. The Action runs against the
// in-memory harness plus injected app deps: a fake fetch that records every request (URL, method, headers, body,
// redirect, signal) and answers the app and storage calls, a fake getIDToken and setSecret, the OIDC-env flag, a
// recorded sleep and a fixed clock. The context carries the run metadata, so the report has meta. No real network.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-10-26T12:15:00Z",
};
const MARKER = "<!-- pharn-ci -->";

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
const bare =
  (status: number, body: string | null = null): Answer =>
  () =>
    new Response(body, { status });

/** An answer read from fixtures/upload/responses/<name>: `{ status, headers, body }`. */
function fromFixture(name: string): Answer {
  const f = JSON.parse(read(`fixtures/upload/responses/${name}`)) as {
    status: number;
    headers?: Record<string, string>;
    body: string;
  };
  return () => new Response(f.body, { status: f.status, headers: f.headers ?? {} });
}

/** A fake app and storage: each kind of request gets its own answers in turn (the last one repeats). */
function fakeApp(answers: Answers = {}) {
  const calls: FetchCall[] = [];
  const lists: Record<Exclude<Kind, "other">, readonly Answer[]> = {
    "upload-url": answers.uploadUrl ?? [json(200, UPLOAD_URL_OK)],
    put: answers.put ?? [bare(200)],
    runs: answers.runs ?? [json(201, { url: RUN_URL })],
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

interface UploadRunOptions {
  inputs?: Record<string, string>;
  answers?: Answers;
  existingComments?: Array<Record<string, unknown>>;
}

async function uploadRun(options: UploadRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: META_CONTEXT as never,
    existingComments: options.existingComments as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(options.answers);
  const sleeps: number[] = [];
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls: app.calls, sleeps };
}

const ofKind = (calls: FetchCall[], kind: Kind) => calls.filter((c) => kindOf(c) === kind);
const commentCalls = (apiCalls: string[]) => apiCalls.filter((c) => /^(create|update|delete) /.test(c));

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("a successful upload", { timeout: 60_000 }, () => {
  it("AC-17: three requests in order, meta.upload ok with the run URL, the run-url output, no comment of its own, one hand-off line, the summary, and no failure", async () => {
    const runsAnswer = JSON.parse(read("fixtures/upload/responses/runs-created.json")) as { body: string };
    const runUrl = new URL((JSON.parse(runsAnswer.body) as { url: string }).url).href;
    expect(new URL(runUrl).origin, "control: the fixture's run URL is on the app origin").toBe(APP);

    const own = {
      id: 5,
      body: `${MARKER}\n${commentScopeLine("ci", "check")}\n## ✅ pharn-ci: pass (an earlier run)`,
      user: { login: BOT.login },
      html_url: "https://github.com/acme/widgets/pull/7#issuecomment-5",
    };
    const r = await uploadRun({
      existingComments: [own],
      answers: {
        uploadUrl: [fromFixture("upload-url-ok.json")],
        put: [bare(200)],
        runs: [fromFixture("runs-created.json")],
      },
    });

    expect(r.calls.map(kindOf)).toEqual(["upload-url", "put", "runs"]);
    expect(r.report.meta?.upload).toEqual({ status: "ok", runUrl });
    expect(r.h.outputs["run-url"]).toBe(runUrl);
    expect(commentCalls(r.h.apiCalls)).toEqual([]);
    expect(r.h.posted).toEqual([]);
    expect(r.h.infos.filter((line) => /Pharn GitHub App comments on the pull request/.test(line))).toHaveLength(1);
    expect(r.h.summary).toHaveLength(1);
    expect(r.h.summary[0]?.length ?? 0).toBeGreaterThan(0);
    expect(r.h.failed).toEqual([]);
    expect(r.report.verdict).toBe("pass");
  });

  it("AC-18: a runs answer of 200 (replay) or 202 ends ok, and an upload-url 5xx then 200 retries once after a 1000 ms sleep", async () => {
    for (const status of [200, 202]) {
      const r = await uploadRun({ answers: { runs: [json(status, { url: RUN_URL })] } });
      expect(r.report.meta?.upload, `runs ${status}`).toEqual({ status: "ok", runUrl: RUN_URL });
      expect(r.h.outputs["run-url"], `runs ${status}`).toBe(RUN_URL);
      expect(r.calls.map(kindOf), `runs ${status}`).toEqual(["upload-url", "put", "runs"]);
    }

    for (const status of [500, 502, 503]) {
      const r = await uploadRun({ answers: { uploadUrl: [bare(status), json(200, UPLOAD_URL_OK)] } });
      expect(ofKind(r.calls, "upload-url"), `upload-url ${status} then 200`).toHaveLength(2);
      expect(r.sleeps, `upload-url ${status} then 200`).toEqual([1000]);
      expect(r.calls.map(kindOf)).toEqual(["upload-url", "upload-url", "put", "runs"]);
      expect(r.report.meta?.upload).toEqual({ status: "ok", runUrl: RUN_URL });
      expect(r.h.outputs["run-url"]).toBe(RUN_URL);
    }
  });
});
