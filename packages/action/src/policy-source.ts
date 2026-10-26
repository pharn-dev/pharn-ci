import type { ResolvedPolicy } from "@pharn-ci/core";
import { lstatPath, readPolicyFile } from "@pharn-ci/node-io";
import { fetchPolicy } from "./policy-fetch.js";
import type { PolicyChoice } from "./policy-input.js";
import type { ActionDeps } from "./run.js";

/**
 * The org policy the `policy` input asks for: nothing for `never`; the document of a `file:` path (read inside the
 * workspace, no network); or the app's policy for `auto` and `required`. A `file:` problem throws, which fails the
 * step. `origin` is the validated app origin; the repository is the event's `full_name`, which `fetchPolicy` checks.
 */
export async function obtainPolicy(
  deps: ActionDeps,
  choice: PolicyChoice,
  origin: URL,
): Promise<ResolvedPolicy | undefined> {
  if (choice.kind === "never") return undefined;
  if (choice.kind === "file") {
    return readPolicyFile(
      { readFile: deps.readFile, resolvePath: deps.resolvePath, lstat: deps.lstat ?? lstatPath },
      { root: deps.workspace, path: choice.path, label: "the policy input" },
    );
  }
  const repository = deps.context.payload.repository?.full_name;
  return fetchPolicy(deps, { mode: choice.kind, origin, repository: typeof repository === "string" ? repository : "" });
}
