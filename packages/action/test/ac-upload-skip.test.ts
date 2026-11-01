import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness, PR_CONTEXT } from "./harness.js";

// run() is loaded inside each test body: the AC tests are written before the upload step exists, so nothing the build
// adds may run while this file loads. The Action runs against the in-memory harness plus injected app deps: a fake
// fetch that records every request and answers the app and storage calls, a fake getIDToken and setSecret, the
// OIDC-env flag, a recorded sleep and a fixed clock. The default context carries the run metadata, so the report has
// meta; each test that asserts "no fetch" also shows, with the same deps, the run that does upload.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const NOW = new Date("2026-10-26T12:00:00.000Z");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";
const NO_TOKEN_LINE = "pharn-ci: the run is not uploaded to pharn.dev: no OIDC token is available";

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

interface SkipRunOptions {
  inputs?: Record<string, string>;
  context?: unknown;
  /** false: the deps carry no app deps at all (no fetch, getIDToken, setSecret, hasOidcEnv, now or sleep). */
  appDeps?: boolean;
  oidc?: boolean;
}

async function skipRun(options: SkipRunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: (options.context ?? META_CONTEXT) as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp();
  const tokenCalls: unknown[] = [];
  if (options.appDeps !== false) {
    Object.assign(h.deps, {
      fetch: app.fetch,
      getIDToken: async (audience?: string) => {
        tokenCalls.push(audience);
        return TOKEN;
      },
      setSecret: () => {},
      hasOidcEnv: options.oidc ?? true,
      now: () => NOW,
      sleep: async () => {},
    });
  }
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, text, report, calls: app.calls, tokenCalls };
}

const uploadUrlCalls = (calls: Array<{ method: string; url: string }>) =>
  calls.filter((c) => c.method === "POST" && c.url === `${APP}/api/v1/runs/upload-url`);

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("runs that do not upload", { timeout: 60_000 }, () => {
  it("AC-14: upload never with the OIDC env makes no fetch and no token request, keeps meta.upload skipped, posts today's comment without the hint and sets no run-url", async () => {
    const control = await skipRun({});
    expect(uploadUrlCalls(control.calls), "control: with upload auto the same run uploads").toHaveLength(1);
    expect(control.tokenCalls.length, "control: with upload auto the token is requested").toBeGreaterThan(0);

    const r = await skipRun({ inputs: { upload: "never" } });
    expect(r.calls).toEqual([]);
    expect(r.tokenCalls).toEqual([]);
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });
    expect(Object.hasOwn(r.h.outputs, "run-url")).toBe(false);

    const today = await skipRun({ inputs: { upload: "never" }, appDeps: false });
    expect(r.h.posted).toHaveLength(1);
    expect(r.h.posted).toEqual(today.h.posted);
    for (const body of [...r.h.posted, ...r.h.summary]) expect(body).not.toContain(HINT);
  });

  it("AC-15: without the OIDC env nothing is fetched, the report, comment and summary are those of a run with no app deps, and the info log holds the no-token line", async () => {
    const r = await skipRun({ oidc: false });
    expect(r.calls).toEqual([]);
    expect(r.tokenCalls).toEqual([]);
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });

    const none = await skipRun({ appDeps: false });
    expect(r.text).toBe(none.text);
    expect(r.h.posted).toEqual(none.h.posted);
    expect(r.h.summary).toEqual(none.h.summary);
    expect(r.h.warnings).toEqual(none.h.warnings);

    expect(NO_TOKEN_LINE).not.toContain("id-token: write");
    expect(r.h.infos.filter((line) => line === NO_TOKEN_LINE)).toHaveLength(1);
    expect(Object.hasOwn(r.h.outputs, "run-url")).toBe(false);
  });

  it("AC-16: a context without run metadata gives a report with no meta, and neither the token nor fetch is requested", async () => {
    const control = await skipRun({});
    expect(control.tokenCalls.length, "control: with run metadata the token is requested").toBeGreaterThan(0);
    expect(uploadUrlCalls(control.calls), "control: with run metadata the run uploads").toHaveLength(1);

    const context = { ...PR_CONTEXT, payload: { ...PR_CONTEXT.payload, repository: { full_name: "acme/widgets" } } };
    const r = await skipRun({ context });
    expect(Object.hasOwn(r.report, "meta")).toBe(false);
    expect(r.tokenCalls).toEqual([]);
    expect(r.calls).toEqual([]);
  });
});
