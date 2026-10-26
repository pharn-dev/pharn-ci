import { type PolicyUnavailableReason, type ResolvedPolicy, validatePolicyResponse } from "@pharn-ci/core";
import { type AppClientDeps, appRequest, oidcOffered, requestAppToken } from "./app-client.js";

/** What `fetchPolicy` reads from the Action's deps: the app client's, and the clock. */
export interface PolicyFetchDeps extends AppClientDeps {
  now?: (() => Date) | undefined;
}

/** `owner/name` as GitHub spells it; checked before any token is requested. */
const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

const JSON_CONTENT_TYPE = /^application\/json\s*(?:;|$)/i;

/**
 * Fetches the org policy of a repository: one GET of `/api/v1/policy?repo=<owner/name>` on the app origin, with the
 * OIDC token. Under `auto` a missing token or policy is silent (source `none`); under `required` every reason there is
 * no policy is `unavailable`, which `check()` turns into an error. Whatever the app answers is untrusted: only a
 * response that passes `validatePolicyResponse` whole is used, and nothing of a failing response is quoted. A request
 * id the app sent is logged once and carried in `unavailable.requestId` when it is a sane one.
 */
export async function fetchPolicy(
  deps: PolicyFetchDeps,
  options: { mode: "auto" | "required"; origin: URL; repository: string },
): Promise<ResolvedPolicy> {
  const required = options.mode === "required";
  const unavailable = (
    reason: PolicyUnavailableReason,
    extra: { status?: number; requestId?: string; noApp?: boolean } = {},
  ): ResolvedPolicy => {
    if (extra.requestId !== undefined)
      deps.info(`pharn-ci: the org policy request failed (request id ${extra.requestId})`);
    return {
      source: "none",
      version: null,
      document: null,
      ...(extra.noApp === true ? { noApp: true } : {}),
      unavailable: {
        reason,
        ...(extra.status === undefined ? {} : { status: extra.status }),
        ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
        required,
      },
    };
  };
  const silent = (extra: { noApp?: boolean } = {}): ResolvedPolicy => ({
    source: "none",
    version: null,
    document: null,
    ...(extra.noApp === true ? { noApp: true } : {}),
  });

  // With no OIDC offered at all there is nothing to send and nothing to ask for: that is the no-token answer below,
  // whatever the repository is. With OIDC, a repository name that is not `owner/name` stops the run before a token is asked for.
  if (oidcOffered(deps) && !REPOSITORY.test(options.repository)) return unavailable("no-repository");
  const token = await requestAppToken(deps);
  if (token === null) return required ? unavailable("no-oidc-token") : silent();

  const url = new URL("/api/v1/policy", options.origin);
  url.searchParams.set("repo", options.repository);
  const result = await appRequest(deps, { url, token });
  if (result.kind === "timeout") return unavailable("timeout");
  if (result.kind === "network") return unavailable("network");

  const { status } = result;
  const id = result.requestId === undefined ? {} : { requestId: result.requestId };
  if (status === 204)
    return required ? unavailable("no-policy", { status, noApp: true, ...id }) : silent({ noApp: true });
  if (status === 404) {
    return required ? unavailable("installation_not_found", { status, noApp: true, ...id }) : silent({ noApp: true });
  }
  if (status === 401) return unavailable("token_invalid", { status, ...id });
  if (status === 403) return unavailable("repo_not_in_installation", { status, ...id });
  if (status === 429) return unavailable("rate-limited", { status, ...id });
  if (status !== 200) return unavailable("unexpected-status", { status, ...id });

  if (result.tooLarge === true) return unavailable("response-too-large", { status, ...id });
  if (result.contentType === null || !JSON_CONTENT_TYPE.test(result.contentType)) {
    return unavailable("invalid-response", { status, ...id });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body ?? "");
  } catch {
    return unavailable("invalid-response", { status, ...id });
  }
  const validated = validatePolicyResponse(parsed);
  if (!validated.ok) return unavailable("invalid-response", { status, ...id });
  return {
    source: "app",
    version: validated.response.version,
    fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
    document: validated.response.policy,
  };
}
