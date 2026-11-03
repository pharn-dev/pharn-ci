import { afterEach, describe, expect, it, vi } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { APP_RETRY_WAIT_MS, APP_TIMEOUT_MS } from "../src/app-client.js";
import { commentScopeLine } from "../src/run.js";
import { UPLOAD_DEADLINE_MS } from "../src/upload.js";
import { BOT, type HarnessOptions, harness } from "./harness.js";

// Review findings 7 and 8 of the upload.
//
// 7: after an ok upload, the own marker comment an earlier run left on the pull request (with its old verdict) is
//    updated to a pointer at the run on pharn.dev, so the PR never shows pharn-ci's stale verdict beside the app's
//    comment. Nothing is created, other scopes are left alone, and a failed update is a warning only.
// 8: the whole upload ends within UPLOAD_DEADLINE_MS of its start. Each request and the PUT is cut off at the smaller
//    of its own timeout and the time left, the retry happens only when enough is left, and a step with no time left
//    does not start. The policy fetch, which passes no deadline, keeps its retry.
//
// No real time passes: the clock is a virtual one the fake app and the sleep move forward, and AbortSignal.timeout is
// replaced by a recorder that hands out a signal the fake app aborts itself when it "hangs" past the timeout.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "MED", "c0de", "7788"].join("-");
const START = new Date("2026-11-03T09:00:00.000Z").getTime();
const SIGNED = `https://${["bkt-m7", "blob-store", "example"].join(".")}/o/acme/m7-run.tgz?X-Sig=Zq8w2Lp0`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-11-03T09:15:00Z",
};
const MARKER = "<!-- pharn-ci -->";
const SCOPE = commentScopeLine("ci", "check");
const POINTER = `${MARKER}\n${SCOPE}\nThis run is reported by the Pharn GitHub App: ${RUN_URL}\n`;

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

type Report = { verdict: string; messages: unknown[]; meta?: Record<string, unknown> };
interface Outcome {
  status: string;
  reason?: string;
  runUrl?: string;
}
type Kind = "upload-url" | "put" | "runs" | "other";

/** How the fake app answers one request, given the timeout its attempt was started with. */
type Behaviour =
  | { kind: "answer"; status: number; body?: unknown; after: number | "just-before-timeout" | "at-timeout" }
  | { kind: "hang" };

interface Recorder {
  /** Virtual milliseconds since the start. */
  elapsed(): number;
  now(): Date;
  sleep(ms: number): Promise<void>;
  sleeps: number[];
  /** Every AbortSignal.timeout(ms) asked for, in order. */
  timeouts: number[];
  calls: Kind[];
  fetch(input: unknown, init?: RequestInit): Promise<Response>;
}

/**
 * A virtual clock, a recorded AbortSignal.timeout and a fake app and storage. Each kind of request gets its own
 * behaviours in turn (the last one repeats); "just-before-timeout" answers 1 ms before the attempt's timeout, and "hang"
 * moves the clock to the timeout, aborts the attempt's signal and rejects as fetch does.
 */
function recorder(behaviours: Partial<Record<Exclude<Kind, "other">, readonly Behaviour[]>> = {}): Recorder {
  let t = START;
  const timeouts: number[] = [];
  const controllers: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  const lists: Record<Exclude<Kind, "other">, readonly Behaviour[]> = {
    "upload-url": behaviours["upload-url"] ?? [{ kind: "answer", status: 200, body: UPLOAD_URL_OK, after: 0 }],
    put: behaviours.put ?? [{ kind: "answer", status: 200, after: 0 }],
    runs: behaviours.runs ?? [{ kind: "answer", status: 201, body: { url: RUN_URL }, after: 0 }],
  };
  const counts = { "upload-url": 0, put: 0, runs: 0 };
  const r: Recorder = {
    elapsed: () => t - START,
    now: () => new Date(t),
    sleeps: [],
    async sleep(ms) {
      r.sleeps.push(ms);
      t += ms;
    },
    timeouts,
    calls: [],
    async fetch(input, init) {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(String(input));
      const kind: Kind =
        method === "PUT"
          ? "put"
          : method === "POST" && url.origin === APP && url.pathname === "/api/v1/runs/upload-url"
            ? "upload-url"
            : method === "POST" && url.origin === APP && url.pathname === "/api/v1/runs"
              ? "runs"
              : "other";
      r.calls.push(kind);
      if (kind === "other") throw new TypeError("fetch failed");
      // The signal of this attempt is the last one handed out.
      const timeout = timeouts.at(-1) ?? Number.NaN;
      const controller = controllers.at(-1);
      if (init?.signal !== controller?.signal) throw new Error("the attempt's signal is not the last timeout's");
      counts[kind] += 1;
      const list = lists[kind];
      const b = list[Math.min(counts[kind], list.length) - 1] as Behaviour;
      if (b.kind === "hang") {
        t += timeout;
        controller?.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
        throw controller?.signal.reason;
      }
      t += b.after === "just-before-timeout" ? timeout - 1 : b.after === "at-timeout" ? timeout : b.after;
      const text = b.body === undefined ? null : JSON.stringify(b.body);
      return new Response(text, {
        status: b.status,
        ...(text === null ? {} : { headers: { "content-type": "application/json" } }),
      });
    },
  };
  return r;
}

