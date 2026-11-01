import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness } from "./harness.js";

// run() and runUpload() are loaded inside each test body: the AC tests are written before the upload step exists, so
// nothing the build adds may run while this file loads. The Action runs against the in-memory harness plus injected
// app deps: a fake fetch that records every request and answers the app and storage calls, a fake getIDToken and
// setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. The contexts carry the run metadata, so the report
// has meta. No real network.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const OBJECT_KEY = "runs/acme/widgets/9-1.tar.gz";
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: OBJECT_KEY,
  maxBytes: 10_485_760,
  expiresAt: "2026-10-26T12:15:00Z",
};
const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";
const BASE_SHA = "1111111111111111111111111111111111111111";
const HEAD_SHA = "2222222222222222222222222222222222222222";

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

/** PR-number mode: a workflow_run event with no pull_request payload; the pr-number input names PR 42. */
const WORKFLOW_RUN_CONTEXT = {
  eventName: "workflow_run",
  sha: "4444444444444444444444444444444444444444",
  ref: "refs/heads/main",
  workflow: "ci",
  job: "check",
  runId: 11,
  runAttempt: 2,
  repo: { owner: "acme", repo: "widgets" },
  issue: { owner: "acme", repo: "widgets" },
  payload: {
    repository: { full_name: "acme/widgets", id: 42 },
    workflow_run: { id: 99, event: "pull_request", head_sha: HEAD_SHA },
  },
};

const PR_NUMBER_API = {
  async getPullRequest(pullNumber: number) {
    if (pullNumber !== 42) throw new Error("Not Found");
    return { baseSha: BASE_SHA, headSha: HEAD_SHA };
  },
  async listTree(_sha: string) {
    return { paths: ["README.md", "src/math.ts", "src/new.ts", "src/utils/new-name.ts"], truncated: false };
  },
  async compareDiff(_basehead: string) {
    return fixture("golden/pr.diff");
  },
  async getPullRequestSignoff(_pullNumber: number) {
    return { author: { login: "octocat", type: "User" }, labels: [], commits: 1 };
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

interface UploadRunOptions {
  inputs?: Record<string, string>;
  context?: unknown;
  api?: Record<string, unknown>;
  answers?: Answers;
  timeoutMs?: number;
}

async function uploadRun(options: UploadRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: (options.context ?? META_CONTEXT) as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    ...options.api,
  } as typeof h.deps.api;
  const app = fakeApp(options.answers);
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls: app.calls };
}

