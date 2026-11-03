import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness } from "./harness.js";

// run() and createNodeIo() are loaded inside the test body: this AC test is written before the Action records the merge
// base, so nothing the build adds may run while this file loads. The run is a pull_request run over a real git
// repository fixture in a temporary directory, through the Action's own node-io git deps:
//
//   M ── B        main: M, then the base moved on to B
//    \     \
//     H ── X      the PR head H forked from M; X is GitHub's merge commit of B and H, checked out as HEAD
//
// so `git merge-base B HEAD` is B (the base tip) while the fork point of the PR head, `git merge-base B H`, is M. The
// upload runs against injected app deps: a fake fetch that answers the upload-url, the signed PUT and the runs request,
// a fake getIDToken and setSecret, the OIDC-env flag, a recorded sleep and a fixed clock. No real network. The PUT body
// is gunzipped with node:zlib and read with this file's own tar reader; meta.json is checked against
// schema/upload-meta.v1.json.

const ROOT = new URL("../../../", import.meta.url);
const readRoot = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "MB", "cafe", "4004"].join("-");
const NOW = new Date("2026-11-03T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-11-03T12:15:00Z",
};

let dir: string;
/** The fork point of the PR head. */
let forkId: string;
/** The base tip, after the base moved on. */
let baseId: string;
/** The PR head. */
let headId: string;
/** GitHub's merge commit of the base tip and the PR head, checked out as HEAD. */
let mergeId: string;

beforeAll(() => {
  // realpath: on macOS tmpdir() is behind a symlink, while git reports physical paths.
  dir = realpathSync(mkdtempSync(join(tmpdir(), "pharn-ci-ac-appset-merge-base-")));
  const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "test@example.com");
  sh("config", "user.name", "test");
  sh("config", "commit.gpgsign", "false");
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(dir, "docs/notes.md"), "# Notes\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "fork point");
  forkId = sh("rev-parse", "HEAD").trim();

  sh("checkout", "-q", "-b", "feature");
  writeFileSync(join(dir, "src/math.ts"), "export const a = 1;\nexport const b = 3;\nexport const c = 4;\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "pull request head");
  headId = sh("rev-parse", "HEAD").trim();

  sh("checkout", "-q", "main");
  writeFileSync(join(dir, "docs/notes.md"), "# Notes\n\nThe base moved on.\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "base moved on");
  baseId = sh("rev-parse", "HEAD").trim();

  sh("checkout", "-q", "--detach", baseId);
  sh("merge", "-q", "--no-ff", "--no-edit", "-m", `Merge ${headId} into ${baseId}`, headId);
  mergeId = sh("rev-parse", "HEAD").trim();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Report = { verdict: string; meta?: Record<string, unknown> };

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
type Kind = "upload-url" | "put" | "runs" | "other";

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
  if (call.method !== "POST" || url.origin !== APP) return "other";
  if (url.pathname === "/api/v1/runs/upload-url") return "upload-url";
  if (url.pathname === "/api/v1/runs") return "runs";
  return "other";
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake app and storage: the upload-url, the PUT and the runs request each get one answer. */
function fakeApp() {
  const calls: FetchCall[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call = recordCall(input, init);
    calls.push(call);
    switch (kindOf(call)) {
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

describe("meta.json records the merge base of the base and the pull request's head commit", () => {
  it("AC-4: on a pull_request run whose HEAD is the merge commit of the base tip B and the PR head H, meta.json's mergeBase is H's fork point M, not B, and validates against schema/upload-meta.v1.json", {
    timeout: 120_000,
  }, async () => {
    // Control: the fixture is the shape the AC names.
    const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
    expect(sh("rev-parse", "HEAD")).toBe(mergeId);
    expect(sh("rev-list", "--parents", "-n", "1", "HEAD").split(" ")).toEqual([mergeId, baseId, headId]);
    expect(sh("merge-base", baseId, headId)).toBe(forkId);
    expect(sh("merge-base", baseId, "HEAD")).toBe(baseId);
    expect(forkId).not.toBe(baseId);

    const { run } = await import("../src/run.js");
    const { createNodeIo } = await import("../src/node-io.js");
    const lcov = `SF:${dir}/src/math.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n`;
    const h = harness({
      inputs: { policy: "never" },
      files: { [`${dir}/coverage/lcov.info`]: lcov },
      context: {
        eventName: "pull_request",
        sha: mergeId,
        workflow: "ci",
        job: "check",
        runId: 9,
        runAttempt: 1,
        actor: "octocat",
        payload: {
          repository: { full_name: "acme/widgets", id: 42 },
          pull_request: { number: 7, base: { sha: baseId }, head: { sha: headId } },
        },
      } as never,
    });
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    } as typeof h.deps.api;
    const io = createNodeIo(dir) as unknown as Record<string, unknown>;
    const deps = h.deps as unknown as Record<string, unknown>;
    deps.workspace = dir;
    deps.git = io.git;
    deps.gitStream = io.gitStream;
    if (io.gitBatch) deps.gitBatch = io.gitBatch;
    deps.listDir = io.listDir;
    const app = fakeApp();
    Object.assign(deps, {
      fetch: app.fetch,
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => NOW,
      sleep: async () => {},
    });
    await run(h.deps);

    // Control: the run read the diff from the local checkout (no compare API call) and uploaded once.
    expect(h.apiCalls.filter((c) => c.startsWith("compare "))).toEqual([]);
    expect(app.calls.map(kindOf)).toEqual(["upload-url", "put", "runs"]);
    const written = h.written[h.outputs["report-path"] ?? ""];
    if (written === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
    const report = JSON.parse(written) as Report;
    expect(report.meta?.headSha, "control: the recorded head is the PR head").toBe(headId);
    expect(report.meta?.baseSha, "control: the recorded base is the base tip").toBe(baseId);

    const put = app.calls.find((c) => kindOf(c) === "put") as FetchCall;
    const entries = untar(gunzipSync(bytesOf(put.body)));
    expect(entries.map((e) => e.name)).toEqual(["report.json", "meta.json"]);
    const meta = JSON.parse(entries[1]?.text ?? "") as Record<string, unknown>;

    expect(meta.mergeBase).toBe(forkId);
    expect(meta.mergeBase).not.toBe(baseId);

    const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
    const validate = ajv.compile(JSON.parse(readRoot("schema/upload-meta.v1.json")));
    expect(validate(meta), JSON.stringify(validate.errors)).toBe(true);
  });
});
