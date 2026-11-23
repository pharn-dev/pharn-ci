import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";
import { harness } from "./harness.js";

// One version stamp (CORE-146): the root package.json is the one source of the version. scripts/bundle.mjs and
// vitest.config.ts define it for packages/core/src/version.ts, which holds no literal. A whole Action run with the
// upload on (an in-memory harness, a fake OIDC token and a fake fetch that answers the pharn.dev and storage calls; no
// network) must report that one string in report.json `tool.version`, in the uploaded meta.json `tool.version` and in
// the User-Agent of every request. run() is loaded inside the test body.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

const APP = "https://pharn.dev";
const SIGNED = "https://storage.invalid/o/run.tgz?sig=1";
const CONTEXT = {
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

interface Call {
  method: string;
  url: string;
  userAgent: string | null;
  body: unknown;
}

/** The entries of a ustar archive: name and UTF-8 contents, in order, up to the first zero block. */
function untar(bytes: Uint8Array): Map<string, string> {
  const entries = new Map<string, string>();
  let at = 0;
  while (at + 512 <= bytes.length) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = Buffer.from(header.subarray(0, 100)).toString("latin1").replace(/\0+$/, "");
    const size = Number.parseInt(Buffer.from(header.subarray(124, 135)).toString("latin1"), 8);
    entries.set(name, Buffer.from(bytes.subarray(at + 512, at + 512 + size)).toString("utf8"));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("one version stamp", { timeout: 60_000 }, () => {
  it("packages/core/src/version.ts holds no version literal", () => {
    expect(read("packages/core/src/version.ts")).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it("report.json tool.version, the uploaded meta.json tool.version and every User-Agent carry the root package.json version", async () => {
    const version: string = JSON.parse(read("package.json")).version;
    expect(version, "control: the root package.json has an X.Y.Z version").toMatch(/^\d+\.\d+\.\d+$/);

    const calls: Call[] = [];
    const fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = String(input);
      calls.push({ method, url, userAgent: new Headers(init?.headers).get("user-agent"), body: init?.body ?? null });
      if (method === "PUT" && url === SIGNED) return new Response(null, { status: 200 });
      if (method === "POST" && url === `${APP}/api/v1/runs/upload-url`) {
        const answer = {
          uploadUrl: SIGNED,
          objectKey: "runs/9.tar.gz",
          maxBytes: 10_485_760,
          expiresAt: "2099-01-01T00:00:00Z",
        };
        return Response.json(answer);
      }
      if (method === "POST" && url === `${APP}/api/v1/runs`)
        return Response.json({ url: `${APP}/acme/widgets/runs/9` }, { status: 201 });
      throw new TypeError("fetch failed");
    };

    const { run } = await import("../src/run.js");
    const h = harness({ inputs: { threshold: "50", policy: "never", upload: "auto" }, context: CONTEXT as never });
    h.deps.api = {
      ...h.deps.api,
      listPullRequestCommits: async () => ({ commits: [], hasNext: false }),
    } as typeof h.deps.api;
    Object.assign(h.deps, {
      fetch,
      getIDToken: async () => "oidc-test-token",
      setSecret: () => {},
      hasOidcEnv: true,
      now: () => new Date("2026-11-23T12:00:00.000Z"),
      sleep: async () => {},
    });
    await run(h.deps);

    const text = h.written[h.outputs["report-path"] ?? ""];
    if (text === undefined) throw new Error(`no report.json was written; failed: ${JSON.stringify(h.failed)}`);
    const report = JSON.parse(text) as { tool: { version: string }; meta?: { upload?: { status?: string } } };
    expectValidReport(report);
    expect(report.tool.version, "report.json tool.version").toBe(version);
    expect(report.meta?.upload?.status, "control: the upload ran").toBe("ok");

    expect(
      calls.map((c) => `${c.method} ${c.url}`),
      "control: the three upload requests",
    ).toEqual([`POST ${APP}/api/v1/runs/upload-url`, `PUT ${SIGNED}`, `POST ${APP}/api/v1/runs`]);
    for (const call of calls) expect(call.userAgent, `${call.method} ${call.url}`).toBe(`pharn-ci/${version}`);

    const put = calls[1] as Call;
    if (!(put.body instanceof Uint8Array)) throw new Error("the PUT body is not bytes");
    const metaJson = untar(gunzipSync(put.body)).get("meta.json");
    if (metaJson === undefined) throw new Error("the upload holds no meta.json");
    expect((JSON.parse(metaJson) as { tool: { version: string } }).tool.version, "meta.json tool.version").toBe(
      version,
    );
  });
});
