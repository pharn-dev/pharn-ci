import type { getOctokit } from "@actions/github";

type Octokit = ReturnType<typeof getOctokit>;

/** Each GitHub API request is aborted after this long; undici's own default is 300 s. */
export const API_TIMEOUT_MS = 30_000;
/** A failed request is retried at most once, and only when the wait before it is at most this long. */
export const MAX_RETRY_WAIT_MS = 60_000;
/** The wait before retrying a 5xx or a network error that names no wait of its own. */
export const DEFAULT_RETRY_WAIT_MS = 2_000;

export interface RequestPolicyOptions {
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch, for `x-ratelimit-reset`. */
  now?: () => number;
  /** Told about each retry, e.g. `core.info`. */
  log?: (message: string) => void;
}

/** A request this policy aborted; never retried. */
export class ApiTimeoutError extends Error {}

interface FailedRequest {
  status?: unknown;
  response?: { headers?: Record<string, string | number | undefined> } | undefined;
}

/**
 * How long to wait before retrying a failed GitHub API request, or null to give up now. Retried:
 * a 5xx or a network error (Octokit reports both as a status of 500 or more), a 429, and a 403 that
 * is a rate limit (it names a `retry-after`, or `x-ratelimit-remaining` is 0). A plain 403, such as
 * "Resource not accessible by integration", and every other 4xx are final. The wait is the
 * response's `retry-after` (seconds), else the time until `x-ratelimit-reset` (epoch seconds), else
 * DEFAULT_RETRY_WAIT_MS for a 5xx; a wait over MAX_RETRY_WAIT_MS gives up instead of stalling the job.
 */
export function retryWaitMs(err: unknown, nowMs: number): number | null {
  const { status, response } = (err ?? {}) as FailedRequest;
  if (typeof status !== "number") return null;
  const headers = response?.headers ?? {};
  const retryAfter = Number(headers["retry-after"]);
  const remaining = headers["x-ratelimit-remaining"];
  const reset = Number(headers["x-ratelimit-reset"]);
  const rateLimited =
    status === 429 || (status === 403 && (headers["retry-after"] !== undefined || String(remaining) === "0"));
  if (status < 500 && !rateLimited) return null;
  let wait: number;
  if (headers["retry-after"] !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0) wait = retryAfter * 1000;
  else if (rateLimited && String(remaining) === "0" && Number.isFinite(reset)) wait = Math.max(0, reset * 1000 - nowMs);
  else if (status >= 500) wait = DEFAULT_RETRY_WAIT_MS;
  else return null;
  return wait <= MAX_RETRY_WAIT_MS ? wait : null;
}

/**
 * Give every request of this Octokit (pages of a paginated list included) its own timeout, and one
 * retry on the failures retryWaitMs accepts. A timed-out request is not retried: a hung API is not
 * likely to answer seconds later, and a retry would double the stall.
 */
export function applyRequestPolicy(octokit: Octokit, opts: RequestPolicyOptions = {}): void {
  const timeoutMs = opts.timeoutMs ?? API_TIMEOUT_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const now = opts.now ?? Date.now;
  octokit.hook.wrap("request", async (request, options) => {
    const send = async () => {
      const signal = AbortSignal.timeout(timeoutMs);
      // The hooks inside this one were bound to this options object, so the signal goes on it, not on a
      // copy. `options` is per request; its `request` object is replaced, never mutated, as it can be
      // the client's shared defaults.
      options.request = { ...options.request, signal };
      try {
        return await request(options);
      } catch (err) {
        if (signal.aborted) {
          throw new ApiTimeoutError(
            `GitHub API request ${options.method} ${options.url} timed out after ${timeoutMs / 1000} s`,
          );
        }
        throw err;
      }
    };
    try {
      return await send();
    } catch (err) {
      if (err instanceof ApiTimeoutError) throw err;
      const wait = retryWaitMs(err, now());
      if (wait === null) throw err;
      opts.log?.(
        `GitHub API request ${options.method} ${options.url} failed (${err instanceof Error ? err.message : String(err)}); retrying once in ${Math.ceil(wait / 1000)} s`,
      );
      await sleep(wait);
      return send();
    }
  });
}

/** `getOctokit` with the request policy applied to every client it builds. */
export function withRequestPolicy(
  build: (token: string) => Octokit,
  opts: RequestPolicyOptions = {},
): (token: string) => Octokit {
  return (token) => {
    const octokit = build(token);
    applyRequestPolicy(octokit, opts);
    return octokit;
  };
}
