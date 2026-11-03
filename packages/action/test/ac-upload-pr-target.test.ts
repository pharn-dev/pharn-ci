import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// A pull_request_target run never uploads (owner decision 2026-11-02): its checkout is the base branch, so pharn-ci
// refuses to measure it, and an upload would let the app record, and comment on, a run that measured nothing. The
// Action runs against the in-memory harness plus injected app deps: a fake fetch that records every request and
// answers the policy, upload-url, PUT and runs calls, and a fake getIDToken that records each token request. The
// harness answers `git rev-parse HEAD` with a commit that is not the PR head, the default pull_request_target checkout.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "PRT", "beef", "7310"].join("-");
const NOW = new Date("2026-11-02T12:00:00.000Z");
const SIGNED = `https://${["bkt-r2x", "blob-store", "example"].join(".")}/o/acme/prt-run.tgz?X-Sig=Lm5s0Qa2`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const SKIP_LINE = "pharn-ci: the run is not uploaded to pharn.dev: a pull_request_target run is never uploaded";
const REFUSAL = "pull_request_target cannot be measured safely";

const PR_META_CONTEXT = {
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
const TARGET_CONTEXT = { ...PR_META_CONTEXT, eventName: "pull_request_target" };

type Report = {
  verdict: string;
  messages: Array<{ code: string; level: string; text: string }>;
  meta?: Record<string, unknown>;
};
interface Call {
  method: string;
  url: string;
}

const respond = (status: number, body: unknown): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { "content-type": "application/json" },
  });

/** A fake app and storage: a 204 policy answer and a successful upload. Records each request's method and URL. */
function fakeApp() {
  const calls: Call[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "PUT") return respond(200, null);
    if (method === "GET" && url.startsWith(`${APP}/api/v1/policy?`)) return respond(204, null);
    if (method === "POST" && url === `${APP}/api/v1/runs/upload-url`) {
      return respond(200, {
        uploadUrl: SIGNED,
        objectKey: "runs/acme/widgets/9-1.tar.gz",
        maxBytes: 10_485_760,
        expiresAt: "2026-11-02T12:15:00Z",
      });
    }
    if (method === "POST" && url === `${APP}/api/v1/runs`) return respond(201, { url: RUN_URL });
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
}

async function targetRun(options: { context: unknown; inputs?: Record<string, string> }) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: options.context as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
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
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, text, report, calls: app.calls, tokenCalls };
}

const uploadCalls = (calls: Call[]) =>
  calls.filter((c) => c.method === "PUT" || (c.method === "POST" && c.url.startsWith(`${APP}/api/v1/runs`)));
const policyCalls = (calls: Call[]) => calls.filter((c) => c.method === "GET" && c.url.startsWith(`${APP}/api/v1/`));

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("a pull_request_target run does not upload", { timeout: 60_000 }, () => {
  it("with upload auto and an OIDC token: no token request, no POST and no PUT, meta.upload skipped, one log line; a pull_request run still uploads", async () => {
    const control = await targetRun({ context: PR_META_CONTEXT });
    expect(
      uploadCalls(control.calls).map((c) => c.method),
      "control: pull_request uploads",
    ).toEqual(["POST", "PUT", "POST"]);
    expect(control.tokenCalls, "control: pull_request asks for the upload token").toHaveLength(1);
    expect(control.report.meta?.upload, "control").toEqual({ status: "ok", runUrl: RUN_URL });
    expect(control.h.outputs["run-url"], "control").toBe(RUN_URL);

    const r = await targetRun({ context: TARGET_CONTEXT });
    expect(r.calls).toEqual([]);
    expect(r.tokenCalls).toEqual([]);
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });
    expect(Object.hasOwn(r.h.outputs, "run-url")).toBe(false);
    expect(r.h.infos.filter((line) => line === SKIP_LINE)).toHaveLength(1);
    expect(control.h.infos, "control: the line is only for pull_request_target").not.toContain(SKIP_LINE);
  });

  it("the report, comment, summary, verdict and failure are those of the same run with upload never", async () => {
    const auto = await targetRun({ context: TARGET_CONTEXT });
    const never = await targetRun({ context: TARGET_CONTEXT, inputs: { upload: "never" } });
    expect(never.calls).toEqual([]);
    expect(auto.text).toBe(never.text);
    expect(auto.h.posted).toHaveLength(1);
    expect(auto.h.posted).toEqual(never.h.posted);
    expect(auto.h.summary).toEqual(never.h.summary);
    expect(auto.h.failed).toEqual(never.h.failed);
    expect(auto.h.warnings).toEqual(never.h.warnings);
    // The run is still the refused, unmeasured run it was: DIFF_UNAVAILABLE, and a fail with the threshold.
    expect(auto.report.messages.filter((m) => m.code === "DIFF_UNAVAILABLE").map((m) => m.text)).toEqual([
      expect.stringContaining(REFUSAL),
    ]);
    expect(auto.report.verdict).toBe("fail");
    expect(auto.h.failed).toHaveLength(1);
    expect(auto.h.outputs.verdict).toBe("fail");
  });

  it("the policy request still happens with its own token; only the upload is left out", async () => {
    const control = await targetRun({ context: PR_META_CONTEXT, inputs: { policy: "auto" } });
    expect(policyCalls(control.calls), "control: pull_request fetches the policy").toHaveLength(1);
    expect(uploadCalls(control.calls), "control: pull_request uploads").toHaveLength(3);
    expect(control.tokenCalls, "control: one token for the policy, one for the upload").toHaveLength(2);

    const r = await targetRun({ context: TARGET_CONTEXT, inputs: { policy: "auto" } });
    expect(policyCalls(r.calls)).toHaveLength(1);
    expect(r.calls).toEqual(policyCalls(r.calls));
    expect(uploadCalls(r.calls)).toEqual([]);
    expect(r.tokenCalls).toHaveLength(1);
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });
  });
});
