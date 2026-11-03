import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fetchAppPolicy, fetchPolicy } from "../src/policy-fetch.js";
import { harness } from "./harness.js";

// Regression tests for the app-settings and merge-base change (not mapped to an AC; the two AC tests are
// ac-appset-message-cap and ac-appset-merge-base). Part 1: the app's settings.messageMaxBytes only lowers the upload's
// per-message cap, and only from a fully valid 200 policy response of this run. Part 2: meta.mergeBase is the fork
// point of the base and the head commit meta.headSha, recorded only for a run with a local diff, and a failed or odd
// `git merge-base` leaves it null silently. The app is a fake fetch; git is the harness's stub (a stub of merge-base is
// added per test). No real network.

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "REG", "feed", "5005"].join("-");
const NOW = new Date("2026-11-03T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-11-03T12:15:00Z",
};
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const FORK = "d".repeat(40);

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
    pull_request: { number: 7, base: { sha: BASE }, head: { sha: HEAD } },
  },
};

const envelope = (messageMaxBytes: number) => ({
  version: 7,
  etag: "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  updatedAt: "2026-11-03T10:00:00Z",
  policy: { version: 1 },
  quarantine: [],
  settings: { uploadJunit: false, redactMessages: true, messageMaxBytes },
});

/** "Coverage file not found: <path>" is 2100 bytes: above the 2048 default cap, so an uncut message cannot pass. */
const LONG_PATH = `reports/${"m".repeat(2062)}.info`;
const LONG_TEXT = `Coverage file not found: ${LONG_PATH}`;

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[]; meta?: Record<string, unknown> };
interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
type Kind = "policy" | "upload-url" | "put" | "runs" | "other";

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

