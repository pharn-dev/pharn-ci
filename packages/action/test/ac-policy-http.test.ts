import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";
import { APP_MAX_BODY_BYTES, type AppClientDeps, appRequest } from "../src/app-client.js";
import { fetchPolicy } from "../src/policy-fetch.js";
import { runUpload } from "../src/upload.js";

// The HTTP contract of the pharn.dev client against Node's real fetch (undici), not a fake one. Every case starts
// node:http servers on 127.0.0.1 (port 0) and hands the client the global fetch; nothing leaves the loopback address.
// The other tests drive every status through an injected fake fetch, so what is proven here is what only the real
// stack can show: a redirect is not followed (the OIDC bearer token never reaches a second host), the timeout aborts a
// request that never answers, and the body cap stops reading a long body. Each redirect status is checked: undici
// follows a 301, 302 or 303 of a GET and a 307 or 308 of a POST with a string body. The upload's signed URL must be https, so
// the upload cases pass a fetch that only rewrites the two https hosts below to the loopback servers and hands the
// client's own RequestInit to the real fetch unchanged. Timeouts are small and injected; the only wall-clock assertion
// is a loose ceiling.

const ROOT = new URL("../../../", import.meta.url);
const ENVELOPE = readFileSync(new URL("fixtures/policy-api/envelope-valid.json", ROOT), "utf8");

/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "HTTP", "c0ffee", "7781"].join("-");
const REPO = "acme/widgets";
const NOW = new Date("2026-11-03T12:00:00.000Z");
/** A timeout that is short for a loopback request that never answers, and long for one that does. */
const SHORT_TIMEOUT_MS = 300;
/** The loose ceiling on a request that should end at SHORT_TIMEOUT_MS; CI under coverage is several times slower. */
const CEILING_MS = 20_000;
const APP_HOST = "app.http-contract.test";
const STORAGE_HOST = "storage.http-contract.test";

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

interface TestServer {
  origin: string;
  /** Every request the server received, its body read in full. */
  seen: Seen[];
  close(): Promise<void>;
}

const servers: TestServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

/**
 * An HTTP server on 127.0.0.1 with a free port. `handle` answers each request after its body was read; it may also
 * never answer. Closing destroys every open connection, so a server that never answered does not hold the test.
 */
