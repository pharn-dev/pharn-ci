import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// The install hint (review overflow LOW, A5-F7): a policy request answered 404 means the Pharn GitHub App is not
// installed, so the comment and the summary end with the one-line hint, as they do when the upload is answered 404,
// and a run where both are answered 404 shows it once. A 204 (installed, no policy yet) gets no hint. The Action runs
// against the in-memory harness plus injected app deps: a fake fetch that answers the policy GET and the upload
// requests from per-test answers and records every request, and a fake getIDToken.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "HNT", "cafe", "5521"].join("-");
const NOW = new Date("2026-11-02T12:00:00.000Z");
const SIGNED = `https://${["bkt-h4n", "blob-store", "example"].join(".")}/o/acme/hint-run.tgz?X-Sig=Qw7e2Rt9`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const HINT = "Install the Pharn GitHub App for org policy, history and flaky detection.";
const FIXTURES = new URL("../../../fixtures/policy-api/", import.meta.url);
const apiFixture = (name: string) => readFileSync(new URL(name, FIXTURES), "utf8");

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

type Report = { verdict: string; messages: Array<{ code: string }>; meta?: Record<string, unknown> };
type Answer = () => Response;
interface Call {
  method: string;
  url: string;
}

const respond =
  (status: number, body: string | null = null): Answer =>
  () =>
    new Response(body, { status, headers: body === null ? {} : { "content-type": "application/json" } });

const UPLOAD_URL_OK = respond(
  200,
  JSON.stringify({
    uploadUrl: SIGNED,
    objectKey: "runs/acme/widgets/9-1.tar.gz",
    maxBytes: 10_485_760,
    expiresAt: "2026-11-02T12:15:00Z",
  }),
);

/** A fake app and storage: the policy GET and the upload-url POST get the given answers; the PUT and runs succeed. */
function fakeApp(answers: { policy?: Answer; uploadUrl?: Answer }) {
  const calls: Call[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = request ? request.url : String(input);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "PUT") return respond(200)();
    if (method === "GET" && url.startsWith(`${APP}/api/v1/policy?`) && answers.policy) return answers.policy();
    if (method === "POST" && url === `${APP}/api/v1/runs/upload-url`) return (answers.uploadUrl ?? UPLOAD_URL_OK)();
    if (method === "POST" && url === `${APP}/api/v1/runs`) return respond(201, JSON.stringify({ url: RUN_URL }))();
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
}

async function hintRun(options: { inputs: Record<string, string>; policy?: Answer; uploadUrl?: Answer }) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { threshold: "50", ...options.inputs }, context: META_CONTEXT as never });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const app = fakeApp({
    ...(options.policy ? { policy: options.policy } : {}),
    ...(options.uploadUrl ? { uploadUrl: options.uploadUrl } : {}),
  });
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
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
  return { h, text, report, calls: app.calls };
}

const hintCount = (body: string) => body.split("\n").filter((line) => line === HINT).length;
/** The hint is one line, followed by an empty line and the footer's rule. */
function hintBeforeFooter(body: string): boolean {
  const lines = body.split("\n");
  const at = lines.indexOf(HINT);
  return at > -1 && lines[at + 1] === "" && lines[at + 2] === "---" && hintCount(body) === 1;
}
const policyGets = (calls: Call[]) => calls.filter((c) => c.method === "GET" && c.url.startsWith(`${APP}/api/v1/`));

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the install hint after a policy 404", { timeout: 60_000 }, () => {
  it("policy auto answered 404 with upload never: the summary and the comment end with the hint once; report.json is the policy-never one", async () => {
    const control = await hintRun({ inputs: { policy: "never", upload: "never" } });
    expect(control.calls, "control: nothing is fetched").toEqual([]);
    for (const body of [...control.h.summary, ...control.h.posted]) expect(body, "control").not.toContain(HINT);

    const r = await hintRun({
      inputs: { policy: "auto", upload: "never" },
      policy: respond(404, apiFixture("installation-not-found.json")),
    });
    expect(policyGets(r.calls)).toHaveLength(1);
    expect(r.calls).toEqual(policyGets(r.calls));
    expect(r.h.summary).toHaveLength(1);
    expect(r.h.posted).toHaveLength(1);
    expect(hintBeforeFooter(r.h.summary[0] as string), "the summary").toBe(true);
    expect(hintBeforeFooter(r.h.posted[0] as string), "the comment").toBe(true);
    // Nothing else changes: the report, and the bodies without the hint and its empty line.
    expect(r.text).toBe(control.text);
    const withoutHint = (body: string) => body.replace(`${HINT}\n\n`, "");
    expect(r.h.summary.map(withoutHint)).toEqual(control.h.summary);
    expect(r.h.posted.map(withoutHint)).toEqual(control.h.posted);
  });

  it("policy required answered 404 with upload never: the hint is there beside the POLICY_UNAVAILABLE error", async () => {
    const r = await hintRun({ inputs: { policy: "required", upload: "never" }, policy: respond(404) });
    expect(r.report.messages.filter((m) => m.code === "POLICY_UNAVAILABLE")).toHaveLength(1);
    expect(r.report.verdict).toBe("fail");
    expect(hintBeforeFooter(r.h.summary[0] as string), "the summary").toBe(true);
    expect(hintBeforeFooter(r.h.posted[0] as string), "the comment").toBe(true);
  });

  it("a policy 204 (installed, no policy yet) and a policy 200 with an uploaded run get no hint", async () => {
    const noPolicy = await hintRun({ inputs: { policy: "auto", upload: "never" }, policy: respond(204) });
    expect(policyGets(noPolicy.calls), "204: the policy was asked for").toHaveLength(1);
    expect(noPolicy.h.posted, "204: the comment is posted").toHaveLength(1);
    for (const body of [...noPolicy.h.summary, ...noPolicy.h.posted]) expect(body, "204").not.toContain(HINT);

    const served = await hintRun({
      inputs: { policy: "auto" },
      policy: respond(200, apiFixture("envelope-valid.json")),
    });
    expect(served.report.meta?.upload, "200: the run is uploaded").toEqual({ status: "ok", runUrl: RUN_URL });
    expect(served.h.summary, "200: the summary is written").toHaveLength(1);
    expect(served.h.posted, "200: the app comments, pharn-ci does not").toEqual([]);
    expect(served.h.summary[0]).not.toContain(HINT);
  });

  it("a policy 404 and an upload 404 show the hint exactly once in the summary and in the comment", async () => {
    const r = await hintRun({
      inputs: { policy: "auto" },
      policy: respond(404, apiFixture("installation-not-found.json")),
      uploadUrl: respond(404, apiFixture("installation-not-found.json")),
    });
    expect(r.report.meta?.upload).toEqual({ status: "skipped" });
    expect(r.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(r.h.summary).toHaveLength(1);
    expect(r.h.posted).toHaveLength(1);
    for (const body of [...r.h.summary, ...r.h.posted]) expect(hintCount(body)).toBe(1);
    expect(hintBeforeFooter(r.h.summary[0] as string), "the summary").toBe(true);
    expect(hintBeforeFooter(r.h.posted[0] as string), "the comment").toBe(true);
  });
});
