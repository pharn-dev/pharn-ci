import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { APP_POINTER_LINE, commentScopeLine } from "../src/run.js";
import { BOT, type HarnessOptions, harness } from "./harness.js";

// CORE-119 (BACKLOG gap 7): after an ok upload the Action skips its own comment only when the app's answer to
// `POST /api/v1/runs` carries a usable `commentUrl` (a string that is an https URL of at most 2048 characters). A null,
// an absent field (an older app) or a malformed value means the App did not comment, and the Action posts or updates
// its own comment exactly as a run without an upload does. With the `comment` input off nothing is posted in any case,
// and the value never reaches a log line, the report, the comment, the summary or an output.
//
// run() runs against the in-memory harness with a fake fetch that answers the app and storage calls.

const APP = "https://pharn.dev";
const TOKEN = ["oidc", "CMT", "beef", "1190"].join("-");
const NOW = new Date("2026-11-22T12:00:00.000Z");
const SIGNED = `https://${["bkt-c119", "blob-store", "example"].join(".")}/o/acme/c119-run.tgz?X-Sig=Zq8w2Rt5`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;
/** The app's comment URL: a canary that must never be written anywhere by the Action. */
const APP_COMMENT = `https://github.com/acme/widgets/pull/7#issuecomment-${["9182", "7364", "5119"].join("")}`;
const UPLOAD_URL_OK = {
  uploadUrl: SIGNED,
  objectKey: "runs/acme/widgets/9-1.tar.gz",
  maxBytes: 10_485_760,
  expiresAt: "2026-11-22T12:15:00Z",
};
const MARKER = "<!-- pharn-ci -->";
const SCOPE_LINE = commentScopeLine("ci", "check");
const POINTER = `${MARKER}\n${SCOPE_LINE}\n${APP_POINTER_LINE} ${RUN_URL}\n`;

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

/** The JSON body of the app's answer to `POST /api/v1/runs`; the upload-url and storage answers always succeed. */
type RunsBody = Record<string, unknown>;

function fakeApp(runsBody: RunsBody) {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  return async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "PUT") return new Response(null, { status: 200 });
    if (method === "POST" && url.origin === APP && url.pathname === "/api/v1/runs/upload-url") {
      return json(200, UPLOAD_URL_OK);
    }
    if (method === "POST" && url.origin === APP && url.pathname === "/api/v1/runs") return json(201, runsBody);
    throw new TypeError("fetch failed");
  };
}

/** An own pharn-ci marker comment of this run's scope that an earlier run left. */
const earlier = () => ({
  id: 5,
  body: `${MARKER}\n${SCOPE_LINE}\n## ✅ pharn-ci: pass (an earlier run)`,
  user: { login: BOT.login },
  html_url: "https://github.com/acme/widgets/pull/7#issuecomment-5",
});

interface RunOptions {
  runs?: RunsBody;
  inputs?: Record<string, string>;
  existing?: boolean;
  harness?: HarnessOptions;
}

async function actionRun(options: RunOptions = {}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    ...options.harness,
    inputs: { threshold: "50", policy: "never", ...options.inputs },
    context: META_CONTEXT as never,
    ...(options.existing === true ? { existingComments: [earlier()] as never } : {}),
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  Object.assign(h.deps, {
    fetch: fakeApp(options.runs ?? { url: RUN_URL }),
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => NOW,
    sleep: async () => {},
  });
  await run(h.deps);
  const text = h.written[h.outputs["report-path"] ?? ""];
  if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(text) as { meta?: { upload?: unknown } };
  expectValidReport(report);
  return { h, report };
}

/** Everything the run wrote that a reader can see: logs, outputs, files, comments and the summary. */
function everythingWritten(h: Awaited<ReturnType<typeof actionRun>>["h"]): string {
  return JSON.stringify([h.infos, h.warnings, h.failed, h.outputs, h.written, h.posted, h.summary]);
}

const commentCalls = (calls: string[]) => calls.filter((c) => /^(create|update|delete) /.test(c));

/** The body of the app's runs answer in fixtures/upload/responses/runs-created.json: an older app's, with no commentUrl. */
const CREATED = JSON.parse(
  (
    JSON.parse(
      readFileSync(new URL("../../../fixtures/upload/responses/runs-created.json", import.meta.url), "utf8"),
    ) as { body: string }
  ).body,
) as RunsBody;

