import type { ReportMeta, ReportMetaEvent } from "@pharn-ci/core";

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
  let baseSha: string | null;
  let prNumber: number | null;
  if (opts.target) {
    headSha = opts.target.headSha;
    baseSha = opts.target.baseSha;
    prNumber = opts.target.number;
  } else if (pr) {
    headSha = pr.head.sha;
    baseSha = pr.base.sha;
    prNumber = pr.number;
  } else if (mergeGroup) {
    headSha = mergeGroup.head_sha;
    baseSha = mergeGroup.base_sha;
    prNumber = null;
  } else {
    headSha = context.sha;
    const before = context.payload.before;
    // A base-ref given as a branch or tag name is not a commit SHA, so it is not recorded as one.
    const baseRef = opts.baseRef?.toLowerCase();
    baseSha = baseRef && SHA.test(baseRef) ? baseRef : before && !ZERO_SHA.test(before) ? before : null;
    prNumber = null;
  }
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
    scope: `${context.workflow ?? ""}/${context.job ?? ""}`,
    runId: runId as number,
    runAttempt: runAttempt as number,
    ...(context.actor ? { actor: context.actor } : {}),
    upload: { status: "skipped" },
  };
}
