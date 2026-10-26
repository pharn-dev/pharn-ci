import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness } from "./harness.js";

// run(), runUpload(), APP_MAX_BODY_BYTES and the fixtures under fixtures/upload/responses/ are loaded inside each test
// body: the AC tests are written before the upload step exists, so nothing the build adds may run while this file
// loads. The Action runs against the in-memory harness plus injected app deps: a fake fetch that records every request
// and answers the app and storage calls, a fake getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a
// fixed clock. The context carries the run metadata, so the report has meta. No real network.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const STORAGE = `https://${["bkt-q7z", "blob-store", "example"].join(".")}`;
const SIGNED = `${STORAGE}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-10-26T12:15:00Z",
};
const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";
const TOO_LARGE_TEXT =
  "The run was not uploaded to pharn.dev: the report is larger than the upload limit. The check ran in full; only the history on pharn.dev misses this run.";
const tooLargeText = (n: number) =>
  `The run was not uploaded to pharn.dev: the report is larger than the upload limit (${n} bytes). The check ran in full; only the history on pharn.dev misses this run.`;

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

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; meta?: Record<string, unknown> };
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
  timeoutMs?: number;
  lsFiles?: string[];
}

async function uploadRun(options: UploadRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: META_CONTEXT as never,
    ...(options.lsFiles ? { lsFiles: options.lsFiles } : {}),
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(options.answers);
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => {
      tokenCalls.push("token");
      return TOKEN;
    },
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
  return { h, text, report, calls: app.calls, tokenCalls };
}

let cachedReport: Promise<Report> | undefined;
/** report.json of the same run with the upload off: the report runUpload is given directly. */
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
  const infos: string[] = [];
  const warnings: string[] = [];
  const deps = {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
    info: (m: string) => {
      infos.push(m);
    },
    warning: (m: string) => {
      warnings.push(m);
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const outcome = await runUpload(deps, { choice: "auto", report, appOrigin: new URL(APP) });
  return { outcome, calls: app.calls, infos, warnings };
}

const label = (o: Outcome) =>
  o.status === "ok" ? "ok" : o.status === "too_large" ? `too_large/${String(o.maxBytes)}` : `${o.status}/${o.reason}`;
const ofKind = (calls: FetchCall[], kind: Kind) => calls.filter((c) => kindOf(c) === kind);
const withCode = (report: Report, code: string) => report.messages.filter((m) => m.code === code);

const FAILURES: Array<[name: string, answers: readonly Answer[], expected: string]> = [
  ["401", [json(401, { code: "token_invalid" })], "failed/upload-url:token_invalid"],
  ["403", [json(403, { code: "repo_not_in_installation" })], "failed/upload-url:repo_not_in_installation"],
  ["404", [json(404, { code: "not_found" })], "skipped/no-installation"],
  ["413", [json(413, { code: "too_large" })], "too_large/null"],
  ["429", [json(429, { code: "rate_limited" })], "failed/upload-url:rate-limited"],
  ["503 twice", [bare(503), bare(503)], "failed/upload-url:status-503"],
  ["timeout", [hang], "failed/upload-url:timeout"],
  ["network", [network(), network()], "failed/upload-url:network"],
];

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("upload-url failures", { timeout: 120_000 }, () => {
  it("AC-19: each upload-url failure gives its outcome, no PUT, meta.upload { status }, no run-url, today's comment, the hint only for 404, and UPLOAD_TOO_LARGE without a count for 413", async () => {
    const today = await uploadRun({ inputs: { upload: "never" } });
    expect(today.report.verdict, "control: the run passes").toBe("pass");
    expect(today.h.posted, "control: today's comment").toHaveLength(1);

    for (const [name, answers, expected] of FAILURES) {
      const direct = await directUpload({ uploadUrl: answers }, { timeoutMs: 30 });
      expect(label(direct.outcome), name).toBe(expected);
      expect(ofKind(direct.calls, "put"), `${name}: no PUT`).toEqual([]);
      expect(ofKind(direct.calls, "upload-url").length, `${name}: the upload-url request was made`).toBeGreaterThan(0);

      const r = await uploadRun({ answers: { uploadUrl: answers }, timeoutMs: 30 });
      expect(ofKind(r.calls, "put"), `${name}: no PUT`).toEqual([]);
      expect(ofKind(r.calls, "runs"), `${name}: no runs request`).toEqual([]);
      expect(ofKind(r.calls, "upload-url").length, `${name}: the upload-url request was made`).toBeGreaterThan(0);
      const status = expected.split("/")[0] as string;
      expect(r.report.meta?.upload, name).toEqual({ status });
      expect(Object.hasOwn(r.h.outputs, "run-url"), name).toBe(false);
      expect(r.h.failed, `${name}: the step is not failed`).toEqual([]);

      if (status === "failed") {
        const reason = expected.slice("failed/".length);
        expect(
          r.h.warnings.filter((w) => w.includes("pharn-ci: the run was not uploaded to pharn.dev (failed: ")),
          name,
        ).toHaveLength(1);
        expect(
          r.h.warnings.some((w) => w.includes(`(failed: ${reason}`)),
          `${name}: the warning names ${reason}`,
        ).toBe(true);
      }

      expect(r.h.posted, `${name}: the comment is posted`).toHaveLength(1);
      const body = r.h.posted[0] as string;
      if (name === "404") {
        expect(body, name).toContain(HINT);
        expect(body.replace(`${HINT}\n\n`, ""), `${name}: today's comment plus the hint`).toBe(today.h.posted[0]);
      } else if (name === "413") {
        expect(body, name).not.toContain(HINT);
        expect(withCode(r.report, "UPLOAD_TOO_LARGE"), name).toEqual([
          { level: "warn", code: "UPLOAD_TOO_LARGE", text: TOO_LARGE_TEXT },
        ]);
        expect(r.report.verdict, name).toBe("warn");
      } else {
        expect(body, `${name}: today's comment`).toBe(today.h.posted[0]);
        expect(withCode(r.report, "UPLOAD_TOO_LARGE"), name).toEqual([]);
      }
    }
  });

  it("AC-20: each malformed upload-url 200 answer ends failed/upload-url:malformed with no PUT, and a valid answer with extra keys ends ok", async () => {
    const { APP_MAX_BODY_BYTES } = (await import("../src/app-client.js")) as unknown as { APP_MAX_BODY_BYTES: number };
    expect(APP_MAX_BODY_BYTES, "control: the read cap").toBeGreaterThan(0);
    const valid = (patch: Record<string, unknown>) => json(200, { ...UPLOAD_URL_OK, ...patch });
    const cases: Array<[string, Answer]> = [
      [
        "a non-JSON content type",
        () => new Response(JSON.stringify(UPLOAD_URL_OK), { status: 200, headers: { "content-type": "text/plain" } }),
      ],
      ["an unparseable body", json(200, '{"uploadUrl": ')],
      ["a null body", json(200, "null")],
      ["a number", json(200, "42")],
      ["a string", json(200, '"https://x.example/"')],
      ["an array", json(200, JSON.stringify([UPLOAD_URL_OK]))],
      ["an http: uploadUrl", valid({ uploadUrl: SIGNED.replace("https:", "http:") })],
      ["an uploadUrl with a user name", valid({ uploadUrl: SIGNED.replace("https://", "https://user@") })],
      ["an uploadUrl with a password", valid({ uploadUrl: SIGNED.replace("https://", "https://user:pw@") })],
      ["an uploadUrl with a fragment", valid({ uploadUrl: `${SIGNED}#frag` })],
      ["an uploadUrl with a space", valid({ uploadUrl: `${STORAGE}/o/a b` })],
      ["an uploadUrl with a control character", valid({ uploadUrl: `${STORAGE}/o/a\u0001b` })],
      ["an uploadUrl over 8192 characters", valid({ uploadUrl: `${STORAGE}/o/${"a".repeat(8192)}` })],
      ["a non-string uploadUrl", valid({ uploadUrl: 7 })],
      ["a missing uploadUrl", json(200, { objectKey: UPLOAD_URL_OK.objectKey, maxBytes: 1000, expiresAt: "x" })],
      ["an objectKey with a space", valid({ objectKey: "runs/a b" })],
      ["an objectKey with a ?", valid({ objectKey: "runs/a?b" })],
      ["an objectKey over 512 characters", valid({ objectKey: "a".repeat(513) })],
      ["an empty objectKey", valid({ objectKey: "" })],
      ["maxBytes 0", valid({ maxBytes: 0 })],
      ["maxBytes -1", valid({ maxBytes: -1 })],
      ["maxBytes 1.5", valid({ maxBytes: 1.5 })],
      [
        "maxBytes above the safe-integer range",
        json(200, JSON.stringify(UPLOAD_URL_OK).replace("10485760", "9007199254740993")),
      ],
      ["a string maxBytes", valid({ maxBytes: "1000" })],
      ["an empty expiresAt", valid({ expiresAt: "" })],
      ["a 65-character expiresAt", valid({ expiresAt: "x".repeat(65) })],
      ["a body over the read cap", json(200, { ...UPLOAD_URL_OK, pad: "a".repeat(APP_MAX_BODY_BYTES) })],
    ];
    for (const [name, answer] of cases) {
      const direct = await directUpload({ uploadUrl: [answer] });
      expect(label(direct.outcome), name).toBe("failed/upload-url:malformed");
      expect(ofKind(direct.calls, "put"), `${name}: no PUT`).toEqual([]);
      expect(ofKind(direct.calls, "runs"), `${name}: no runs request`).toEqual([]);
    }

    // Controls: the boundaries the SPEC allows are accepted.
    for (const [name, answer] of [
      [
        "an uploadUrl of 8192 characters",
        valid({ uploadUrl: `${STORAGE}/o/${"a".repeat(8192 - STORAGE.length - 3)}` }),
      ],
      ["an objectKey of 512 characters", valid({ objectKey: "a".repeat(512) })],
      ["a 64-character expiresAt", valid({ expiresAt: "x".repeat(64) })],
      [
        "a JSON content type with a charset",
        json(200, UPLOAD_URL_OK, { "content-type": "application/json; charset=utf-8" }),
      ],
    ] as const) {
      const direct = await directUpload({ uploadUrl: [answer] });
      expect(label(direct.outcome), name).toBe("ok");
    }

    const extra = await uploadRun({ answers: { uploadUrl: [fromFixture("upload-url-extra-keys.json")] } });
    expect(extra.report.meta?.upload).toEqual({ status: "ok", runUrl: RUN_URL });
    expect(extra.h.outputs["run-url"]).toBe(RUN_URL);
    expect(ofKind(extra.calls, "put")).toHaveLength(1);

    const malformed = await uploadRun({ answers: { uploadUrl: [valid({ maxBytes: 0 })] } });
    expect(ofKind(malformed.calls, "put")).toEqual([]);
    expect(malformed.report.meta?.upload).toEqual({ status: "failed" });
    expect(malformed.h.warnings.some((w) => w.includes("(failed: upload-url:malformed"))).toBe(true);
  });

  it("AC-21: a maxBytes below the gzip size makes no PUT and adds UPLOAD_TOO_LARGE naming it, turning pass into warn", async () => {
    const today = await uploadRun({ inputs: { upload: "never" } });
    expect(today.report.verdict, "control: the run passes").toBe("pass");

    const r = await uploadRun({ answers: { uploadUrl: [json(200, { ...UPLOAD_URL_OK, maxBytes: 1 })] } });
    expect(ofKind(r.calls, "upload-url")).toHaveLength(1);
    expect(ofKind(r.calls, "put")).toEqual([]);
    expect(ofKind(r.calls, "runs")).toEqual([]);
    expect(r.report.meta?.upload).toEqual({ status: "too_large" });
    expect(withCode(r.report, "UPLOAD_TOO_LARGE")).toEqual([
      { level: "warn", code: "UPLOAD_TOO_LARGE", text: tooLargeText(1) },
    ]);
    expect(r.report.verdict).toBe("warn");
    expect(r.h.failed).toEqual([]);

    const direct = await directUpload({ uploadUrl: [json(200, { ...UPLOAD_URL_OK, maxBytes: 1 })] });
    expect(label(direct.outcome)).toBe("too_large/1");
  });

  it("AC-22: a report whose redacted report.json is over 5242880 bytes makes no request to the app or storage and carries UPLOAD_TOO_LARGE naming 5242880", async () => {
    // Tens of thousands of agent setup files (CLAUDE.md at depth) make report.json larger than the upload limit.
    const segment = "nested-directory-level/".repeat(6);
    const lsFiles = [
      ...fixture("golden/files.txt").trim().split("\n"),
      ...Array.from({ length: 26_000 }, (_, i) => `packages/p${String(i).padStart(5, "0")}/${segment}CLAUDE.md`),
    ];
    const r = await uploadRun({ lsFiles });
    expect(Buffer.byteLength(r.text, "utf8"), "control: report.json is over the limit").toBeGreaterThan(5_242_880);
    expect(r.tokenCalls.length, "the run reached the token request").toBeGreaterThan(0);
    expect(r.calls).toEqual([]);
    expect(r.report.meta?.upload).toEqual({ status: "too_large" });
    expect(withCode(r.report, "UPLOAD_TOO_LARGE")).toEqual([
      { level: "warn", code: "UPLOAD_TOO_LARGE", text: tooLargeText(5242880) },
    ]);
  });
});
