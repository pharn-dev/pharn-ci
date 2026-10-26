/**
 * The Action's one client of the pharn.dev app: an OIDC token and a single GET with a few fixed headers. It is the
 * only place the Action talks to anything but the GitHub API, and it is small on purpose, so the next item (the
 * result upload) can reuse it.
 *
 *   parseAppUrl(value)          the `app-url` input as an https origin, or one fixed Error that never repeats the value
 *   requestAppToken(deps)       the OIDC token for the audience `pharn.dev`, masked, or null with one fixed info line
 *   appRequest(deps, request)   one GET with a timeout, no redirect, one retry on a network error or a 5xx, and a
 *                               response body read only up to a cap
 *
 * Nothing here quotes what the app answered: the status, the content type and a sanitized request id are all that
 * come back besides the body, and the callers decide what to say.
 */
import { VERSION } from "@pharn-ci/core";

/** The audience of the OIDC token. Fixed: the `app-url` input never changes it. */
export const APP_AUDIENCE = "pharn.dev";
/** The origin used when the `app-url` input is empty. */
export const DEFAULT_APP_URL = "https://pharn.dev";
/** One attempt is cut off after this long (the whole request, body included). */
export const APP_TIMEOUT_MS = 10_000;
/** The wait before the one retry. */
export const APP_RETRY_WAIT_MS = 1000;
/** The most bytes of a response body read; a longer body is refused. */
export const APP_MAX_BODY_BYTES = 1_048_576;

/** What the client reads from the Action's deps. All optional: an absent one means there is no OIDC. */
export interface AppClientDeps {
  info(message: string): void;
  fetch?: ((input: string, init: RequestInit) => Promise<Response>) | undefined;
  getIDToken?: ((audience?: string) => Promise<string>) | undefined;
  setSecret?: ((secret: string) => void) | undefined;
  /** True when the runner offers an OIDC token (both request variables are set). */
  hasOidcEnv?: boolean | undefined;
  /** The timeout of one attempt, in milliseconds. */
  timeoutMs?: number | undefined;
  /** Waits for the given milliseconds. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

const APP_URL_ERROR =
  "the app-url input must be an https origin such as https://pharn.dev, with no credentials, path, query or fragment";

/**
 * The `app-url` input as a URL: trimmed, empty means the default. It must parse, use https, carry no user name or
 * password, no query, no fragment and no path beyond `/`. Anything else throws one fixed Error that never repeats it.
 */
export function parseAppUrl(value: string): URL {
  const trimmed = value.trim();
  if (trimmed === "") return new URL(DEFAULT_APP_URL);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(APP_URL_ERROR);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new Error(APP_URL_ERROR);
  }
  return url;
}

const NO_TOKEN_LINE =
  "pharn-ci: no OIDC token is available for the org policy; grant the job `permissions: id-token: write` to use it";

/** Whether the runner offers an OIDC token and the deps can ask for one and mask it. */
export function oidcOffered(deps: AppClientDeps): boolean {
  return deps.hasOidcEnv === true && deps.getIDToken !== undefined && deps.setSecret !== undefined;
}

/**
 * The OIDC token for the audience `pharn.dev`, registered as a secret before anything else sees it. Null, with one
 * fixed info line, when the runner offers no OIDC, or `getIDToken` rejects or answers nothing: the error text is
 * never logged.
 */
export async function requestAppToken(deps: AppClientDeps): Promise<string | null> {
  const { getIDToken, setSecret } = deps;
  if (!oidcOffered(deps) || getIDToken === undefined || setSecret === undefined) {
    deps.info(NO_TOKEN_LINE);
    return null;
  }
  let token: string;
  try {
    token = await getIDToken(APP_AUDIENCE);
  } catch {
    deps.info(NO_TOKEN_LINE);
    return null;
  }
  if (typeof token !== "string" || token === "") {
    deps.info(NO_TOKEN_LINE);
    return null;
  }
  setSecret(token);
  return token;
}

export interface AppRequest {
  url: URL;
  token: string;
}

/** The outcome of one request: how it ended, or the status and what could be read of the answer. */
export type AppResult =
  | { kind: "timeout" }
  | { kind: "network" }
  | {
      kind: "response";
      status: number;
      /** The decoded body, read only for a 2xx other than 204 and only up to the cap. */
      body?: string;
      /** True when the body was longer than the cap; it was not read further. */
      tooLarge?: true;
      contentType: string | null;
      /** The `x-pharn-request-id` header, only when it is 1 to 64 letters, digits and hyphens. */
      requestId?: string;
    };

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/;

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One GET of the app. Each attempt has its own timeout (`AbortSignal.timeout`), never follows a redirect (a redirect
 * rejects, which is a network error), and sends exactly the headers `Accept`, `Authorization` and `User-Agent`, and no
 * body. A network error or a 5xx on the first attempt waits `APP_RETRY_WAIT_MS` and tries once more; a timeout, a 429
 * and any other answer are final.
 */
export async function appRequest(deps: AppClientDeps, request: AppRequest): Promise<AppResult> {
  const first = await attempt(deps, request);
  const retry = first.kind === "network" || (first.kind === "response" && first.status >= 500);
  if (!retry) return first;
  await (deps.sleep ?? defaultSleep)(APP_RETRY_WAIT_MS);
  return attempt(deps, request);
}

async function attempt(deps: AppClientDeps, request: AppRequest): Promise<AppResult> {
  const doFetch = deps.fetch;
  if (doFetch === undefined) return { kind: "network" };
  const signal = AbortSignal.timeout(deps.timeoutMs ?? APP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(request.url.href, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${request.token}`,
        "User-Agent": `pharn-ci/${VERSION}`,
      },
      redirect: "error",
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "timeout" } : { kind: "network" };
  }
  const requestIdHeader = response.headers.get("x-pharn-request-id");
  const answer = {
    kind: "response" as const,
    status: response.status,
    contentType: response.headers.get("content-type"),
    ...(requestIdHeader !== null && REQUEST_ID.test(requestIdHeader) ? { requestId: requestIdHeader } : {}),
  };
  if (response.status < 200 || response.status > 299 || response.status === 204) {
    await response.body?.cancel().catch(() => {});
    return answer;
  }
  try {
    const read = await readCapped(response);
    return read === null ? { ...answer, tooLarge: true as const } : { ...answer, body: read };
  } catch {
    return signal.aborted ? { kind: "timeout" } : { kind: "network" };
  }
}

/** The body as UTF-8 text, or null when it is longer than the cap (the stream is cancelled at once). */
async function readCapped(response: Response): Promise<string | null> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > APP_MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}