const NOT_COMMENTED: Array<[string, RunsBody]> = [
  ["the fixture answer, which has no commentUrl (an older app)", CREATED],
  ["the app's answer after a GitHub failure", { ...CREATED, commentUrl: null, commentSkipped: "github_failed" }],
  ["commentUrl null", { url: RUN_URL, commentUrl: null }],
  ["commentUrl absent", { url: RUN_URL }],
  ["commentUrl a number", { url: RUN_URL, commentUrl: 5 }],
  ["commentUrl an object", { url: RUN_URL, commentUrl: { href: APP_COMMENT } }],
  ["commentUrl true", { url: RUN_URL, commentUrl: true }],
  ["commentUrl an empty string", { url: RUN_URL, commentUrl: "" }],
  ["commentUrl http:", { url: RUN_URL, commentUrl: APP_COMMENT.replace("https:", "http:") }],
  ["commentUrl another scheme", { url: RUN_URL, commentUrl: "javascript:alert(1)" }],
  ["commentUrl not a URL", { url: RUN_URL, commentUrl: "https://" }],
  ["commentUrl with a user name", { url: RUN_URL, commentUrl: APP_COMMENT.replace("https://", "https://u:p@") }],
  ["commentUrl with a space", { url: RUN_URL, commentUrl: `${APP_COMMENT} x` }],
  [
    "commentUrl over 2048 characters",
    { url: RUN_URL, commentUrl: `${APP_COMMENT}${"0".repeat(2049 - APP_COMMENT.length)}` },
  ],
];

// The first test of a file loads run() cold, which can take seconds on a loaded host.
describe("CORE-119: an uploaded run without an app comment keeps the Action's comment", { timeout: 120_000 }, () => {
  it("an https commentUrl: no own comment is created, and an earlier own comment becomes the pointer", async () => {
    const fresh = await actionRun({ runs: { url: RUN_URL, commentUrl: APP_COMMENT } });
    expect(fresh.report.meta?.upload).toEqual({ status: "ok", runUrl: RUN_URL });
    expect(fresh.h.outputs["run-url"]).toBe(RUN_URL);
    expect(commentCalls(fresh.h.apiCalls), "nothing to point, nothing created").toEqual([]);
    expect(fresh.h.posted).toEqual([]);
    expect(fresh.h.infos).toContain(
      "pharn-ci: the Pharn GitHub App comments on the pull request for this run, so pharn-ci posts no comment",
    );

    // The fixture answer plus the comment the App posted.
    expect(CREATED.url).toBe(RUN_URL);
    const pointed = await actionRun({ runs: { ...CREATED, commentUrl: APP_COMMENT }, existing: true });
    expect(commentCalls(pointed.h.apiCalls)).toEqual(["update 5"]);
    expect(pointed.h.posted).toEqual([POINTER]);

    // A comment URL of exactly 2048 characters is still a URL.
    const longest = `${APP_COMMENT}${"0".repeat(2048 - APP_COMMENT.length)}`;
    expect(longest).toHaveLength(2048);
    const edge = await actionRun({ runs: { url: RUN_URL, commentUrl: longest }, existing: true });
    expect(edge.h.posted).toEqual([POINTER]);

    for (const r of [fresh, pointed, edge]) expect(everythingWritten(r.h)).not.toContain("issuecomment-9182");
  });

  it("commentUrl null, absent or malformed: the Action posts its own comment, or updates its earlier one, as a run without an upload does", async () => {
    const control = await actionRun({ inputs: { upload: "never" } });
    expect(control.h.posted).toHaveLength(1);
    const controlBody = control.h.posted[0] as string;
    expect(controlBody.startsWith(`${MARKER}\n${SCOPE_LINE}\n`)).toBe(true);
    const controlUpdate = await actionRun({ inputs: { upload: "never" }, existing: true });
    expect(commentCalls(controlUpdate.h.apiCalls)).toEqual(["update 5"]);

    for (const [name, runs] of NOT_COMMENTED) {
      const created = await actionRun({ runs });
      expect(created.report.meta?.upload, `${name}: the upload still ends ok`).toEqual({
        status: "ok",
        runUrl: RUN_URL,
      });
      expect(created.h.outputs["run-url"], name).toBe(RUN_URL);
      expect(commentCalls(created.h.apiCalls), `${name}: one comment is created`).toEqual(["create 7"]);
      expect(created.h.posted, `${name}: the full report, as without an upload`).toEqual([controlBody]);
      expect(created.h.infos, name).toContain(
        "pharn-ci: the Pharn GitHub App did not comment on the pull request for this run, so pharn-ci does",
      );

      const updated = await actionRun({ runs, existing: true });
      expect(commentCalls(updated.h.apiCalls), `${name}: the earlier comment is updated`).toEqual(["update 5"]);
      expect(updated.h.posted, `${name}: with the report, not the pointer`).toEqual(controlUpdate.h.posted);
      expect(updated.h.posted.join("\n"), name).not.toContain(APP_POINTER_LINE);

      for (const r of [created, updated]) expect(everythingWritten(r.h), name).not.toContain("issuecomment-9182");
    }
  });

  it("with the comment input off nothing is posted or updated, whatever the answer says", async () => {
    const answers: Array<[string, RunsBody]> = [
      ["commentUrl https", { url: RUN_URL, commentUrl: APP_COMMENT }],
      ...NOT_COMMENTED,
    ];
    for (const [name, runs] of answers) {
      const r = await actionRun({ runs, inputs: { comment: "false" }, existing: true });
      expect(r.report.meta?.upload, name).toEqual({ status: "ok", runUrl: RUN_URL });
      expect(commentCalls(r.h.apiCalls), name).toEqual([]);
      expect(r.h.posted, name).toEqual([]);
      expect(everythingWritten(r.h), name).not.toContain("issuecomment-9182");
    }
  });
});
