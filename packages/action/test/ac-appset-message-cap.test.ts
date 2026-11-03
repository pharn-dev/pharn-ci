import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// run() and the core cut are loaded inside the test body: this AC test is written before the Action passes the app's
// settings.messageMaxBytes to the upload, so nothing the build adds may run while this file loads. The Action runs
// against the in-memory harness plus injected app deps: a fake fetch that answers GET /api/v1/policy with a valid
// envelope whose settings.messageMaxBytes is 300, then the upload-url, the signed PUT and the runs request; a fake
// getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. No real network. A coverage-file
// input that names a missing file of a long path makes the real check() emit a COVERAGE_FILE_MISSING message of about
// 1000 bytes: longer than the app's 300, shorter than the default 2048, so the test fails before the build. The PUT
// body is gunzipped with node:zlib and read with this file's own tar reader.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "CAP", "beef", "3001"].join("-");
const NOW = new Date("2026-11-03T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-11-03T12:15:00Z",
};
const APP_CAP = 300;

/** A policy envelope the app answers with: valid in every key, its settings.messageMaxBytes the app's cap. */
const ENVELOPE = {
  version: 7,
  etag: "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  updatedAt: "2026-11-03T10:00:00Z",
  policy: { version: 1 },
  quarantine: [],
  settings: { uploadJunit: false, redactMessages: true, messageMaxBytes: APP_CAP },
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

/** A coverage file path that does not exist; "Coverage file not found: <path>" is 1000 bytes. */
const LONG_PATH = `reports/${"m".repeat(962)}.info`;

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; meta?: Record<string, unknown> };

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
type Kind = "policy" | "upload-url" | "put" | "runs" | "other";

function recordCall(input: unknown, init: RequestInit | undefined): FetchCall {
  const request = input instanceof Request ? input : undefined;
  return {
    url: request ? request.url : String(input),
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    body: init?.body ?? null,
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
  if (url.origin !== APP) return "other";
  if (call.method === "GET" && url.pathname === "/api/v1/policy") return "policy";
  if (call.method === "POST" && url.pathname === "/api/v1/runs/upload-url") return "upload-url";
  if (call.method === "POST" && url.pathname === "/api/v1/runs") return "runs";
  return "other";
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake app and storage: the policy GET, the upload-url, the PUT and the runs request each get one answer. */
function fakeApp() {
  const calls: FetchCall[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    calls.push(call);
    switch (kindOf(call)) {
      case "policy":
        return json(200, ENVELOPE);
      case "upload-url":
        return json(200, UPLOAD_URL_OK);
      case "put":
        return new Response(null, { status: 200 });
      case "runs":
        return json(201, { url: RUN_URL });
      default:
        throw new TypeError("fetch failed");
    }
  };
  return { fetch, calls };
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

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

describe("the app's settings.messageMaxBytes lowers the upload's message cap", () => {
  it("AC-1: an app policy response with settings.messageMaxBytes 300 cuts a 1000-byte message in the uploaded report.json to at most 300 bytes", {
    timeout: 120_000,
  }, async () => {
    const { run } = await import("../src/run.js");
    const { truncateUtf8 } = (await import("@pharn-ci/core")) as unknown as {
      truncateUtf8(text: string, maxBytes: number): string;
    };
    const h = harness({
      inputs: { policy: "auto", "coverage-file": LONG_PATH },
      context: META_CONTEXT as never,
    });
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    } as typeof h.deps.api;
    const app = fakeApp();
    Object.assign(h.deps, {
      fetch: app.fetch,
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => NOW,
      sleep: async () => {},
    });
    await run(h.deps);

    // Control: the same run fetched the app's policy once and uploaded once.
    expect(app.calls.map(kindOf)).toEqual(["policy", "upload-url", "put", "runs"]);

    // Control: the report written in the job holds the message whole, between the app's cap and the default 2048.
    const written = h.written[h.outputs["report-path"] ?? ""];
    if (written === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
    const local = JSON.parse(written) as Report;
    expectValidReport(local);
    const whole = local.messages.find((m) => m.code === "COVERAGE_FILE_MISSING");
    expect(whole, "control: the run reports the missing coverage file").toBeDefined();
    const wholeText = (whole as Message).text;
    expect(wholeText).toBe(`Coverage file not found: ${LONG_PATH}`);
    expect(byteLength(wholeText)).toBe(1000);

    // The uploaded bundle's report.json holds that message cut to at most 300 bytes.
    const put = app.calls.find((c) => kindOf(c) === "put") as FetchCall;
    const entries = untar(gunzipSync(bytesOf(put.body)));
    expect(entries.map((e) => e.name)).toEqual(["report.json", "meta.json"]);
    const uploaded = JSON.parse(entries[0]?.text ?? "") as Report;
    const cut = uploaded.messages.find((m) => m.code === "COVERAGE_FILE_MISSING");
    expect(cut, "the uploaded report carries the message").toBeDefined();
    const cutText = (cut as Message).text;
    expect(byteLength(cutText)).toBeLessThanOrEqual(APP_CAP);
    expect(cutText).toBe(truncateUtf8(wholeText, APP_CAP));
    for (const message of uploaded.messages) {
      expect(byteLength(message.text), message.code).toBeLessThanOrEqual(APP_CAP);
    }
  });
});
