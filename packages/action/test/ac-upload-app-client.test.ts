import { describe, expect, it } from "vitest";
import { VERSION } from "../../core/src/version.js";

// appRequest() and requestAppToken() are loaded inside each test body: the AC test is written before their POST, body,
// per-request timeout and no-token-line extensions exist, so nothing the build adds may run while this file loads. The
// fetch is a fake that records every request (URL, method, headers, body, redirect, signal); no real network.

const APP = "https://pharn.dev";
/** A fake OIDC token, assembled at run time. */
const TOKEN = ["oidc", "APP", "c1i3", "nt77"].join("-");

interface FetchCall {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: unknown;
  redirect: unknown;
  signal: AbortSignal | undefined;
}
type Answer = Error | ((call: FetchCall) => Response | Promise<Response>);

const byName = ([a]: [string, string], [b]: [string, string]) => (a < b ? -1 : a > b ? 1 : 0);

function recordCall(input: unknown, init: RequestInit | undefined): FetchCall {
  const request = input instanceof Request ? input : undefined;
  return {
    url: request ? request.url : String(input),
    method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
    headers: [...new Headers(init?.headers ?? request?.headers)].sort(byName),
    body: init?.body ?? null,
    redirect: init?.redirect ?? request?.redirect,
    signal: init?.signal ?? request?.signal ?? undefined,
  };
}

/** A fetch that never answers, and rejects as fetch does when its abort signal fires. */
const hang: Answer = (call) =>
  new Promise<Response>((_, reject) => {
    const signal = call.signal;
    const guard = setTimeout(() => reject(new Error("the fake fetch was given no abort signal")), 5000);
    const abort = () => {
      clearTimeout(guard);
      reject(signal?.reason ?? new DOMException("This operation was aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });

const ok: Answer = () =>
  new Response(JSON.stringify({ hello: "world" }), { status: 200, headers: { "content-type": "application/json" } });

interface AppClient {
  appRequest(
    deps: unknown,
    request: { url: URL; token: string; method?: "GET" | "POST"; body?: string; timeoutMs?: number },
  ): Promise<unknown>;
  requestAppToken(deps: unknown, noTokenLine?: string): Promise<string | null>;
}

const load = async () => (await import("../src/app-client.js")) as unknown as AppClient;

function clientDeps(answer: Answer, extra: Record<string, unknown> = {}) {
  const calls: FetchCall[] = [];
  const infos: string[] = [];
  const sleeps: number[] = [];
  const deps = {
    fetch: async (input: unknown, init?: RequestInit) => {
      const call = recordCall(input, init);
      calls.push(call);
      if (answer instanceof Error) throw answer;
      return answer(call);
    },
    getIDToken: async () => TOKEN,
    setSecret: () => {},
    hasOidcEnv: true,
    now: () => new Date("2026-10-26T12:00:00.000Z"),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    info: (m: string) => {
      infos.push(m);
    },
    warning: () => {},
    ...extra,
  };
  return { deps, calls, infos, sleeps };
}

describe("the app client's POST, per-request timeout and no-token line", { timeout: 60_000 }, () => {
  it("AC-33: a POST carries exactly four headers and the body, a GET today's three and no body, the per-request timeout is overridden by deps.timeoutMs, and requestAppToken logs the line it is given", async () => {
    const { appRequest, requestAppToken } = await load();
    const url = new URL("/api/v1/runs/upload-url", APP);
    const body = JSON.stringify({ repository: "acme/widgets", sizes: { report: 10, junit: 0 } });

    const post = clientDeps(ok);
    await appRequest(post.deps, { url, token: TOKEN, method: "POST", body, timeoutMs: 60_000 });
    expect(post.calls).toHaveLength(1);
    const p = post.calls[0] as FetchCall;
    expect(p.method).toBe("POST");
    expect(p.url).toBe(url.href);
    expect(p.headers).toEqual([
      ["accept", "application/json"],
      ["authorization", `Bearer ${TOKEN}`],
      ["content-type", "application/json"],
      ["user-agent", `pharn-ci/${VERSION}`],
    ]);
    expect(p.body).toBe(body);
    expect(p.redirect).toBe("error");
    expect(p.signal).toBeInstanceOf(AbortSignal);

    const get = clientDeps(ok);
    await appRequest(get.deps, { url: new URL("/api/v1/policy?repo=acme/widgets", APP), token: TOKEN });
    expect(get.calls).toHaveLength(1);
    const g = get.calls[0] as FetchCall;
    expect(g.method).toBe("GET");
    expect(g.headers).toEqual([
      ["accept", "application/json"],
      ["authorization", `Bearer ${TOKEN}`],
      ["user-agent", `pharn-ci/${VERSION}`],
    ]);
    expect(g.body).toBeNull();

    // A fetch that only settles on abort: the POST's own timeoutMs of 20 ends it as a timeout, without a retry.
    const network = await appRequest(clientDeps(new TypeError("fetch failed")).deps, {
      url,
      token: TOKEN,
      method: "POST",
      body,
    });
    const timed = clientDeps(hang);
    const timeout = await appRequest(timed.deps, { url, token: TOKEN, method: "POST", body, timeoutMs: 20 });
    expect(JSON.stringify(timeout)).toMatch(/time/i);
    expect(timeout).not.toEqual(network);
    expect(timed.calls).toHaveLength(1);
    expect(timed.sleeps).toEqual([]);

    // deps.timeoutMs overrides the request's: a 20 ms deps timeout ends a POST whose own timeout is ten minutes.
    const overridden = clientDeps(hang, { timeoutMs: 20 });
    const result = await appRequest(overridden.deps, { url, token: TOKEN, method: "POST", body, timeoutMs: 600_000 });
    expect(JSON.stringify(result)).toMatch(/time/i);
    expect(result).not.toEqual(network);
    expect(overridden.calls).toHaveLength(1);

    // requestAppToken logs the given line instead of item 20's fixed one when no token is available.
    const line = "pharn-ci: a caller-chosen no-token line";
    const noToken = clientDeps(ok, { hasOidcEnv: false });
    expect(await requestAppToken(noToken.deps, line)).toBeNull();
    expect(noToken.infos).toEqual([line]);
    const fixed = clientDeps(ok, { hasOidcEnv: false });
    expect(await requestAppToken(fixed.deps)).toBeNull();
    expect(fixed.infos).toHaveLength(1);
    expect(fixed.infos[0]).not.toBe(line);
    expect(fixed.infos[0]).toContain("id-token: write");
  });
});
