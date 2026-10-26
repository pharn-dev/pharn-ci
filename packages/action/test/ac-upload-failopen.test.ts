import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// run() is loaded inside the test body: the AC test is written before the upload step exists, so nothing the build
// adds may run while this file loads. The Action runs against the in-memory harness plus injected app deps: a fake
// fetch that answers the app and storage calls with a successful upload, a fake getIDToken and setSecret, the OIDC-env
// flag, a recorded sleep, and a clock (`now`) that throws, which is the unexpected exception inside the upload.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "UPL", "f00d", "4422"].join("-");
const SIGNED = `https://${["bkt-q7z", "blob-store", "example"].join(".")}/o/acme/zz91-run.tgz?X-Sig=Kp4r9Qe1`;
const EXCEPTION = ["clock", "exploded", "q93"].join("-");
const PHRASE = "uploaded to pharn.dev";

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

async function throwingClockRun(inputs: Record<string, string>) {
  const { run } = await import("../src/run.js");
  const h = harness({ inputs: { policy: "never", ...inputs }, context: META_CONTEXT as never });
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
    now: () => {
      throw new Error(EXCEPTION);
    },
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as Report;
  expectValidReport(report);
  return { h, report, calls: app.calls };
}

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("the upload fails open", { timeout: 60_000 }, () => {
  it("AC-30: an unexpected exception inside the upload ends failed/internal with one fixed warning, and the step's pass or fail is that of the run without the upload", async () => {
    // A passing report: not failed.
    const passing = await throwingClockRun({ threshold: "50" });
    expect(passing.report.verdict).toBe("pass");
    const lines = passing.h.warnings.filter((w) => w.includes(PHRASE));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("(failed: internal");
    expect(lines[0]).toMatch(/check is not affected/);
    for (const line of [...passing.h.warnings, ...passing.h.infos, ...passing.h.failed]) {
      expect(line).not.toContain(EXCEPTION);
    }
    expect(passing.report.meta?.upload).toEqual({ status: "failed" });
    expect(passing.h.failed).toEqual([]);
    expect(Object.hasOwn(passing.h.outputs, "run-url")).toBe(false);

    // A failing report with fail-on-threshold: failed exactly as the run with the upload off.
    const failing = await throwingClockRun({ threshold: "80", "fail-on-threshold": "true" });
    const off = await throwingClockRun({ threshold: "80", "fail-on-threshold": "true", upload: "never" });
    expect(failing.report.verdict).toBe("fail");
    expect(off.h.failed.length, "control: the run with the upload off is failed").toBeGreaterThan(0);
    expect(failing.h.failed).toEqual(off.h.failed);
    const failingLines = failing.h.warnings.filter((w) => w.includes(PHRASE));
    expect(failingLines).toHaveLength(1);
    expect(failingLines[0]).toContain("(failed: internal");
    expect(failingLines[0]).not.toContain(EXCEPTION);
  });
});
