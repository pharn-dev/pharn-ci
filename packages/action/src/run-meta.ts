import type { ReportMeta, ReportMetaEvent } from "@pharn-ci/core";
import { COMMIT_SHA } from "./pr-number.js";

/** The parts of the GitHub run context the report's `meta` is built from (a subset of `github.context`). */
export interface RunMetaContext {
  eventName: string;
  sha: string;
  workflow?: string;
  job?: string;
  runId?: number;
  runAttempt?: number;
  actor?: string;
  payload: {
    before?: string;
    repository?: { full_name?: string; id?: number };
    pull_request?: { number: number; base: { sha: string }; head: { sha: string } };
    merge_group?: { base_sha: string; head_sha: string };
  };
}

/** The pull request the run measured in pr-number mode, when there is one. */
export interface RunMetaTarget {
  number: number;
  baseSha: string;
  headSha: string;
}

const EVENTS: readonly ReportMetaEvent[] = ["pull_request", "merge_group", "push", "workflow_run", "workflow_dispatch"];
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ZERO_SHA = /^0+$/;
/** The code points kept of `meta.scope`. The workflow's `name:` is part of it, and a pull request can edit that. */
export const MAX_META_SCOPE_CODE_POINTS = 200;
const CONTROL = /\p{Cc}/gu;

/** `workflow/job` with control characters removed, cut to `MAX_META_SCOPE_CODE_POINTS` at a code-point boundary. */
function metaScope(workflow: string, job: string): string {
  return Array.from(`${workflow}/${job}`.replace(CONTROL, "")).slice(0, MAX_META_SCOPE_CODE_POINTS).join("");
}

/**
 * The base of the change, decided once for the diff and for `meta` so the two never disagree.
 *
 * `ref` is what the diff is taken against: the base-ref input when set, else the pull request's base (the PR-number
 * target's, or the payload's), the merge queue's base, or a push's previous commit; "" when there is none.
 * `sha` is what `meta.baseSha` records: the base-ref input only when it is a full commit SHA (lower-cased; a branch or
 * tag name is not a commit SHA, so it records null), else the same fallback as `ref`, or null.
 */
export function resolveBase(
  context: Pick<RunMetaContext, "payload">,
  opts: { baseRef?: string; target?: RunMetaTarget },
): { ref: string; sha: string | null } {
  const baseRef = opts.baseRef ?? "";
  if (baseRef !== "") return { ref: baseRef, sha: COMMIT_SHA.test(baseRef) ? baseRef.toLowerCase() : null };
  const { pull_request: pr, merge_group: mergeGroup, before } = context.payload;
  const fallback =
    opts.target?.baseSha || pr?.base.sha || mergeGroup?.base_sha || (before && !ZERO_SHA.test(before) ? before : "");
  return { ref: fallback, sha: fallback === "" ? null : fallback };
}

/**
 * The report's `meta` for this run: what ran, where, and which commits it compared. Undefined when a field the
 * schema requires is missing or malformed (no repository, no run id, a head that is not a full commit SHA), so
 * a report never carries an invalid `meta`; the report then says nothing about the run.
 */
export function runMeta(
  context: RunMetaContext,
  opts: { baseRef?: string; target?: RunMetaTarget },
): ReportMeta | undefined {
  const repository = context.payload.repository?.full_name;
  const { runId, runAttempt } = context;
  if (typeof repository !== "string" || repository === "") return undefined;
  if (!Number.isInteger(runId) || !Number.isInteger(runAttempt) || (runAttempt as number) < 1) return undefined;

  const pr = context.payload.pull_request;
  const mergeGroup = context.payload.merge_group;
  let headSha: string;
  let prNumber: number | null;
  if (opts.target) {
    headSha = opts.target.headSha;
    prNumber = opts.target.number;
  } else if (pr) {
    headSha = pr.head.sha;
    prNumber = pr.number;
  } else if (mergeGroup) {
    headSha = mergeGroup.head_sha;
    prNumber = null;
  } else {
    headSha = context.sha;
    prNumber = null;
  }
  // The base the diff was taken against, recorded only as a commit SHA (see resolveBase).
  const baseSha = resolveBase(context, opts).sha;
  if (!SHA.test(headSha)) return undefined;

  const event = EVENTS.find((name) => name === context.eventName) ?? "other";
  const repositoryId = context.payload.repository?.id;
  return {
    event,
    repository,
    ...(Number.isInteger(repositoryId) ? { repositoryId: repositoryId as number } : {}),
    prNumber,
    headSha,
    baseSha,
    // The merge base is a local git answer, which this pure, synchronous function cannot have: the Action fills it in
    // for a run with a local diff (run.ts), and every other run records null.
    mergeBase: null,
    scope: metaScope(context.workflow ?? "", context.job ?? ""),
    runId: runId as number,
    runAttempt: runAttempt as number,
    ...(context.actor ? { actor: context.actor } : {}),
    upload: { status: "skipped" },
  };
}
