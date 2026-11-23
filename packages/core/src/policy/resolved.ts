import type { UnknownNames } from "./errors.js";
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
  /**
   * The validated document; null when the source is none. For a `file:` policy that `uniteFilePolicy` united with its
   * merge-base copy (`copies` is then set) it is the united document: each setting a file may carry at its strictest of
   * the two copies.
   */
  document: PolicyDocument | null;
  /**
   * The two copies of a `file:` policy that `document` united: the head copy the pull request carries and the merge
   * base's. Set only by `uniteFilePolicy`, when the base copy was read as a document. The records of a head value that
   * is looser than the default or than the layers are made from the head copy, never from the united value.
   */
  copies?: { head: PolicyDocument; base: PolicyDocument };
  /** True when the app answered that there is no policy for this repository (204 or 404). */
  noApp?: boolean;
  /**
   * True when the app answered 404: the Pharn GitHub App is not installed for this repository. A 204 (installed, no
   * policy yet) never sets it. The Action shows the install hint for it; the report never carries it.
   */
  noInstallation?: boolean;
  /**
   * For an app policy only: the keys and ids the app served that this build does not know, left out of `document`
   * (`validatePolicyResponse`'s `unknown`). Absent, or a `total` of 0, when there were none. They add one
   * POLICY_KEYS_UNKNOWN warning; the report carries nothing else of them.
   */
  unknownKeys?: UnknownNames;
  /** Set when no policy could be used. `required` is whether the workflow demanded one. */
  unavailable?: { reason: PolicyUnavailableReason; status?: number; requestId?: string; required: boolean };
}

/** A setting the policy's value beat, or a policy-file setting that was not applied. */
export interface IgnoredSetting {
  /** The setting, for example `coverage.threshold` or `test_integrity.signals.TI01`. */
  setting: string;
  /**
   * `looser`: a value looser than the policy's (a workflow input or `.pharn/ci.yml` value an app policy beat, or a
   * policy file's value looser than what the run already gives, or looser than the same setting in the merge-base copy
   * of the file); `not-allowed`: a key a policy file may not set.
   */
  reason: "looser" | "not-allowed";
  /**
   * The layer whose value an app policy beat, only on its `looser` records: P09 reads it (class 2 for `config`, class 3
   * for `input`). No message names it (CORE-123).
   */
  layer?: "input" | "config";
  /** The number that was not applied, only for `coverage.threshold`. */
  given?: number;
  /** The number that applies instead, only for `coverage.threshold`. */
  applied?: number;
}

/**
 * Per-signal severities from a policy. `replace` (the app) sets the severity; `raise` (a policy file) only raises it
 * on `off < info < warn < block`. A policy file united with its merge-base copy carries the two copies' severities in
 * `copies` (`severities` is then the strictest of the two per id), so a head value that is looser than the base's is
 * recorded.
 */
export interface SignalOverrides {
  kind: "replace" | "raise";
  severities: Partial<Record<PolicySignalId, PolicySeverity>>;
  copies?: {
    head: Partial<Record<PolicySignalId, PolicySeverity>>;
    base: Partial<Record<PolicySignalId, PolicySeverity>>;
  };
}
