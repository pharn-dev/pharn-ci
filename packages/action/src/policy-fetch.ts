import { type PolicyUnavailableReason, type ResolvedPolicy, validatePolicyResponse } from "@pharn-ci/core";
import { type AppClientDeps, appRequest, oidcOffered, requestAppToken } from "./app-client.js";

/** What `fetchAppPolicy` reads from the Action's deps: the app client's, and the clock. */
export interface PolicyFetchDeps extends AppClientDeps {
  now?: (() => Date) | undefined;
}

/**
 * `owner/name` as GitHub spells it; checked before any token is requested. The owner is an organization or user name
 * (letters, digits and `-`, at most 39), or an Enterprise Managed User's `handle_shortcode`, which can own private
 * repositories in its own namespace (`LOGIN_PATTERN` in core documents the form).
 */
const REPOSITORY =
  /^(?:[A-Za-z0-9-]{1,39}|(?=[A-Za-z0-9_-]{1,39}\/)[A-Za-z0-9][A-Za-z0-9-]*_[A-Za-z0-9]{3,8})\/[A-Za-z0-9._-]{1,100}$/;

const JSON_CONTENT_TYPE = /^application\/json\s*(?:;|$)/i;

/** What `fetchAppPolicy` returns: the policy, and the one app setting the upload uses, beside it. */
export interface AppPolicyResult {
  policy: ResolvedPolicy;
  /**
   * The org's `settings.messageMaxBytes` (an integer 256..65536, validated), set only when the app answered 200 with an
   * envelope `validatePolicyResponse` accepted whole. Every other answer leaves it unset. It rides beside the policy
   * because `ResolvedPolicy` stays the shape the report projects.
   */
  messageMaxBytes?: number;
  /**
   * The org's quarantine list (test ids, validated), set only on the same 200 path as `messageMaxBytes`. `check()` applies
   * it to the run's JUnit results unless the org policy sets `flaky.quarantine: false`.
   */
  quarantine?: string[];
  /** The org's `settings.uploadJunit`, set only on the same 200 path: false keeps the JUnit results out of the upload. */
  uploadJunit?: boolean;
}

/**
 * Fetches the org policy of a repository: one GET of `/api/v1/policy?repo=<owner/name>` on the app origin, with the
 * OIDC token. Under `auto` a runner that offers no token, or an app that has no policy, is silent (source `none`), and a
 * token request that was offered and failed is `unavailable` (a warning); under `required` every reason there is no
 * policy is `unavailable`, which `check()` turns into an error. Whatever the app answers is untrusted: only a
 * response that passes `validatePolicyResponse` whole is used, and nothing of a failing response is quoted; keys and ids
 * this build does not know are left out and named in `unknownKeys`, never a reason to drop the policy. A request
 * id the app sent is logged once and carried in `unavailable.requestId` when it is a sane one.
 */
export async function fetchAppPolicy(
  deps: PolicyFetchDeps,
  options: { mode: "auto" | "required"; origin: URL; repository: string },
): Promise<AppPolicyResult> {
  const required = options.mode === "required";
  const unavailable = (
    reason: PolicyUnavailableReason,
    extra: { status?: number; requestId?: string; noApp?: boolean; noInstallation?: boolean } = {},
  ): AppPolicyResult => {
    if (extra.requestId !== undefined)
      deps.info(`pharn-ci: the org policy request failed (request id ${extra.requestId})`);
    const policy: ResolvedPolicy = {
      source: "none",
      version: null,
      document: null,
      ...(extra.noApp === true ? { noApp: true } : {}),
      ...(extra.noInstallation === true ? { noInstallation: true } : {}),
      unavailable: {
        reason,
        ...(extra.status === undefined ? {} : { status: extra.status }),
        ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
        required,
      },
    };
    return { policy };
  };
  const silent = (extra: { noApp?: boolean; noInstallation?: boolean } = {}): AppPolicyResult => ({
    policy: {
      source: "none",
      version: null,
      document: null,
      ...(extra.noApp === true ? { noApp: true } : {}),
      ...(extra.noInstallation === true ? { noInstallation: true } : {}),
    },
  });

  // With no OIDC offered at all there is nothing to send and nothing to ask for: that is the no-token answer below,
  // whatever the repository is. With OIDC, a repository name that is not `owner/name` stops the run before a token is asked for.
  if (oidcOffered(deps) && !REPOSITORY.test(options.repository)) return unavailable("no-repository");
  const tokenResult = await requestAppToken(deps);
  // Not offered: the job did not ask for a policy, so `auto` is silent. Offered and failed: the job asked for one by
  // granting `id-token: write`, so the report says the policy was not used, under `auto` too.
  if (tokenResult.kind === "not-offered") return required ? unavailable("no-oidc-token") : silent();
  if (tokenResult.kind === "failed") return unavailable("no-oidc-token");
  const { token } = tokenResult;

  const url = new URL("/api/v1/policy", options.origin);
  url.searchParams.set("repo", options.repository);
  const result = await appRequest(deps, { url, token });
  if (result.kind === "timeout") return unavailable("timeout");
  if (result.kind === "network") return unavailable("network");

  const { status } = result;
  const id = result.requestId === undefined ? {} : { requestId: result.requestId };
  if (status === 204)
    return required ? unavailable("no-policy", { status, noApp: true, ...id }) : silent({ noApp: true });
  // A 404 is "the app is not installed" (a 204 is "installed, no policy yet"): only it gets the install hint.
  if (status === 404) {
    const notInstalled = { noApp: true, noInstallation: true };
    return required ? unavailable("installation_not_found", { status, ...notInstalled, ...id }) : silent(notInstalled);
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
  // Keys and ids a newer app serves that this build does not know were left out of the document: the rest applies,
  // and check() names them in one POLICY_KEYS_UNKNOWN warning (CORE-118).
  const { response, unknown } = validated;
  return {
    policy: {
      source: "app",
      version: response.version,
      fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
      document: response.policy,
      ...(unknown.total > 0 ? { unknownKeys: unknown } : {}),
    },
    messageMaxBytes: response.settings.messageMaxBytes,
    quarantine: response.quarantine,
    uploadJunit: response.settings.uploadJunit,
  };
}