afterEach(() => {
  vi.restoreAllMocks();
});

interface RunOptions {
  inputs?: Record<string, string>;
  harness?: HarnessOptions;
  behaviours?: Partial<Record<Exclude<Kind, "other">, readonly Behaviour[]>>;
  updateError?: Error;
}

async function actionRun(options: RunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    ...options.harness,
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: META_CONTEXT as never,
  });
  const { updateError } = options;
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    ...(updateError === undefined
      ? {}
      : {
          updateComment: async (id: number) => {
            h.apiCalls.push(`update ${id}`);
            throw updateError;
          },
        }),
  } as typeof h.deps.api;
  const app = recorder(options.behaviours);
  Object.assign(h.deps, {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: app.now,
    sleep: app.sleep,
  });
  const returned = await run(h.deps);
  vi.restoreAllMocks();
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, returned, app };
}

/** An own pharn-ci marker comment of this run's scope (ci/check) by the token's login, from an earlier run. */
const own = (id: number) => ({
  id,
  body: `${MARKER}\n${SCOPE}\n## ❌ pharn-ci: fail (an earlier run)`,
  user: { login: BOT.login },
  html_url: `https://github.com/acme/widgets/pull/7#issuecomment-${id}`,
});
/** The same bot's marker comment of another job's scope. */
const otherScope = (id: number) => ({
  id,
  body: `${MARKER}\n${commentScopeLine("ci", "lint")}\n## ❌ pharn-ci: fail (another job)`,
  user: { login: BOT.login },
  html_url: `https://github.com/acme/widgets/pull/7#issuecomment-${id}`,
});
const commentWrites = (apiCalls: string[]) => apiCalls.filter((c) => /^(create|update|delete) /.test(c));

let cachedReport: Promise<Report> | undefined;
/** report.json of the same run with the upload off: the report runUpload is given directly. */
function metaReport(): Promise<Report> {
  cachedReport ??= actionRun({ inputs: { upload: "never" } }).then((r) => r.report);
  return cachedReport;
}

async function directUpload(
  behaviours: Partial<Record<Exclude<Kind, "other">, readonly Behaviour[]>>,
  extra: { uploadDeadlineMs?: number } = {},
) {
  const { runUpload } = (await import("../src/upload.js")) as unknown as {
    runUpload(deps: unknown, input: unknown): Promise<Outcome>;
  };
  const report = await metaReport();
  const app = recorder(behaviours);
  const warnings: string[] = [];
  const deps = {
    fetch: app.fetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: app.now,
    sleep: app.sleep,
    info: () => {},
    warning: (m: string) => warnings.push(m),
    ...extra,
  };
  const outcome = await runUpload(deps, { choice: "auto", report, appOrigin: new URL(APP) });
  return { outcome, app, warnings };
}

