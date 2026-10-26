import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { commentScopeLine } from "../src/run.js";
import { BOT, type HarnessOptions, harness } from "./harness.js";

// run() is loaded inside each test body: the AC tests are written before the upload step exists, so nothing the build
// adds may run while this file loads. The Action runs against the in-memory harness plus injected app deps: a fake
// fetch that records every request and answers the app and storage calls, a fake getIDToken and setSecret, the
// OIDC-env flag, a recorded sleep and a fixed clock. The context carries the run metadata, so the report has meta. The
// PUT body is gunzipped with node:zlib and read with this file's own tar reader.

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
const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";
const MARKER = "<!-- pharn-ci -->";
const COMMENT_URL = "https://github.com/acme/widgets/pull/7#issuecomment-5";

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

const PUSH_CONTEXT = {
  eventName: "push",
  sha: "c".repeat(40),
  workflow: "ci",
  job: "check",
  runId: 9,
  runAttempt: 1,
  actor: "octocat",
  payload: { repository: { full_name: "acme/widgets", id: 42 }, before: "a".repeat(40) },
};

type Report = { verdict: string; meta?: Record<string, unknown> };

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
type Answer = Error | ((call: FetchCall) => Response | Promise<Response>);
type Kind = "upload-url" | "put" | "runs" | "other";
interface Answers {
  uploadUrl?: readonly Answer[];
  put?: readonly Answer[];
  runs?: readonly Answer[];
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
  (status: number, body: unknown): Answer =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bare =
  (status: number): Answer =>
  () =>
    new Response(null, { status });

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
    const request = input instanceof Request ? input : undefined;
    const call: FetchCall = {
      url: request ? request.url : String(input),
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      body: init?.body ?? null,
    };
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
  answers?: Answers;
  oidc?: boolean;
  harness?: HarnessOptions;
}

async function uploadRun(options: UploadRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    ...options.harness,
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: (options.context ?? META_CONTEXT) as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(options.answers);
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: options.oidc ?? true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls: app.calls };
}

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

/** meta.json from the one PUT of a run. */
function sentMeta(calls: FetchCall[]): Record<string, unknown> {
  const puts = calls.filter((c) => kindOf(c) === "put");
  expect(puts).toHaveLength(1);
  const entry = untar(gunzipSync(bytesOf(puts[0]?.body))).find((e) => e.name === "meta.json");
  expect(entry, "meta.json is in the bundle").toBeDefined();
  return JSON.parse(entry?.text ?? "{}") as Record<string, unknown>;
}

/** An own pharn-ci marker comment of this run's scope (ci/check), posted by the token's login. */
const own = (id: number, htmlUrl: unknown) => ({
  id,
  body: `${MARKER}\n${commentScopeLine("ci", "check")}\n## ✅ pharn-ci: pass (an earlier run)`,
  user: { login: BOT.login },
  html_url: htmlUrl,
});

/** True when `body` holds the hint line immediately followed by an empty line and the footer's `---`. */
function hintBeforeFooter(body: string): boolean {
  const lines = body.split("\n");
  const at = lines.indexOf(HINT);
  return at > -1 && lines[at + 1] === "" && lines[at + 2] === "---" && lines.filter((l) => l === HINT).length === 1;
}

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the comment and the upload", { timeout: 120_000 }, () => {
  it("AC-31: meta.json carries the oldest own marker comment's https html_url as commentUrl, and null when there is none to use, the upload still ending ok", async () => {
    const other = { id: 3, body: "a human comment", user: { login: "octocat" }, html_url: `${COMMENT_URL}3` };
    const found = await uploadRun({
      harness: {
        existingComments: [other, own(5, COMMENT_URL), own(9, COMMENT_URL.replace("-5", "-9"))] as never,
      },
    });
    expect(sentMeta(found.calls).commentUrl).toBe(COMMENT_URL);
    expect(found.h.outputs["run-url"]).toBe(RUN_URL);

    const cases: Array<[string, UploadRunOptions]> = [
      [
        "comment input false",
        { inputs: { comment: "false" }, harness: { existingComments: [own(5, COMMENT_URL)] as never } },
      ],
      ["a push event", { context: PUSH_CONTEXT, inputs: { "base-ref": "a".repeat(40) } }],
      [
        "an http: html_url",
        { harness: { existingComments: [own(5, COMMENT_URL.replace("https:", "http:"))] as never } },
      ],
      [
        "an html_url with a user name",
        { harness: { existingComments: [own(5, COMMENT_URL.replace("https://", "https://user@"))] as never } },
      ],
      [
        "an html_url over 2048 characters",
        { harness: { existingComments: [own(5, `${COMMENT_URL}${"0".repeat(2048)}`)] as never } },
      ],
      ["a non-string html_url", { harness: { existingComments: [own(5, 5)] as never } }],
      [
        "listComments throws",
        { harness: { existingComments: [own(5, COMMENT_URL)] as never, commentError: new Error("boom") } },
      ],
    ];
    for (const [name, options] of cases) {
      const r = await uploadRun(options);
      expect(sentMeta(r.calls).commentUrl, name).toBeNull();
      expect(r.report.meta?.upload, `${name}: the upload ends ok`).toEqual({ status: "ok", runUrl: RUN_URL });
      expect(r.h.outputs["run-url"], name).toBe(RUN_URL);
    }
  });

  it("AC-32: an upload-url 404 puts the install hint before the footer in both the summary and the comment; failed, too_large, no-oidc and input-never runs show it in neither", async () => {
    const noApp = await uploadRun({ answers: { uploadUrl: [json(404, { code: "not_found" })] } });
    expect(noApp.h.summary).toHaveLength(1);
    expect(noApp.h.posted).toHaveLength(1);
    expect(hintBeforeFooter(noApp.h.summary[0] as string), "the summary").toBe(true);
    expect(hintBeforeFooter(noApp.h.posted[0] as string), "the comment").toBe(true);

    const cases: Array<[string, UploadRunOptions]> = [
      ["upload-url 401", { answers: { uploadUrl: [json(401, { code: "token_invalid" })] } }],
      ["upload-url 503 twice", { answers: { uploadUrl: [bare(503), bare(503)] } }],
      ["PUT 403", { answers: { put: [bare(403)] } }],
      ["runs 409", { answers: { runs: [json(409, { code: "pr_head_mismatch" })] } }],
      ["upload-url 413", { answers: { uploadUrl: [json(413, { code: "too_large" })] } }],
      ["maxBytes 1", { answers: { uploadUrl: [json(200, { ...UPLOAD_URL_OK, maxBytes: 1 })] } }],
      ["no OIDC env", { oidc: false }],
      ["upload never", { inputs: { upload: "never" } }],
    ];
    for (const [name, options] of cases) {
      const r = await uploadRun(options);
      expect(r.h.summary.length, `${name}: the summary is written`).toBeGreaterThan(0);
      expect(r.h.posted.length, `${name}: the comment is posted`).toBeGreaterThan(0);
      for (const body of [...r.h.summary, ...r.h.posted]) expect(body, name).not.toContain(HINT);
    }
  });
});