async function serve(handle: (req: Seen, res: ServerResponse) => void): Promise<TestServer> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    res.on("error", () => {});
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request = {
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      seen.push(request);
      handle(request, res);
    });
  });
  server.on("clientError", (_err, socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const test: TestServer = {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(test);
  return test;
}

const json = (res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(text);
};
const redirectTo = (location: string) => (_req: Seen, res: ServerResponse) => {
  res.writeHead(302, { Location: location });
  res.end();
};

/** The real global fetch, typed as the client's deps take it. */
const realFetch = (input: string, init: RequestInit): Promise<Response> => globalThis.fetch(input, init);

function deps(extra: Partial<AppClientDeps> = {}): AppClientDeps & { infos: string[]; sleeps: number[] } {
  const infos: string[] = [];
  const sleeps: number[] = [];
  return {
    infos,
    sleeps,
    info: (line) => infos.push(line),
    fetch: realFetch,
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    timeoutMs: SHORT_TIMEOUT_MS * 10,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  };
}

/** Every request a server received carried no Authorization header and no copy of the token anywhere. */
function expectNoToken(server: TestServer): void {
  for (const request of server.seen) {
    expect(request.headers.authorization).toBeUndefined();
    expect(JSON.stringify(request.headers)).not.toContain(TOKEN);
    expect(request.body.toString("latin1")).not.toContain(TOKEN);
  }
}

describe("the pharn.dev client over real HTTP (appRequest, fetchPolicy)", { timeout: 60_000 }, () => {
  it("a 200 envelope is read whole with its content type and request id, from one GET with the four fixed headers", async () => {
    const app = await serve((_req, res) => json(res, 200, ENVELOPE, { "x-pharn-request-id": "req-abc-123" }));
    const result = await appRequest(deps(), {
      url: new URL("/api/v1/policy?repo=acme%2Fwidgets", app.origin),
      token: TOKEN,
    });
    expect(result).toEqual({
      kind: "response",
      status: 200,
      contentType: "application/json",
      requestId: "req-abc-123",
      body: ENVELOPE,
    });
    expect(app.seen).toHaveLength(1);
    const [request] = app.seen;
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("/api/v1/policy?repo=acme%2Fwidgets");
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.accept).toBe("application/json");
    expect(request?.headers["user-agent"]).toBe(`pharn-ci/${VERSION}`);
    expect(request?.body.byteLength).toBe(0);
  });

  it("fetchPolicy turns a real 200 envelope into the app policy", async () => {
    const app = await serve((_req, res) => json(res, 200, ENVELOPE));
    const policy = await fetchPolicy(
      { ...deps(), now: () => NOW },
      { mode: "required", origin: new URL(app.origin), repository: REPO },
    );
    const envelope = JSON.parse(ENVELOPE) as { version: number; policy: unknown };
    expect(policy).toEqual({
      source: "app",
      version: envelope.version,
      fetchedAt: NOW.toISOString(),
      document: envelope.policy,
    });
    expect(app.seen.map((r) => r.url)).toEqual(["/api/v1/policy?repo=acme%2Fwidgets"]);
  });

  it("a body of exactly the cap is read whole", async () => {
    const body = `"${"a".repeat(APP_MAX_BODY_BYTES - 2)}"`;
    const app = await serve((_req, res) => json(res, 200, body));
    const result = await appRequest(deps(), { url: new URL("/api/v1/policy", app.origin), token: TOKEN });
    expect(result.kind).toBe("response");
    expect(result.kind === "response" ? result.body?.length : undefined).toBe(APP_MAX_BODY_BYTES);
    expect(result.kind === "response" ? result.tooLarge : undefined).toBeUndefined();
  });

  it.each([301, 302, 303, 307, 308])(
    "a %i to a second server is a network error, retried once on the first server; the second server gets no request and never the token",
    async (status) => {
      const elsewhere = await serve((_req, res) => json(res, 200, ENVELOPE));
      const app = await serve((_req, res) => {
        res.writeHead(status, { Location: `${elsewhere.origin}/stolen` });
        res.end();
      });
      const d = deps();
      const get = await appRequest(d, { url: new URL("/api/v1/policy", app.origin), token: TOKEN });
      expect(get).toEqual({ kind: "network" });
      const post = await appRequest(d, {
        url: new URL("/api/v1/runs", app.origin),
        token: TOKEN,
        method: "POST",
        body: '{"a":1}',
      });
      expect(post).toEqual({ kind: "network" });
      expect(app.seen.map((r) => r.method)).toEqual(["GET", "GET", "POST", "POST"]);
      expect(d.sleeps).toHaveLength(2);
      expect(elsewhere.seen).toHaveLength(0);
      expectNoToken(elsewhere);
    },
  );

  it("fetchPolicy: a redirect ends as the network reason and nothing reaches the redirect's target", async () => {
    const elsewhere = await serve((_req, res) => json(res, 200, ENVELOPE));
    const app = await serve(redirectTo(`${elsewhere.origin}/api/v1/policy?repo=acme%2Fwidgets`));
    const policy = await fetchPolicy(deps(), { mode: "required", origin: new URL(app.origin), repository: REPO });
    expect(policy.source).toBe("none");
    expect(policy.unavailable).toEqual({ reason: "network", required: true });
    expect(app.seen).toHaveLength(2);
    expect(elsewhere.seen).toHaveLength(0);
  });

  it("a server that never answers is the timeout outcome after the injected timeout, with no retry", async () => {
    const app = await serve(() => {});
    const started = Date.now();
    const result = await appRequest(deps({ timeoutMs: SHORT_TIMEOUT_MS }), {
      url: new URL("/api/v1/policy", app.origin),
      token: TOKEN,
    });
    expect(result).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
    expect(app.seen).toHaveLength(1);

    const policy = await fetchPolicy(deps({ timeoutMs: SHORT_TIMEOUT_MS }), {
      mode: "required",
      origin: new URL(app.origin),
      repository: REPO,
    });
    expect(policy.unavailable).toEqual({ reason: "timeout", required: true });
  });

  it("a server that sends the headers and then stalls the body is the timeout outcome too", async () => {
    const app = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"version": 7, ');
    });
    const started = Date.now();
    const result = await appRequest(deps({ timeoutMs: SHORT_TIMEOUT_MS }), {
      url: new URL("/api/v1/policy", app.origin),
      token: TOKEN,
    });
    expect(result).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(CEILING_MS);
  });

  it("a 2 MiB body is refused at the cap; fetchPolicy says response-too-large", async () => {
    const big = Buffer.alloc(2 * 1_048_576, 0x61);
    const app = await serve((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json", "x-pharn-request-id": "req-big" });
      res.end(big);
    });
    const result = await appRequest(deps(), { url: new URL("/api/v1/policy", app.origin), token: TOKEN });
    expect(result).toEqual({
      kind: "response",
      status: 200,
      contentType: "application/json",
      requestId: "req-big",
      tooLarge: true,
    });
    const policy = await fetchPolicy(deps(), { mode: "required", origin: new URL(app.origin), repository: REPO });
    expect(policy.unavailable).toEqual({
      reason: "response-too-large",
      status: 200,
      requestId: "req-big",
      required: true,
    });
  });
});

/** A report with run metadata, enough for the upload to build its bundle. */
const REPORT = {
  schemaVersion: 2,
  tool: { name: "pharn-ci", version: VERSION },
  verdict: "pass",
  diffCoverage: null,
  agentSetup: { files: [], summary: { byKind: {}, tools: [] } },
  messages: [],
  meta: {
    event: "pull_request",
    repository: REPO,
    prNumber: 7,
    headSha: "b".repeat(40),
    baseSha: "a".repeat(40),
    scope: "ci/check",
    runId: 9,
    runAttempt: 1,
    upload: { status: "skipped" },
  },
};

