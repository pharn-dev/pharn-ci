import type { ResolvedPolicy } from "@pharn-ci/core";
import { lstatPath, readPolicyFile } from "@pharn-ci/node-io";
import { fetchAppPolicy } from "./policy-fetch.js";
import type { PolicyChoice } from "./policy-input.js";
import type { ActionDeps } from "./run.js";

/** What `obtainPolicy` returns: the policy, and the app's upload cap when the app's own response set one. */
export interface ObtainedPolicy {
  policy: ResolvedPolicy | undefined;
  /** The app's validated `settings.messageMaxBytes`, from this run's own 200 response; never from `never` or `file:`. */
  uploadMessageMaxBytes?: number;
  /** The app's validated quarantine list, from the same 200 response only; a pull request can never supply one. */
  quarantine?: string[];
  /** The app's validated `settings.uploadJunit`, from the same 200 response only. */
  uploadJunit?: boolean;
}

/**
 * The org policy the `policy` input asks for: nothing for `never`; the document of a `file:` path (read inside the
 * workspace, no network); or the app's policy for `auto` and `required`. A `file:` problem throws, which fails the
 * step. `origin` is the validated app origin; the repository is the event's `full_name`, which `fetchAppPolicy` checks.
 * Only the app's response can carry `uploadMessageMaxBytes`, `quarantine` and `uploadJunit`.
 */
export async function obtainPolicy(deps: ActionDeps, choice: PolicyChoice, origin: URL): Promise<ObtainedPolicy> {
  if (choice.kind === "never") return { policy: undefined };
  if (choice.kind === "file") {
    return {
      policy: await readPolicyFile(
        { readFile: deps.readFile, resolvePath: deps.resolvePath, lstat: deps.lstat ?? lstatPath },
        { root: deps.workspace, path: choice.path, label: "the policy input" },
      ),
    };
  }
  const repository = deps.context.payload.repository?.full_name;
  const { policy, messageMaxBytes, quarantine, uploadJunit } = await fetchAppPolicy(deps, {
    mode: choice.kind,
    origin,
    repository: typeof repository === "string" ? repository : "",
  });
  return {
    policy,
    ...(messageMaxBytes === undefined ? {} : { uploadMessageMaxBytes: messageMaxBytes }),
    ...(quarantine === undefined ? {} : { quarantine }),
    ...(uploadJunit === undefined ? {} : { uploadJunit }),
  };
}