let cachedReport: Promise<Report> | undefined;
/** report.json of the pull_request run with the upload off: the report runUpload is given directly. */
function metaReport(): Promise<Report> {
  cachedReport ??= uploadRun({ inputs: { upload: "never" } }).then((r) => r.report);
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

function runsBody(calls: FetchCall[]): Record<string, unknown> {
  const runs = ofKind(calls, "runs");
  expect(runs).toHaveLength(1);
  const call = runs[0] as FetchCall;
  expect(call.url).toBe(`${APP}/api/v1/runs`);
  expect(call.method).toBe("POST");
  expect(typeof call.body).toBe("string");
  return JSON.parse(call.body as string) as Record<string, unknown>;
}

const RUNS_FAILURES: Array<[name: string, answers: readonly Answer[], expected: string]> = [
  ["409", [json(409, { code: "pr_head_mismatch" })], "failed/runs:pr_head_mismatch"],
  ["422", [json(422, { code: "report_invalid" })], "failed/runs:report_invalid"],
  ["401", [json(401, { code: "token_invalid" })], "failed/runs:token_invalid"],
  ["403", [json(403, { code: "repo_not_in_installation" })], "failed/runs:repo_not_in_installation"],
  ["429", [json(429, { code: "rate_limited" })], "failed/runs:rate-limited"],
  ["502 twice", [bare(502), bare(502)], "failed/runs:status-502"],
  ["timeout", [hang], "failed/runs:timeout"],
  ["network", [network(), network()], "failed/runs:network"],
  [
    "a non-JSON content type",
    [() => new Response(JSON.stringify({ url: RUN_URL }), { status: 201, headers: { "content-type": "text/html" } })],
    "failed/runs:malformed",
  ],
  ["an http: url", [json(201, { url: RUN_URL.replace("https:", "http:") })], "failed/runs:malformed"],
  [
    "a url on another origin",
    [json(201, { url: "https://evil.example/acme/widgets/runs/9-1" })],
    "failed/runs:malformed",
  ],
  [
    "a url with a user name",
    [json(201, { url: RUN_URL.replace("https://", "https://user@") })],
    "failed/runs:malformed",
  ],
  ["a url over 2048 characters", [json(201, { url: `${APP}/r/${"a".repeat(2048)}` })], "failed/runs:malformed"],
  ["a non-string url", [json(201, { url: 7 })], "failed/runs:malformed"],
  ["a non-object body", [json(201, "[]")], "failed/runs:malformed"],
];

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the runs request", { timeout: 120_000 }, () => {
  it("AC-25: the runs request is a POST to the app's /api/v1/runs whose body names the run, with prHeadShaExpected from head-sha in pr-number mode and meta.headSha otherwise", async () => {
    const pr = await uploadRun({});
    expect(runsBody(pr.calls)).toEqual({
      objectKey: OBJECT_KEY,
      repository: "acme/widgets",
      repositoryId: 42,
      prNumber: 7,
      headSha: "b".repeat(40),
      baseSha: "a".repeat(40),
      scope: "ci/check",
      runId: 9,
      runAttempt: 1,
      event: "pull_request",
      prHeadShaExpected: "b".repeat(40),
    });

    // No repository id in the payload: repositoryId is null.
    const noId = await uploadRun({
      context: { ...META_CONTEXT, payload: { ...META_CONTEXT.payload, repository: { full_name: "acme/widgets" } } },
    });
    expect(runsBody(noId.calls).repositoryId).toBeNull();

    for (const inputs of [{ "pr-number": "42", "head-sha": HEAD_SHA }, { "pr-number": "42" }]) {
      const r = await uploadRun({ context: WORKFLOW_RUN_CONTEXT, api: PR_NUMBER_API, inputs });
      const label = JSON.stringify(inputs);
      expect(r.h.failed, label).toEqual([]);
      expect(runsBody(r.calls), label).toEqual({
        objectKey: OBJECT_KEY,
        repository: "acme/widgets",
        repositoryId: 42,
        prNumber: 42,
        headSha: HEAD_SHA,
        baseSha: BASE_SHA,
        scope: "ci/check",
        runId: 11,
        runAttempt: 2,
        event: "workflow_run",
        prHeadShaExpected: HEAD_SHA,
      });
    }
  });

  it("AC-26: each runs failure and malformed answer gives its outcome, meta.upload failed, no run-url, and today's comment without the hint", async () => {
    const today = await uploadRun({ inputs: { upload: "never" } });
    expect(today.h.posted, "control: today's comment").toHaveLength(1);

    for (const [name, answers, expected] of RUNS_FAILURES) {
      const direct = await directUpload({ runs: answers }, { timeoutMs: 30 });
      expect(label(direct.outcome), name).toBe(expected);
      expect(ofKind(direct.calls, "put"), `${name}: the PUT was made`).toHaveLength(1);

      const r = await uploadRun({ answers: { runs: answers }, timeoutMs: 30 });
      expect(ofKind(r.calls, "runs").length, `${name}: the runs request was made`).toBeGreaterThan(0);
      expect(r.report.meta?.upload, name).toEqual({ status: "failed" });
      expect(Object.hasOwn(r.h.outputs, "run-url"), name).toBe(false);
      expect(r.h.posted, `${name}: the comment is posted`).toHaveLength(1);
      expect(r.h.posted[0], `${name}: today's comment`).toBe(today.h.posted[0]);
      expect(r.h.posted[0], name).not.toContain(HINT);
      expect(r.h.failed, `${name}: the step is not failed`).toEqual([]);
    }
  });
});
