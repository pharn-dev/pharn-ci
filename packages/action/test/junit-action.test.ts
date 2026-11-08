import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { fixture, harness, WORKSPACE } from "./harness.js";

// Flaky tests (A6) in the Action: the junit-paths input, the app's quarantine list, and the normalised
// junit/results.xml in the upload. The in-memory harness gets a directory listing built from its files, so the JUnit
// globs walk it; a fake app answers the policy GET, the upload-url, the PUT and the runs request. No real network.

const APP = "https://pharn.dev";
const TOKEN = ["oidc", "JUNIT", "beef", "6001"].join("-");
const NOW = new Date("2026-11-08T12:00:00.000Z");
const SIGNED = `https://${["bkt-j6", "blob-store", "example"].join(".")}/o/acme/run.tgz?X-Sig=Q1w2`;
const RUN_URL = `${APP}/acme/widgets/runs/9-1`;

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

const envelope = (settings: { uploadJunit: boolean }, policy: Record<string, unknown> = { version: 1 }) => ({
  version: 7,
  etag: "sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
  updatedAt: "2026-11-08T10:00:00Z",
  policy,
  quarantine: ["api.users::creates a user"],
  settings: { uploadJunit: settings.uploadJunit, redactMessages: true, messageMaxBytes: 2048 },
});

type Report = {
  verdict: string;
  messages: { level: string; code: string; text: string }[];
  flaky?: {
    uploaded: boolean;
    testCount: number;
    failed: number;
    quarantined: string[];
    quarantinedFailures: number;
    unquarantinedFailures: number;
  };
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeApp(answer: unknown) {
  const calls: Call[] = [];
  const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const call = { url: String(input), method: (init?.method ?? "GET").toUpperCase(), body: init?.body ?? null };
    calls.push(call);
    if (call.method === "PUT") return new Response(null, { status: 200 });
    const path = new URL(call.url).pathname;
    if (path === "/api/v1/policy") return json(200, answer);
    if (path === "/api/v1/runs/upload-url") {
      return json(200, {
        uploadUrl: SIGNED,
        objectKey: "runs/acme/widgets/9-1.tar.gz",
        maxBytes: 31_457_280,
        expiresAt: "2026-11-08T12:15:00Z",
      });
    }
    if (path === "/api/v1/runs") return json(201, { url: RUN_URL });
    throw new TypeError("fetch failed");
  };
  return { fetch, calls };
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

/** A directory listing of the harness's files: each workspace path's directories and files, symbolic links as named. */
function listDirOf(files: Record<string, string>, symlinks: string[] = []) {
  return async (dir: string) => {
    const prefix = `${dir.replace(/\/$/, "")}/`;
    const entries = new Map<string, "file" | "directory" | "symlink">();
    for (const path of [...Object.keys(files), ...symlinks]) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      entries.set(name, slash !== -1 ? "directory" : symlinks.includes(path) ? "symlink" : "file");
    }
    return entries.size === 0 ? null : [...entries].map(([name, kind]) => ({ name, kind }));
  };
}

async function actionRun(options: {
  inputs: Record<string, string>;
  files?: Record<string, string>;
  symlinks?: string[];
  app?: unknown;
}) {
  const { run } = await import("../src/run.js");
  const h = harness({
    inputs: { policy: options.app === undefined ? "never" : "auto", ...options.inputs },
    files: options.files ?? {},
    context: META_CONTEXT as never,
  });
  h.deps.api = {
    ...h.deps.api,
    listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
  } as typeof h.deps.api;
  const allFiles = { [`${WORKSPACE}/coverage/lcov.info`]: fixture("golden/coverage.info"), ...options.files };
  const app = options.app === undefined ? undefined : fakeApp(options.app);
  Object.assign(h.deps, {
    listDir: listDirOf(allFiles, options.symlinks),
    ...(app === undefined
      ? {}
      : { fetch: app.fetch, getIDToken: async () => TOKEN, setSecret: () => {}, hasOidcEnv: true, now: () => NOW }),
    sleep: async () => {},
  });
  const returned = await run(h.deps);
  const written = h.written[h.outputs["report-path"] ?? ""];
  if (written === undefined) throw new Error(`no report was written; failed: ${JSON.stringify(h.failed)}`);
  const report = JSON.parse(written) as Report;
  expectValidReport(report);
  return { h, report, returned, app };
}

const FAILING = { [`${WORKSPACE}/reports/junit/api.xml`]: fixture("junit/failing.xml") };

