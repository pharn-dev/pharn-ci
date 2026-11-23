import { describe, expect, it } from "vitest";
import { APP_TOKEN_TIMEOUT_MS, type AppClientDeps, requestAppToken } from "../src/app-client.js";
import { fetchAppPolicy } from "../src/policy-fetch.js";

// Review finding 21: the OIDC token request had no deadline (`@actions/core` retries ten times, each with a
// three-minute socket timeout). It is now raced against a timer: a getIDToken that never answers ends exactly like
// one that rejects, with no token, the fixed info line, and nothing fetched.

const NO_TOKEN = "id-token: write";

interface Deps extends AppClientDeps {
  infos: string[];
  fetched: string[];
  secrets: string[];
}

function deps(getIDToken: (audience?: string) => Promise<string>, tokenTimeoutMs: number): Deps {
  const infos: string[] = [];
  const fetched: string[] = [];
  const secrets: string[] = [];
  return {
    infos,
    fetched,
    secrets,
    info: (line) => infos.push(line),
    fetch: async (input) => {
      fetched.push(String(input));
      return new Response("{}", { status: 200 });
    },
    getIDToken,
    setSecret: (secret) => secrets.push(secret),
    hasOidcEnv: true,
    tokenTimeoutMs,
    sleep: async () => {},
  };
}

const neverSettles = () => new Promise<string>(() => {});

describe("AC-21: the OIDC token request has a deadline", () => {
  it("the default deadline is 30 s", () => {
    expect(APP_TOKEN_TIMEOUT_MS).toBe(30_000);
  });

  it("a getIDToken that never settles yields no token and the one fixed info line within the timer", async () => {
    const d = deps(neverSettles, 20);
    const started = Date.now();
    expect(await requestAppToken(d)).toEqual({ kind: "failed", errorClass: "Error" });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(d.infos).toHaveLength(1);
    expect(d.infos[0]).toContain(NO_TOKEN);
    expect(d.infos[0]).not.toContain("timed out");
    expect(d.secrets).toEqual([]);
  });

  it("the timeout outcome is the same as a rejecting getIDToken, line included", async () => {
    const timedOut = deps(neverSettles, 20);
    const rejected = deps(() => Promise.reject(new Error("boom-detail")), 20);
    expect(await requestAppToken(timedOut)).toEqual({ kind: "failed", errorClass: "Error" });
    expect(await requestAppToken(rejected)).toEqual({ kind: "failed", errorClass: "Error" });
    expect(timedOut.infos).toEqual(rejected.infos);
  });

  it("the caller's own no-token line is the one logged on a timeout", async () => {
    const d = deps(neverSettles, 20);
    expect(await requestAppToken(d, "upload: no token")).toEqual({ kind: "failed", errorClass: "Error" });
    expect(d.infos).toEqual(["upload: no token"]);
  });

  it("a token that arrives before the deadline is used and masked", async () => {
    const d = deps(async () => "tok-fast", 1_000);
    expect(await requestAppToken(d)).toEqual({ kind: "token", token: "tok-fast" });
    expect(d.secrets).toEqual(["tok-fast"]);
    expect(d.infos).toEqual([]);
  });

  // CORE-122: under auto a timed-out request used to be silent, as if no token were offered. The job granted
  // `id-token: write`, so it asked for the policy: the timeout is now no-oidc-token under auto too (required: false).
  it("a timed-out token request is no-oidc-token and fetches nothing, under policy required and under auto", async () => {
    const origin = new URL("https://pharn.dev");
    const required = deps(neverSettles, 20);
    const { policy } = await fetchAppPolicy(required, { mode: "required", origin, repository: "acme/widgets" });
    expect(policy.unavailable?.reason).toBe("no-oidc-token");
    expect(policy.unavailable?.required).toBe(true);
    expect(required.fetched).toEqual([]);

    const auto = deps(neverSettles, 20);
    const { policy: unavailable } = await fetchAppPolicy(auto, { mode: "auto", origin, repository: "acme/widgets" });
    expect(unavailable).toEqual({
      source: "none",
      version: null,
      document: null,
      unavailable: { reason: "no-oidc-token", required: false },
    });
    expect(auto.fetched).toEqual([]);
  });
});
