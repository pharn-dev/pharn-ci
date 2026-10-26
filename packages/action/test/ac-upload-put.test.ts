import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// run(), runUpload() and the core bundle functions are loaded inside each test body: the AC tests are written before
// the upload step exists, so nothing the build adds may run while this file loads. The Action runs against the
// in-memory harness plus injected app deps: a fake fetch that records every request (URL, method, headers, body,
// redirect, signal) and answers the app and storage calls, a fake getIDToken and a recorded setSecret, the OIDC-env
// flag, a recorded sleep and a fixed clock. The context carries the run metadata, so the report has meta. The PUT body
// is gunzipped with node:zlib and read with this file's own tar reader.

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
interface Outcome {
  status: string;
  reason?: string;
  maxBytes?: number | null;
  runUrl?: string;
}

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

async function uploadRun(answers: Answers = {}, inputs: Record<string, string> = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "50", policy: "never", ...inputs }, context: META_CONTEXT as never });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(answers);
  const order: string[] = [];
  Object.assign(h.deps, {
    fetch: (input: unknown, init?: RequestInit) => {
      order.push(`fetch ${kindOf(recordCall(input, init))}`);
      return app.fetch(input, init);
    },
    getIDToken: async () => TOKEN,
    setSecret: (secret: string) => {
      order.push(secret === SIGNED ? "secret upload-url" : "secret other");
    },
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls: app.calls, order };
}

let cachedReport: Promise<Report> | undefined;
/** report.json of the same run with the upload off: the report runUpload is given directly. */
function metaReport(): Promise<Report> {
  cachedReport ??= uploadRun({}, { upload: "never" }).then((r) => r.report);
  return cachedReport;
}

async function directUpload(answers: Answers, options: { timeoutMs?: number } = {}) {
  const { runUpload } = (await import("../src/upload.js")) as unknown as {
    runUpload(deps: unknown, input: unknown): Promise<Outcome>;
  };
  const report = await metaReport();
  const app = fakeApp(answers);
  const deps = {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
    info: () => {},
    warning: () => {},
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const outcome = await runUpload(deps, { choice: "auto", report, appOrigin: new URL(APP) });
  return { outcome, calls: app.calls };
}

const label = (o: Outcome) =>
  o.status === "ok" ? "ok" : o.status === "too_large" ? `too_large/${String(o.maxBytes)}` : `${o.status}/${o.reason}`;
const ofKind = (calls: FetchCall[], kind: Kind) => calls.filter((c) => kindOf(c) === kind);

function bytesOf(body: unknown): Uint8Array {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new Error(`the PUT body is not bytes: ${Object.prototype.toString.call(body)}`);
}

/** The entries of a ustar archive: name and UTF-8 contents, in order, up to the first zero block. */
function untar(bytes: Uint8Array): Array<{ name: string; text: string }> {
  const entries: Array<{ name: string; text: string }> = [];
  let at = 0;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = Buffer.from(header.subarray(0, 100)).toString("latin1").replace(/\0+$/, "");
    const size = Number.parseInt(Buffer.from(header.subarray(124, 135)).toString("latin1"), 8);
    entries.push({ name, text: Buffer.from(bytes.subarray(at + 512, at + 512 + size)).toString("utf8") });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

interface BundleCore {
  buildUploadMeta(report: unknown, extra: { version: string; createdAt: string; commentUrl: string | null }): unknown;
  buildUploadBundle(report: unknown, meta: unknown): { reportJson: string; metaJson: string };
}

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the signed PUT", { timeout: 60_000 }, () => {
  it("AC-23: the PUT goes to the served URL with exactly two headers, no redirect, a signal, the URL masked first, sizes matching its body, and a gzip tar of report.json then meta.json", async () => {
    const r = await uploadRun({});
    const puts = ofKind(r.calls, "put");
    expect(puts).toHaveLength(1);
    const put = puts[0] as FetchCall;
    expect(put.url).toBe(SIGNED);
    expect(put.method).toBe("PUT");
    expect(put.headers).toEqual([
      ["content-type", "application/gzip"],
      ["user-agent", `pharn-ci/${VERSION}`],
    ]);
    expect(put.redirect).toBe("error");
    expect(put.signal).toBeInstanceOf(AbortSignal);

    expect(r.order).toContain("secret upload-url");
    expect(r.order.indexOf("secret upload-url")).toBeLessThan(r.order.indexOf("fetch put"));

    const body = bytesOf(put.body);
    const uploadUrl = ofKind(r.calls, "upload-url")[0] as FetchCall;
    expect(typeof uploadUrl.body).toBe("string");
    expect((JSON.parse(uploadUrl.body as string) as { sizes: unknown }).sizes).toEqual({
      report: body.byteLength,
      junit: 0,
    });

    const entries = untar(gunzipSync(body));
    expect(entries.map((e) => e.name)).toEqual(["report.json", "meta.json"]);

    // The bundle texts of this run's report: the written report.json carries the same report with meta.upload ok.
    const { buildUploadBundle, buildUploadMeta } = (await import("@pharn-ci/core")) as unknown as BundleCore;
    const meta = buildUploadMeta(r.report, { version: VERSION, createdAt: NOW.toISOString(), commentUrl: null });
    const bundle = buildUploadBundle(r.report, meta);
    expect(entries[0]?.text).toBe(bundle.reportJson);
    expect(entries[1]?.text).toBe(bundle.metaJson);
  });

  it("AC-24: a PUT answer of 200, 201 or 204 goes on to the runs request; 403, 500, a timeout and a network error end the upload after exactly one PUT", async () => {
    for (const status of [200, 201, 204]) {
      const direct = await directUpload({ put: [bare(status)] });
      expect(label(direct.outcome), `PUT ${status}`).toBe("ok");
      expect(ofKind(direct.calls, "put"), `PUT ${status}`).toHaveLength(1);
      expect(ofKind(direct.calls, "runs"), `PUT ${status}`).toHaveLength(1);
    }
    for (const [name, answer, expected] of [
      ["403", bare(403, "denied"), "failed/put:status-403"],
      ["500", bare(500, "oops"), "failed/put:status-500"],
      ["timeout", hang, "failed/put:timeout"],
      ["network", network(), "failed/put:network"],
    ] as const) {
      const direct = await directUpload({ put: [answer, bare(200)] }, { timeoutMs: 30 });
      expect(label(direct.outcome), name).toBe(expected);
      expect(ofKind(direct.calls, "put"), `${name}: exactly one PUT`).toHaveLength(1);
      expect(ofKind(direct.calls, "runs"), `${name}: no runs request`).toEqual([]);
    }
  });
});