const slow503: Behaviour = { kind: "answer", status: 503, after: "just-before-timeout" };

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("review finding 7: an ok upload turns the earlier own comment into a pointer", { timeout: 120_000 }, () => {
  it("an own comment of this scope is updated to the pointer with the run URL, with the one comment lookup the upload made, and nothing is posted", async () => {
    const r = await actionRun({ harness: { existingComments: [own(5)] as never } });
    expect(r.report.meta?.upload).toEqual({ status: "ok", runUrl: RUN_URL });
    expect(commentWrites(r.h.apiCalls)).toEqual(["update 5"]);
    expect(r.h.posted).toEqual([POINTER]);
    expect(r.h.posted[0]).toContain(RUN_URL);
    expect(r.h.comments.find((c) => c.id === 5)?.body).toBe(POINTER);
    expect(r.h.comments.map((c) => c.id)).toEqual([5]);
    expect(r.h.apiCalls.filter((c) => c.startsWith("list "))).toHaveLength(1);
    expect(r.h.warnings).toEqual([]);
    expect(r.h.failed).toEqual([]);
  });

  it("no own comment (or the comment input off) means no create, no update and no delete", async () => {
    const human = { id: 3, body: "a human comment", user: { login: "octocat" } };
    const cases: Array<[string, RunOptions]> = [
      ["no comments", {}],
      ["only a human comment", { harness: { existingComments: [human] as never } }],
      ["only another scope's comment", { harness: { existingComments: [otherScope(6)] as never } }],
      ["comment input false", { inputs: { comment: "false" }, harness: { existingComments: [own(5)] as never } }],
    ];
    for (const [name, options] of cases) {
      const r = await actionRun(options);
      expect(r.report.meta?.upload, name).toEqual({ status: "ok", runUrl: RUN_URL });
      expect(commentWrites(r.h.apiCalls), name).toEqual([]);
      expect(r.h.posted, name).toEqual([]);
    }
  });

  it("another scope's comment is untouched while this scope's own comment becomes the pointer", async () => {
    const r = await actionRun({ harness: { existingComments: [otherScope(4), own(5)] as never } });
    expect(commentWrites(r.h.apiCalls)).toEqual(["update 5"]);
    expect(r.h.comments.find((c) => c.id === 4)?.body).toBe(otherScope(4).body);
    expect(r.h.comments.find((c) => c.id === 5)?.body).toBe(POINTER);
  });

  it("an update that throws is one warning; the verdict, the outputs and the step's result are those of a run with nothing to update", async () => {
    const control = await actionRun();
    const r = await actionRun({
      harness: { existingComments: [own(5)] as never },
      updateError: new Error("Resource not accessible by integration"),
    });
    expect(r.h.apiCalls.filter((c) => /^(create|delete) /.test(c))).toEqual([]);
    expect(r.h.warnings.filter((w) => /could not update the earlier pharn-ci comment/.test(w))).toHaveLength(1);
    expect(r.h.failed).toEqual(control.h.failed);
    expect(r.report.verdict).toBe(control.report.verdict);
    expect(r.report.messages).toEqual(control.report.messages);
    expect(r.h.outputs.verdict).toBe(control.h.outputs.verdict);
    expect(r.h.outputs["run-url"]).toBe(RUN_URL);
    expect(r.returned).toEqual(control.returned);
  });
});

