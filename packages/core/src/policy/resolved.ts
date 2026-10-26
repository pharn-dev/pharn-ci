import type { PolicyDocument, PolicySeverity, PolicySignalId } from "./types.js";

/**
 * Why an org policy could not be used. Every member is a fixed word the report names; none repeats anything the app
 * answered. `no-policy` and `installation_not_found` are the 204 and 404 answers under `policy: required`.
 */
export type PolicyUnavailableReason =
  | "no-policy"
  | "installation_not_found"
  | "token_invalid"
  | "repo_not_in_installation"
  | "rate-limited"
  | "unexpected-status"
  | "timeout"
  | "network"
  | "response-too-large"
  | "invalid-response"
  | "no-oidc-token"
  | "no-repository";

/**
 * The policy a run starts from, or the reason there is none. `source` says where the document came from: `app` (served
 * and validated), `file` (the `file:` document the pull request carries) or `none`. `version` is the app's policy
 * version (null for a file and for none). `fetchedAt` is set for an app policy only; `path` for a file policy only.
 */
export interface ResolvedPolicy {
  source: "app" | "file" | "none";
  version: number | null;
  /** When the app policy was fetched, as an ISO 8601 UTC time. Absent for a file and for none. */
  fetchedAt?: string;
  /** The forward-slash path a file policy was read from, relative to the repository. Absent otherwise. */
  path?: string;
  /** The validated document; null when the source is none. */
  document: PolicyDocument | null;
  /** True when the app answered that there is no policy for this repository (204 or 404). */
  noApp?: boolean;
  /** Set when no policy could be used. `required` is whether the workflow demanded one. */
  unavailable?: { reason: PolicyUnavailableReason; status?: number; requestId?: string; required: boolean };
}

/** A setting the policy's value beat, or a policy-file setting that was not applied. */
export interface IgnoredSetting {
  /** The setting, for example `coverage.threshold` or `test_integrity.signals.TI01`. */
  setting: string;
  /** The layer whose value was not applied (`policy-file` for a value the policy file carried). */
  layer: "input" | "config" | "policy-file";
  reason: "looser" | "not-allowed";
  /** The ignored layer's number, only for `coverage.threshold`. */
  given?: number;
  /** The number that applies instead, only for `coverage.threshold`. */
  applied?: number;
}

/**
 * Per-signal severities from a policy. `replace` (the app) sets the severity; `raise` (a policy file) only raises it
 * on `off < info < warn < block`.
 */
export interface SignalOverrides {
  kind: "replace" | "raise";
  severities: Partial<Record<PolicySignalId, PolicySeverity>>;
}
