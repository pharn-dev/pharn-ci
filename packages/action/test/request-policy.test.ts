import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOctokit } from "@actions/github";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubApi } from "../src/api.js";
import { createNodeIo, GIT_TIMEOUT_MS } from "../src/node-io.js";
import {
  API_TIMEOUT_MS,
  DEFAULT_RETRY_WAIT_MS,
  MAX_RETRY_WAIT_MS,
  retryWaitMs,
  withRequestPolicy,
} from "../src/request-policy.js";

// F-17: each GitHub API request has a timeout and at most one retry, and git calls have a timeout.
// The API tests drive the real Octokit from @actions/github with only fetch mocked.

type Answer = { status: number; body?: string; headers?: Record<string, string> } | "hang";

/** The GitHub API over a real Octokit with the request policy, whose fetch gives these answers in turn. */
function apiAnswering(answers: Answer[], policy: { timeoutMs?: number; now?: () => number } = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const log = vi.fn((_message: string) => {});
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
    if (init.signal) signals.push(init.signal);
    const answer = answers.shift();
    if (answer === undefined) throw new Error("no answer left");
    if (answer === "hang") {
      return new Promise<Response>((_ok, fail) => {
        init.signal?.addEventListener("abort", () => fail(init.signal?.reason));
      });
    }
    return new Response(answer.body ?? "", {
      status: answer.status,
      headers: { "content-type": "application/json; charset=utf-8", ...answer.headers },
    });
  });
  const api = createGitHubApi({
    token: "t0ken",
    repo: () => ({ owner: "acme", repo: "demo" }),
    getOctokit: withRequestPolicy((token) => getOctokit(token, { request: { fetch } }), { ...policy, sleep, log }),
  });
  return { api, fetch, sleep, log, signals };
}

const ME = { status: 200, body: '{"login":"me"}' };
const COMMENT = { status: 201, body: '{"id":1,"user":{"login":"me"}}' };

describe("GitHub API request policy (F-17)", () => {
  it("gives every request, each page of a paginated list included, its own abort signal", async () => {
    const next = { link: '<https://api.github.com/repositories/1/issues/7/comments?page=2>; rel="next"' };
    const { api, signals } = apiAnswering([
      { status: 200, body: '[{"id":1}]', headers: next },
      { status: 200, body: '[{"id":2}]' },
    ]);
    expect(await api.listComments(7)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((s) => !s.aborted)).toBe(true);
  });

  it("retries a 5xx once after the default wait, then succeeds", async () => {
    const { api, fetch, sleep, log } = apiAnswering([{ status: 502, body: '{"message":"Bad gateway"}' }, COMMENT]);
    expect(await api.createComment(7, "body")).toBe("me");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(DEFAULT_RETRY_WAIT_MS);
    expect(log.mock.calls[0]?.[0]).toMatch(/^GitHub API request POST .* failed \(Bad gateway.*retrying once in 2 s$/);
  });

  it("gives up after the one retry", async () => {
    const { api, fetch } = apiAnswering([
      { status: 503, body: '{"message":"first"}' },
      { status: 503, body: '{"message":"second"}' },
    ]);
    await expect(api.createComment(7, "body")).rejects.toThrow("second");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honours retry-after on a rate-limited 403, and waits until x-ratelimit-reset without one", async () => {
    const limited = { status: 403, body: '{"message":"secondary rate limit"}', headers: { "retry-after": "7" } };
    const a = apiAnswering([limited, COMMENT]);
    expect(await a.api.createComment(7, "body")).toBe("me");
    expect(a.sleep).toHaveBeenCalledWith(7_000);

    const exhausted = {
      status: 403,
      body: '{"message":"API rate limit exceeded"}',
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000030" },
    };
    const b = apiAnswering([exhausted, COMMENT], { now: () => 1_000_000_000 });
    expect(await b.api.createComment(7, "body")).toBe("me");
    expect(b.sleep).toHaveBeenCalledWith(30_000);
  });

  it("does not retry a plain 403, a 404, or a rate limit that asks for more than 60 s", async () => {
    // GITHUB_TOKEN and App tokens get a plain 403 from GET /user on every run: it must stay one request.
    const forbidden = apiAnswering([
      {
        status: 403,
        body: '{"message":"Resource not accessible by integration"}',
        headers: { "x-ratelimit-remaining": "999" },
      },
    ]);
    expect(await forbidden.api.viewerLogin()).toBeNull();
    expect(forbidden.fetch).toHaveBeenCalledTimes(1);

    const missing = apiAnswering([{ status: 404, body: '{"message":"Not Found"}' }]);
    await expect(missing.api.compareDiff("a...b")).rejects.toThrow("Not Found");
    expect(missing.fetch).toHaveBeenCalledTimes(1);

    const tooLong = apiAnswering([{ status: 429, body: '{"message":"slow down"}', headers: { "retry-after": "61" } }]);
    await expect(tooLong.api.createComment(7, "body")).rejects.toThrow("slow down");
    expect(tooLong.fetch).toHaveBeenCalledTimes(1);
    expect(tooLong.sleep).not.toHaveBeenCalled();
  });

  it("aborts a hung request after the timeout and does not retry it", async () => {
    const { api, fetch, sleep } = apiAnswering(["hang", ME], { timeoutMs: 50 });
    await expect(api.compareDiff("a...b")).rejects.toThrow(
      "GitHub API request GET /repos/{owner}/{repo}/compare/{basehead} timed out after 0.05 s",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses a 30 s timeout and caps retry waits at 60 s", () => {
    expect(API_TIMEOUT_MS).toBe(30_000);
    expect(MAX_RETRY_WAIT_MS).toBe(60_000);
  });
});

describe("retryWaitMs", () => {
  const failure = (status: number, headers: Record<string, string> = {}) => ({ status, response: { headers } });

  it.each([
    ["a 500", failure(500), DEFAULT_RETRY_WAIT_MS],
    ["a network error (no response)", { status: 500 }, DEFAULT_RETRY_WAIT_MS],
    ["a 503 with retry-after", failure(503, { "retry-after": "3" }), 3_000],
    ["a 429 with retry-after 60", failure(429, { "retry-after": "60" }), 60_000],
    [
      "a 403 with x-ratelimit-remaining 0",
      failure(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "105" }),
      5_000,
    ],
    ["a reset already past", failure(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "90" }), 0],
  ])("waits for %s", (_name, err, expected) => {
    expect(retryWaitMs(err, 100_000)).toBe(expected);
  });

  it.each([
    ["a plain 403", failure(403, { "x-ratelimit-remaining": "12" })],
    ["a 401", failure(401)],
    ["a 422", failure(422)],
    ["a 429 asking for 61 s", failure(429, { "retry-after": "61" })],
    ["a reset more than 60 s away", failure(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "200" })],
    ["a 429 naming no wait", failure(429)],
    ["an error without a status", new Error("boom")],
    ["nothing", undefined],
  ])("gives up on %s", (_name, err) => {
    expect(retryWaitMs(err, 100_000)).toBeNull();
  });
});

describe("git timeout (F-17)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("kills a git call that runs past the timeout and says so", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pharn-ci-git-timeout-"));
    dirs.push(dir);
    // `git hash-object --stdin` waits for stdin, which execFile never closes: it runs until killed.
    const io = createNodeIo(dir, { gitTimeoutMs: 100 });
    await expect(io.git(["hash-object", "--stdin"])).rejects.toThrow("git hash-object timed out after 0.1 s");
  });

  it("defaults to two minutes", () => {
    expect(GIT_TIMEOUT_MS).toBe(120_000);
  });
});