/**
 * The upload against two loopback servers standing in for the app and storage. The fetch given to runUpload rewrites
 * only the https origin of each host to its server and passes the client's RequestInit to the real fetch unchanged.
 */
async function upload(storage: TestServer) {
  const signed = `https://${STORAGE_HOST}/o/acme/9-1.tgz?X-Sig=abc123`;
  const app = await serve((req, res) => {
    if (req.url === "/api/v1/runs/upload-url") {
      json(
        res,
        200,
        JSON.stringify({ uploadUrl: signed, objectKey: "runs/acme/9-1.tar.gz", maxBytes: 10_485_760, expiresAt: "x" }),
      );
    } else if (req.url === "/api/v1/runs") {
      json(res, 201, JSON.stringify({ url: `https://${APP_HOST}/acme/widgets/runs/9-1` }));
    } else {
      json(res, 404, "{}");
    }
  });
  const hosts = new Map([
    [`https://${APP_HOST}`, app.origin],
    [`https://${STORAGE_HOST}`, storage.origin],
  ]);
  const rewrite = (input: string): string => {
    const url = new URL(input);
    const to = hosts.get(url.origin);
    if (to === undefined) throw new Error(`the upload asked for an unexpected origin: ${url.origin}`);
    return `${to}${url.pathname}${url.search}`;
  };
  const warnings: string[] = [];
  const d = {
    ...deps(),
    fetch: (input: string, init: RequestInit) => realFetch(rewrite(input), init),
    now: () => NOW,
    warning: (line: string) => warnings.push(line),
  };
  const outcome = await runUpload(d, {
    choice: "auto",
    report: REPORT as never,
    appOrigin: new URL(`https://${APP_HOST}`),
  });
  return { outcome, app, warnings };
}

describe("the upload over real HTTP (runUpload)", { timeout: 60_000 }, () => {
  it("storage answering 200 to the PUT ends ok: the bundle reached storage without the token, and the run was registered", async () => {
    const storage = await serve((_req, res) => {
      res.writeHead(200);
      res.end();
    });
    const { outcome, app } = await upload(storage);
    expect(outcome).toEqual({ status: "ok", runUrl: `https://${APP_HOST}/acme/widgets/runs/9-1` });
    expect(app.seen.map((r) => `${r.method} ${r.url}`)).toEqual(["POST /api/v1/runs/upload-url", "POST /api/v1/runs"]);
    expect(storage.seen.map((r) => `${r.method} ${r.url}`)).toEqual(["PUT /o/acme/9-1.tgz?X-Sig=abc123"]);
    const put = storage.seen[0] as Seen;
    expect(put.headers["content-type"]).toBe("application/gzip");
    expect(put.body.byteLength).toBeGreaterThan(0);
    expect(put.body.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expectNoToken(storage);
  });

  // Under `redirect: "follow"` undici would follow the 303 (as a GET without the body); it cannot replay a binary body,
  // so it would fail the other four anyway. The 303 is the case that shows the PUT's own redirect mode is in force.
  it.each([301, 302, 303, 307, 308])(
    "a PUT answered with a %i is put:network: the redirect's target gets nothing, the PUT is not retried and no run is registered",
    async (status) => {
      const elsewhere = await serve((_req, res) => {
        res.writeHead(200);
        res.end();
      });
      const storage = await serve((_req, res) => {
        res.writeHead(status, { Location: `${elsewhere.origin}/stolen` });
        res.end();
      });
      const { outcome, app, warnings } = await upload(storage);
      expect(outcome).toEqual({ status: "failed", reason: "put:network" });
      expect(storage.seen.map((r) => r.method)).toEqual(["PUT"]);
      expect(elsewhere.seen).toHaveLength(0);
      expect(app.seen.map((r) => r.url)).toEqual(["/api/v1/runs/upload-url"]);
      expect(warnings).toHaveLength(1);
      expectNoToken(storage);
    },
  );

  it("an upload-url request answered with a redirect is upload-url:network and the redirect's target never sees the token", async () => {
    const elsewhere = await serve((_req, res) => json(res, 200, "{}"));
    const app = await serve(redirectTo(`${elsewhere.origin}/stolen`));
    const d = {
      ...deps(),
      fetch: (input: string, init: RequestInit) => realFetch(input.replace(`https://${APP_HOST}`, app.origin), init),
      now: () => NOW,
      warning: () => {},
    };
    const outcome = await runUpload(d, {
      choice: "auto",
      report: REPORT as never,
      appOrigin: new URL(`https://${APP_HOST}`),
    });
    expect(outcome).toEqual({ status: "failed", reason: "upload-url:network" });
    expect(app.seen).toHaveLength(2);
    expect(elsewhere.seen).toHaveLength(0);
  });
});
