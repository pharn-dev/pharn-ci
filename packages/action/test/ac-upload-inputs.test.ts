import { describe, expect, it } from "vitest";
import { harness, WORKSPACE } from "./harness.js";

// run() is loaded inside each test body: the AC tests are written before the upload step exists, so nothing the build
// adds may run while this file loads. The Action runs against the in-memory harness plus injected app deps: a fake
// fetch that records every request and answers the app and storage calls, a fake getIDToken and setSecret, the
// OIDC-env flag, a recorded sleep and a fixed clock. The context carries the run metadata, so the report has meta.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const FIXED = "the upload input must be auto or never";

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

const respond = (status: number, body: unknown): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { "content-type": "application/json" },
  });

/** Answers the upload-url, PUT and runs requests with a successful upload; records each request's method and URL. */
function fakeApp() {
  const calls: Array<{ method: string; url: string }> = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "PUT") return respond(200, null);
    if (method === "POST" && url === `${APP}/api/v1/runs/upload-url`) {
      return respond(200, {
        uploadUrl: SIGNED,
        objectKey: "runs/acme/widgets/9-1.tar.gz",
        maxBytes: 10_485_760,
        expiresAt: "2026-10-26T12:15:00Z",
      });
    }
    if (method === "POST" && url === `${APP}/api/v1/runs`) return respond(201, { url: `${APP}/acme/widgets/runs/9-1` });
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
}

async function inputRun(inputs: Record<string, string>, files: Record<string, string> = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "50", policy: "never", ...inputs }, files, context: META_CONTEXT as never });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const reads: string[] = [];
  const readFile = h.deps.readFile;
  h.deps.readFile = async (path: string) => {
    reads.push(path);
    return readFile(path);
  };
  const app = fakeApp();
  const tokenCalls: unknown[] = [];
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async (audience?: string) => {
      tokenCalls.push(audience);
      return TOKEN;
    },
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  return { h, text, calls: app.calls, tokenCalls, reads };
}

const uploadUrlCalls = (calls: Array<{ method: string; url: string }>) =>
  calls.filter((c) => c.method === "POST" && c.url === `${APP}/api/v1/runs/upload-url`);

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the upload input", { timeout: 60_000 }, () => {
  it("AC-12: empty, auto and padded auto upload, never does not, and Never, off and true fail the step with one fixed message before the config read and any fetch", async () => {
    for (const value of ["", "auto", " auto "]) {
      const r = await inputRun({ upload: value });
      const label = JSON.stringify(value);
      expect(r.h.failed, label).toEqual([]);
      expect(r.text, `${label}: report.json is written`).toBeDefined();
      expect(uploadUrlCalls(r.calls), `${label}: the run uploads`).toHaveLength(1);
    }

    const never = await inputRun({ upload: "never" });
    expect(never.h.failed).toEqual([]);
    expect(never.text).toBeDefined();
    expect(never.calls).toEqual([]);

    for (const value of ["Never", "off", "true"]) {
      const r = await inputRun({ upload: value });
      expect(r.h.failed, value).toHaveLength(1);
      const failure = r.h.failed[0] as string;
      expect(failure, value).toMatch(new RegExp(`(^|: )${FIXED}$`));
      expect(failure, value).not.toContain(value);
      expect(
        r.reads.filter((path) => path.endsWith(".pharn/ci.yml")),
        `${value}: the config is not read`,
      ).toEqual([]);
      expect(r.calls, `${value}: no fetch`).toEqual([]);
      expect(r.tokenCalls, `${value}: no token`).toEqual([]);
    }
  });

  it("AC-13: upload: never in .pharn/ci.yml fails the step as an unknown top-level key and makes no fetch, while the same run without it uploads", async () => {
    const control = await inputRun({});
    expect(control.h.failed).toEqual([]);
    expect(uploadUrlCalls(control.calls), "control: without the key the run uploads").toHaveLength(1);

    const r = await inputRun({}, { [`${WORKSPACE}/.pharn/ci.yml`]: "upload: never\n" });
    expect(
      r.reads.some((path) => path.endsWith(".pharn/ci.yml")),
      "the config is read",
    ).toBe(true);
    expect(r.h.failed.length).toBeGreaterThan(0);
    expect(r.h.failed.join("\n")).toContain('unknown top-level key "upload"');
    expect(r.calls).toEqual([]);
  });
});
