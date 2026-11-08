import { type PolicyUnavailableReason, type ResolvedPolicy, validatePolicyResponse } from "@pharn-ci/core";
import { type AppClientDeps, appRequest, oidcOffered, requestAppToken } from "./app-client.js";

/** What `fetchPolicy` and `fetchAppPolicy` read from the Action's deps: the app client's, and the clock. */
export interface PolicyFetchDeps extends AppClientDeps {
  now?: (() => Date) | undefined;
}

/** `owner/name` as GitHub spells it; checked before any token is requested. */
const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

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

/** The app settings of a valid 200 answer that the Action uses beside the policy. */
interface AppSettingsUsed {
  messageMaxBytes: number;
  quarantine: string[];
  uploadJunit: boolean;
}

/**
 * Fetches the org policy of a repository: `fetchAppPolicy`'s policy, for a caller that needs nothing else.
 */
export async function fetchPolicy(
  deps: PolicyFetchDeps,
  options: { mode: "auto" | "required"; origin: URL; repository: string },
): Promise<ResolvedPolicy> {
  return (await fetchAppPolicy(deps, options)).policy;
}

/**
 * Fetches the org policy of a repository: one GET of `/api/v1/policy?repo=<owner/name>` on the app origin, with the
 * OIDC token. Under `auto` a missing token or policy is silent (source `none`); under `required` every reason there is
 * no policy is `unavailable`, which `check()` turns into an error. Whatever the app answers is untrusted: only a
 * response that passes `validatePolicyResponse` whole is used, and nothing of a failing response is quoted. A request
 * id the app sent is logged once and carried in `unavailable.requestId` when it is a sane one.
 */
export async function fetchAppPolicy(
  deps: PolicyFetchDeps,
  options: { mode: "auto" | "required"; origin: URL; repository: string },
): Promise<AppPolicyResult> {
  let settings: AppSettingsUsed | undefined;
  const policy = await requestPolicy(deps, options, (value) => {
    settings = value;
  });
  // A closure assigned it: read it through a widened view.
  const used = settings as AppSettingsUsed | undefined;
  return used === undefined ? { policy } : { policy, ...used };
}

/** The request and its answer; `onSettings` is called with the validated settings on the one 200 path only. */
async function requestPolicy(
  deps: PolicyFetchDeps,
  options: { mode: "auto" | "required"; origin: URL; repository: string },
  onSettings: (settings: AppSettingsUsed) => void,
): Promise<ResolvedPolicy> {
  const required = options.mode === "required";
  const unavailable = (
    reason: PolicyUnavailableReason,
    extra: { status?: number; requestId?: string; noApp?: boolean; noInstallation?: boolean } = {},
  ): ResolvedPolicy => {
    if (extra.requestId !== undefined)
      deps.info(`pharn-ci: the org policy request failed (request id ${extra.requestId})`);
    return {
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
  };
  const silent = (extra: { noApp?: boolean; noInstallation?: boolean } = {}): ResolvedPolicy => ({
    source: "none",
    version: null,
    document: null,
    ...(extra.noApp === true ? { noApp: true } : {}),
    ...(extra.noInstallation === true ? { noInstallation: true } : {}),
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
  onSettings({
    messageMaxBytes: validated.response.settings.messageMaxBytes,
    quarantine: validated.response.quarantine,
    uploadJunit: validated.response.settings.uploadJunit,
  });
  return {
    source: "app",
    version: validated.response.version,
    fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
    document: validated.response.policy,
  };
}