describe("action: JUnit results", { timeout: 120_000 }, () => {
  it("reads the junit-paths glob, fills flaky and the Flaky section, and never fails for a failed test", async () => {
    const { h, report } = await actionRun({ inputs: { "junit-paths": "reports/**/*.xml" }, files: FAILING });
    expect(report.flaky).toEqual({
      uploaded: false,
      testCount: 3,
      failed: 2,
      quarantined: [],
      quarantinedFailures: 0,
      unquarantinedFailures: 2,
    });
    expect(h.failed).toEqual([]);
    expect(h.infos).toContain("pharn-ci: read 1 JUnit XML file(s) with 3 test case(s)");
    expect(h.summary[0]).toContain("### 🧫 Flaky\n\n3 tests · 2 failed · 0 of 2 failures quarantined");
  });

  it("adds nothing without junit-paths", async () => {
    const { report, h } = await actionRun({ inputs: {}, files: FAILING });
    expect(report.flaky).toBeUndefined();
    expect(report.messages.some((m) => m.code.startsWith("JUNIT_"))).toBe(false);
    expect(h.infos.some((line) => line.includes("JUnit"))).toBe(false);
  });

  it("warns JUNIT_NOT_FOUND when nothing matched, and never reads through a symbolic link", async () => {
    const { report } = await actionRun({
      inputs: { "junit-paths": "reports/linked.xml" },
      files: {},
      symlinks: [`${WORKSPACE}/reports/linked.xml`],
    });
    expect(report.messages.filter((m) => m.code.startsWith("JUNIT_")).map((m) => [m.level, m.code])).toEqual([
      ["warn", "JUNIT_NOT_FOUND"],
    ]);
    expect(report.flaky).toBeUndefined();
  });

  it("refuses a pattern outside the workspace before anything is read", async () => {
    const { run } = await import("../src/run.js");
    for (const pattern of ["../other/*.xml", "/etc/junit.xml"]) {
      const h = harness({ inputs: { "junit-paths": pattern, policy: "never" } });
      await run(h.deps);
      expect(h.failed).toHaveLength(1);
      expect(h.failed[0]).toContain('junit-paths "');
      expect(h.outputs["report-path"]).toBeUndefined();
    }
  });

  it("applies the app's quarantine list and uploads the normalised results, then says flaky.uploaded", async () => {
    const { report, app } = await actionRun({
      inputs: { "junit-paths": "reports/junit/api.xml" },
      files: FAILING,
      app: envelope({ uploadJunit: true }),
    });
    expect(report.flaky?.quarantined).toEqual(["api.users::creates a user"]);
    expect(report.flaky?.quarantinedFailures).toBe(1);
    expect(report.flaky?.unquarantinedFailures).toBe(1);
    expect(report.flaky?.uploaded).toBe(true);
    expect(report.messages.map((m) => m.code)).toContain("FLAKY_QUARANTINED_FAILURES");

    const calls = app?.calls ?? [];
    const urlCall = calls.find((c) => c.url.endsWith("/api/v1/runs/upload-url"));
    const sizes = (JSON.parse(String(urlCall?.body)) as { sizes: { report: number; junit: number } }).sizes;
    expect(sizes.junit).toBeGreaterThan(0);
    const putBody = calls.find((c) => c.method === "PUT")?.body as Uint8Array;
    const entries = untar(gunzipSync(putBody));
    expect(entries.map((e) => e.name)).toEqual(["report.json", "meta.json", "junit/results.xml"]);
    expect(sizes.report).toBe(putBody.byteLength);
    const xml = entries[2]?.text ?? "";
    expect(xml).toContain(
      '<testcase id="api.users::creates a user" classname="api.users" name="creates a user" time="0.4">',
    );
    expect(xml).toContain('<failure message="timeout after 5000 ms"/>');
    const uploaded = JSON.parse(entries[0]?.text ?? "") as Report;
    expect(uploaded.flaky?.uploaded).toBe(true);
  });

  it("keeps the results out of the upload when the org sets uploadJunit to false, and quarantine off by policy", async () => {
    const { report, app } = await actionRun({
      inputs: { "junit-paths": "reports/junit/api.xml" },
      files: FAILING,
      app: envelope({ uploadJunit: false }, { version: 1, flaky: { quarantine: false } }),
    });
    expect(report.flaky?.uploaded).toBe(false);
    expect(report.flaky?.quarantinedFailures).toBe(0);
    const calls = app?.calls ?? [];
    const urlCall = calls.find((c) => c.url.endsWith("/api/v1/runs/upload-url"));
    expect((JSON.parse(String(urlCall?.body)) as { sizes: { junit: number } }).sizes.junit).toBe(0);
    const put = calls.find((c) => c.method === "PUT");
    expect(untar(gunzipSync(put?.body as Uint8Array)).map((e) => e.name)).toEqual(["report.json", "meta.json"]);
  });
});