describe("review finding 8: the upload has one overall deadline", { timeout: 120_000 }, () => {
  it("an app that answers 503 just before every attempt's timeout: the upload is failed within the deadline, and the check's verdict and exit are unchanged", async () => {
    const d = await directUpload({ "upload-url": [slow503], put: [slow503], runs: [slow503] });
    expect(d.outcome.status).toBe("failed");
    expect(d.app.elapsed()).toBeLessThanOrEqual(UPLOAD_DEADLINE_MS);
    // The retry ran, and its attempt was cut off at what was left of the deadline, not at its own timeout.
    expect(d.app.calls).toEqual(["upload-url", "upload-url"]);
    expect(d.app.sleeps).toEqual([APP_RETRY_WAIT_MS]);
    const [first = 0, second = 0] = d.app.timeouts;
    expect(second).toBe(UPLOAD_DEADLINE_MS - (first - 1) - APP_RETRY_WAIT_MS);
    expect(second).toBeLessThan(first);
    expect(d.warnings).toEqual([
      "pharn-ci: the run was not uploaded to pharn.dev (failed: upload-url:status-503); the check is not affected",
    ]);

    const control = await actionRun({ inputs: { upload: "never" } });
    const r = await actionRun({ behaviours: { "upload-url": [slow503], put: [slow503], runs: [slow503] } });
    expect(r.app.elapsed()).toBeLessThanOrEqual(UPLOAD_DEADLINE_MS);
    expect(r.report.meta?.upload).toEqual({ status: "failed" });
    expect(r.report.verdict).toBe(control.report.verdict);
    expect(r.report.messages).toEqual(control.report.messages);
    expect(r.h.outputs.verdict).toBe(control.h.outputs.verdict);
    expect(r.h.failed).toEqual(control.h.failed);
    expect(r.h.posted).toEqual(control.h.posted);
  });

  it("the retry is skipped when the wait and a minimal attempt no longer fit (the deadline is injectable)", async () => {
    const d = await directUpload({ "upload-url": [slow503] }, { uploadDeadlineMs: 61_500 });
    expect(d.outcome).toEqual({ status: "failed", reason: "upload-url:status-503" });
    expect(d.app.calls).toEqual(["upload-url"]);
    expect(d.app.sleeps).toEqual([]);
    expect(d.app.elapsed()).toBeLessThanOrEqual(61_500);
  });

  it("the PUT is cut off at the time left, and running out there is put:deadline", async () => {
    const d = await directUpload({
      "upload-url": [{ kind: "answer", status: 200, body: UPLOAD_URL_OK, after: 30_000 }],
      put: [{ kind: "hang" }],
    });
    expect(d.outcome).toEqual({ status: "failed", reason: "put:deadline" });
    expect(d.app.calls).toEqual(["upload-url", "put"]);
    expect(d.app.timeouts[1]).toBe(UPLOAD_DEADLINE_MS - 30_000);
    expect(d.app.elapsed()).toBe(UPLOAD_DEADLINE_MS);
  });

  it("a step with no time left does not start: a PUT that ends at the deadline gives runs:deadline and no runs request", async () => {
    const d = await directUpload({ put: [{ kind: "answer", status: 201, after: "at-timeout" }] });
    expect(d.app.timeouts[1]).toBe(UPLOAD_DEADLINE_MS);
    expect(d.outcome).toEqual({ status: "failed", reason: "runs:deadline" });
    expect(d.app.calls).toEqual(["upload-url", "put"]);
    expect(d.app.elapsed()).toBe(UPLOAD_DEADLINE_MS);
  });

  it("the policy fetch, which passes no deadline, keeps its retry and its per-attempt timeout", async () => {
    const { fetchPolicy } = await import("../src/policy-fetch.js");
    const { appRequest } = await import("../src/app-client.js");
    const app = recorder();
    let policyCalls = 0;
    const fetch = async (_input: unknown, init?: RequestInit): Promise<Response> => {
      policyCalls += 1;
      expect(init?.method).toBe("GET");
      // An answer just before the attempt's timeout, on the virtual clock.
      await app.sleep(APP_TIMEOUT_MS - 1);
      return new Response(null, { status: 503 });
    };
    const deps = {
      fetch,
      getIDToken: async () => TOKEN,
      setSecret: () => {},
      hasOidcEnv: true,
      now: app.now,
      sleep: app.sleep,
      info: () => {},
      warning: () => {},
      timeoutMs: undefined,
    };
    const policy = await fetchPolicy(deps as never, {
      mode: "auto",
      origin: new URL(APP),
      repository: "acme/widgets",
    });
    expect(policy.source).toBe("none");
    expect(policyCalls).toBe(2);
    expect(app.timeouts).toEqual([APP_TIMEOUT_MS, APP_TIMEOUT_MS]);
    expect(app.sleeps).toEqual([APP_TIMEOUT_MS - 1, APP_RETRY_WAIT_MS, APP_TIMEOUT_MS - 1]);

    // appRequest itself: no remainingMs, no deadline; a remainingMs with nothing left starts no attempt.
    policyCalls = 0;
    const url = new URL("/api/v1/policy?repo=acme/widgets", APP);
    expect(await appRequest(deps as never, { url, token: TOKEN })).toMatchObject({ kind: "response", status: 503 });
    expect(policyCalls).toBe(2);
    policyCalls = 0;
    expect(await appRequest(deps as never, { url, token: TOKEN, remainingMs: () => 0 })).toEqual({ kind: "timeout" });
    expect(policyCalls).toBe(0);
  });
});
