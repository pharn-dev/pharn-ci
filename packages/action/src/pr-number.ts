import type { ActionDeps } from "./run.js";

/** The pull request a PR-number run measures, as the GitHub API reports it. */
export interface PrNumberTarget {
  number: number;
  baseSha: string;
  /** Lower-case. */
  headSha: string;
}

export interface PrNumberInputs {
  prNumber?: number;
  /** Lower-case. */
  headSha?: string;
}

const PR_NUMBER = /^[1-9][0-9]{0,9}$/;
const COMMIT_SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/i;

/** Written so that this source does not itself contain an expression (and so a linter sees no template in a string). */
const HEAD_SHA_EXPRESSION = ["$", "{{ github.event.workflow_run.head_sha }}"].join("");

/**
 * Validate the pr-number and head-sha inputs (trimmed; empty means not given). Both can be attacker-controlled text
 * in a workflow_run (the artifact), so no message echoes a value.
 */
export function parsePrNumberInputs(prNumberRaw: string, headShaRaw: string): PrNumberInputs {
  const prNumberText = prNumberRaw.trim();
  const headShaText = headShaRaw.trim();
  const result: PrNumberInputs = {};
  if (prNumberText !== "") {
    if (!PR_NUMBER.test(prNumberText)) {
      throw new Error("pr-number must be a positive whole number (digits only, no leading zero, at most 10 digits)");
    }
    result.prNumber = Number(prNumberText);
  }
  if (headShaText !== "") {
    if (!COMMIT_SHA.test(headShaText)) {
      throw new Error("head-sha must be a full commit SHA: 40 hexadecimal characters (64 for SHA-256 repositories)");
    }
    if (result.prNumber === undefined) throw new Error("head-sha is only used together with pr-number");
    result.headSha = headShaText.toLowerCase();
  }
  return result;
}

/**
 * Read the pull request through the GitHub API and cross-check the expected head. The PR's base and head come from the
 * API, never from the artifact; head-sha (from the trusted triggering event) only has to agree with them.
 */
export async function resolvePrNumberTarget(
  deps: Pick<ActionDeps, "api" | "context" | "warning">,
  { prNumber, headSha }: { prNumber: number; headSha?: string | undefined },
): Promise<PrNumberTarget> {
  let pr: { baseSha: string; headSha: string };
  try {
    pr = await deps.api.getPullRequest(prNumber);
  } catch (err) {
    throw new Error(
      `could not read pull request #${prNumber} through the GitHub API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const actualHead = pr.headSha.toLowerCase();
  if (headSha !== undefined && headSha !== actualHead) {
    throw new Error(
      `head-sha ${headSha} is not the head of pull request #${prNumber} (${actualHead}): ` +
        "the pull request head moved since the tested commit, or pr-number names another pull request",
    );
  }
  if (headSha === undefined && deps.context.eventName === "workflow_run") {
    deps.warning(
      "head-sha is not set, so nothing checks that pr-number belongs to the commit that was tested; " +
        `set head-sha to ${HEAD_SHA_EXPRESSION}`,
    );
  }
  return { number: prNumber, baseSha: pr.baseSha, headSha: actualHead };
}