/** A fake app: `policy` answers the policy GET; everything else of the upload answers fine. */
function fakeApp(policy: () => Response) {
  const calls: FetchCall[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const call: FetchCall = {
      url: request ? request.url : String(input),
      method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
      body: init?.body ?? null,
    };
    calls.push(call);
    switch (kindOf(call)) {
      case "policy":
        return policy();
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

const uploadMetaSchema = (() => {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  return ajv.compile(JSON.parse(readRoot("schema/upload-meta.v1.json")));
})();

const workspaces: string[] = [];
afterAll(() => {
  for (const w of workspaces) rmSync(w, { recursive: true, force: true });
});

/** One run that uploads a 2100-byte message; returns the message cut to the cap the uploaded report holds. */
async function uploadedMessageBytes(options: {
  policyInput: string;
  policy: () => Response;
  workspace?: string;
  files?: Record<string, string>;
}): Promise<number> {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { policy: options.policyInput, "coverage-file": LONG_PATH },
    context: META_CONTEXT as never,
    ...(options.files === undefined ? {} : { files: options.files }),
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp(options.policy);
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
  });
  await run(h.deps);
  const put = app.calls.find((c) => kindOf(c) === "put");
  if (put === undefined) throw new Error(`no upload; calls: ${app.calls.map(kindOf)}; failed: ${h.failed}`);
  const uploaded = JSON.parse(untar(gunzipSync(bytesOf(put.body)))[0]?.text ?? "") as Report;
  const message = uploaded.messages.find((m) => m.code === "COVERAGE_FILE_MISSING");
  if (message === undefined) throw new Error("the uploaded report has no COVERAGE_FILE_MISSING message");
  return byteLength(message.text);
}

describe("the app's settings.messageMaxBytes only lowers the upload cap", { timeout: 120_000 }, () => {
  it("a messageMaxBytes above 2048 keeps the cap at 2048", async () => {
    const bytes = await uploadedMessageBytes({ policyInput: "auto", policy: () => json(200, envelope(4096)) });
    expect(byteLength(LONG_TEXT)).toBe(2100);
    expect(bytes).toBe(2048);
  });

  it("a messageMaxBytes of 512 lowers it to 512", async () => {
    expect(await uploadedMessageBytes({ policyInput: "auto", policy: () => json(200, envelope(512)) })).toBe(512);
  });

  it("policy: required takes the setting from the same 200 response", async () => {
    expect(await uploadedMessageBytes({ policyInput: "required", policy: () => json(200, envelope(512)) })).toBe(512);
  });

  it("policy: never keeps 2048 and asks the app for no policy", async () => {
    const bytes = await uploadedMessageBytes({
      policyInput: "never",
      policy: () => {
        throw new Error("the policy must not be requested");
      },
    });
    expect(bytes).toBe(2048);
  });

  it("policy: file: keeps 2048", async () => {
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-appset-file-")));
    workspaces.push(workspace);
    mkdirSync(join(workspace, "coverage"));
    writeFileSync(join(workspace, "pharn-policy.json"), JSON.stringify({ version: 1 }));
    const bytes = await uploadedMessageBytes({
      policyInput: "file:pharn-policy.json",
      policy: () => {
        throw new Error("the policy must not be requested");
      },
      workspace,
      files: { [join(workspace, "pharn-policy.json")]: JSON.stringify({ version: 1 }) },
    });
    expect(bytes).toBe(2048);
  });

  it.each([
    ["a refused envelope (messageMaxBytes 100)", () => json(200, envelope(100))],
    ["a 204", () => new Response(null, { status: 204 })],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("%s keeps 2048", async (_name, policy) => {
    expect(await uploadedMessageBytes({ policyInput: "auto", policy })).toBe(2048);
  });
});

describe("fetchAppPolicy returns messageMaxBytes only for a valid 200", () => {
  const options = { mode: "auto" as const, origin: new URL(APP), repository: "acme/widgets" };
  const depsFor = (response: () => Response) => {
    const infos: string[] = [];
    return {
      infos,
      deps: {
        info: (m: string) => infos.push(m),
        fetch: async () => response(),
        getIDToken: async () => TOKEN,
        setSecret: () => {},
        hasOidcEnv: true,
        now: () => NOW,
        sleep: async () => {},
      },
    };
  };

  it("sets it for an envelope accepted whole, and fetchPolicy returns the same policy without it", async () => {
    const result = await fetchAppPolicy(depsFor(() => json(200, envelope(4096))).deps, options);
    expect(result.messageMaxBytes).toBe(4096);
    expect(result.policy.source).toBe("app");
    const policy = await fetchPolicy(depsFor(() => json(200, envelope(4096))).deps, options);
    expect(policy).toEqual(result.policy);
  });

  it.each([
    ["a 204", () => new Response(null, { status: 204 })],
    ["a 404", () => new Response(null, { status: 404 })],
    ["a 401", () => new Response(null, { status: 401 })],
    ["a 429", () => new Response(null, { status: 429 })],
    ["a refused envelope", () => json(200, envelope(100))],
    [
      "a body that is not JSON",
      () => new Response("nope", { status: 200, headers: { "content-type": "application/json" } }),
    ],
    ["a wrong content type", () => new Response(JSON.stringify(envelope(4096)), { status: 200 })],
  ])("sets nothing for %s", async (_name, response) => {
    const result = await fetchAppPolicy(depsFor(response).deps, options);
    expect(result.messageMaxBytes).toBeUndefined();
    expect("messageMaxBytes" in result).toBe(false);
  });
});

/** The harness's git with `merge-base` added: `answer` is what `git merge-base <base> <head>` prints, or rejects. */
interface GitStub {
  calls: string[][];
  answer: (args: string[]) => string | Error;
}

async function runWith(options: {
  context?: Record<string, unknown>;
  inputs?: Record<string, string>;
  localGit?: boolean;
  stub?: GitStub;
  api?: Record<string, unknown>;
}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { policy: "never", ...options.inputs },
    context: (options.context ?? META_CONTEXT) as never,
    ...(options.localGit === undefined ? {} : { localGit: options.localGit }),
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    ...options.api,
  } as typeof h.deps.api;
  const git = h.deps.git;
  const { stub } = options;
  if (stub !== undefined) {
    h.deps.git = async (args) => {
      if (args[0] === "merge-base") {
        stub.calls.push(args);
        const answer = stub.answer(args);
        if (answer instanceof Error) throw answer;
        return `${answer}\n`;
      }
      return git(args);
    };
  }
  await run(h.deps);
  const path = h.outputs["report-path"];
  if (path === undefined) throw new Error(`no report; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(h.written[path] as string) as Report;
  expectValidReport(report);
  return { h, report };
}

/** The merge-base calls whose head is the PR head commit (the fork-point call). */
const forkCalls = (calls: string[][]) => calls.filter((c) => c[c.length - 1] === HEAD);

describe("meta.mergeBase is the fork point of the base and meta.headSha", { timeout: 120_000 }, () => {
  it("is recorded once, as git prints it for [base, headSha], and never with HEAD as the head", async () => {
    const stub: GitStub = { calls: [], answer: (args) => (args[args.length - 1] === HEAD ? FORK : "e".repeat(40)) };
    const { report } = await runWith({ stub });
    expect(report.meta?.headSha).toBe(HEAD);
    expect(report.meta?.mergeBase).toBe(FORK);
    expect(stub.calls.filter((c) => c[c.length - 1] === "HEAD")).toEqual([]);
    expect(forkCalls(stub.calls)).toEqual([["merge-base", "--end-of-options", BASE, HEAD]]);
  });

  it("is null, with the verdict and the messages unchanged, when git merge-base fails (a shallow clone)", async () => {
    const ok = await runWith({ stub: { calls: [], answer: () => FORK } });
    const stub: GitStub = { calls: [], answer: () => new Error("fatal: Not a valid commit name") };
    const failed = await runWith({ stub });
    expect(failed.report.meta?.mergeBase).toBeNull();
    expect(forkCalls(stub.calls)).toHaveLength(1);
    expect(failed.report.verdict).toBe(ok.report.verdict);
    expect(failed.report.messages).toEqual(ok.report.messages);
    expect(failed.h.warnings).toEqual(ok.h.warnings);
    expect(failed.h.infos).toEqual(ok.h.infos);
    expect(failed.h.failed).toEqual([]);
  });

  it.each([
    ["an empty answer", ""],
    ["text that is not an object id", "fatal: no merge base"],
    ["a short id", "d".repeat(12)],
    ["an uppercase id", "D".repeat(40)],
  ])("is null when git merge-base prints %s", async (_name, printed) => {
    const { report } = await runWith({ stub: { calls: [], answer: () => printed } });
    expect(report.meta?.mergeBase).toBeNull();
  });

  it("is null with no merge-base call for the fork point when the diff comes from the compare API", async () => {
    const stub: GitStub = { calls: [], answer: () => FORK };
    const { h, report } = await runWith({ localGit: false, stub });
    expect(h.apiCalls.some((c) => c.startsWith("compare "))).toBe(true);
    expect(report.meta?.mergeBase).toBeNull();
    expect(forkCalls(stub.calls)).toEqual([]);
  });

  it("is null with no merge-base call in PR-number mode", async () => {
    const headSha = "2".repeat(40);
    const stub: GitStub = { calls: [], answer: () => FORK };
    const { h, report } = await runWith({
      stub,
      inputs: { "pr-number": "42", "head-sha": headSha, "github-token": "test-token" },
      context: {
        eventName: "workflow_run",
        sha: "4".repeat(40),
        ref: "refs/heads/main",
        workflow: "ci",
        job: "check",
        runId: 11,
        runAttempt: 1,
        repo: { owner: "octo", repo: "demo" },
        issue: { owner: "octo", repo: "demo" },
        payload: {
          repository: { full_name: "octo/demo", id: 42 },
          workflow_run: { id: 99, event: "pull_request", head_sha: headSha },
        },
      },
      api: {
        getPullRequest: async () => ({ baseSha: "1".repeat(40), headSha }),
        listTree: async () => ({ paths: ["README.md", "src/math.ts"], truncated: false }),
        getPullRequestSignoff: async () => ({ author: { login: "octocat", type: "User" }, labels: [], commits: 1 }),
      },
    });
    expect(report.meta?.prNumber).toBe(42);
    expect(report.meta?.mergeBase).toBeNull();
    expect(h.apiCalls.some((c) => c.startsWith("compare "))).toBe(true);
    expect(stub.calls).toEqual([]);
  });

  it("asks nothing when the run context yields no meta", async () => {
    const stub: GitStub = { calls: [], answer: () => FORK };
    const { report } = await runWith({
      stub,
      context: { eventName: "pull_request", sha: "merge000", payload: META_CONTEXT.payload },
    });
    expect(report.meta).toBeUndefined();
    expect(stub.calls).toEqual([]);
  });
});

describe("meta.json carries mergeBase null for a run with no local diff", { timeout: 120_000 }, () => {
  it("a compare-API run uploads a meta.json that validates, mergeBase null", async () => {
    const { run } = await import("../src/run.js");
    const h = harness({ inputs: { policy: "never" }, context: META_CONTEXT as never, localGit: false });
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    } as typeof h.deps.api;
    const app = fakeApp(() => new Response(null, { status: 204 }));
    Object.assign(h.deps, {
      fetch: app.fetch,
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => NOW,
      sleep: async () => {},
    });
    await run(h.deps);
    const put = app.calls.find((c) => kindOf(c) === "put");
    if (put === undefined) throw new Error(`no upload; failed: ${h.failed}`);
    const entries = untar(gunzipSync(bytesOf(put.body)));
    const meta = JSON.parse(entries[1]?.text ?? "") as Record<string, unknown>;
    expect(meta.mergeBase).toBeNull();
    expect(uploadMetaSchema(meta), JSON.stringify(uploadMetaSchema.errors)).toBe(true);
    const report = JSON.parse(entries[0]?.text ?? "") as Report;
    expect(report.meta?.mergeBase).toBeNull();
    expectValidReport(report);
  });
});
