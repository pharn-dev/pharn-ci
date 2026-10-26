import type { Report, ReportMeta } from "../report.js";

/**
 * The `meta.json` of an upload: the run metadata of the report plus the tool, the time and the comment link. The
 * shape is `schema/upload-meta.v1.json`, which is the source of truth; keys are written in this order.
 */
export interface UploadMeta {
  schemaVersion: 1;
  tool: { name: "pharn-ci"; version: string };
  createdAt: string;
  event: ReportMeta["event"];
  repository: string;
  repositoryId?: number;
  prNumber: number | null;
  headSha: string;
  baseSha: string | null;
  mergeBase: string | null;
  scope: string;
  runId: number;
  runAttempt: number;
  actor?: string;
  prAuthor?: { login: string; type: "User" | "Bot" | "Organization" } | null;
  prLabels?: string[];
  coAuthors?: string[];
  agentHint?: string | null;
  isAgentPr?: boolean;
  commentUrl: string | null;
}

/** What the caller adds to the report's own run metadata. */
export interface UploadMetaExtra {
  version: string;
  createdAt: string;
  commentUrl: string | null;
}

/**
 * The upload metadata of a report: null when the report carries no run metadata. The optional fields are copied only
 * when the report's meta has them, with the value it holds (a `null` stays `null`); `prNumber`, `baseSha` and
 * `mergeBase` default to `null`. The report's `upload` field is never copied. Nothing is shared with the report.
 */
export function buildUploadMeta(report: Report, extra: UploadMetaExtra): UploadMeta | null {
  const m = report.meta;
  if (m === undefined) return null;
  const has = (key: keyof ReportMeta): boolean => Object.hasOwn(m, key);
  return {
    schemaVersion: 1,
    tool: { name: "pharn-ci", version: extra.version },
    createdAt: extra.createdAt,
    event: m.event,
    repository: m.repository,
    ...(has("repositoryId") ? { repositoryId: m.repositoryId as number } : {}),
    prNumber: m.prNumber ?? null,
    headSha: m.headSha,
    baseSha: m.baseSha ?? null,
    mergeBase: m.mergeBase ?? null,
    scope: m.scope,
    runId: m.runId,
    runAttempt: m.runAttempt,
    ...(has("actor") ? { actor: m.actor as string } : {}),
    ...(has("prAuthor")
      ? { prAuthor: m.prAuthor === null || m.prAuthor === undefined ? null : { ...m.prAuthor } }
      : {}),
    ...(has("prLabels") ? { prLabels: [...(m.prLabels as string[])] } : {}),
    ...(has("coAuthors") ? { coAuthors: [...(m.coAuthors as string[])] } : {}),
    ...(has("agentHint") ? { agentHint: m.agentHint ?? null } : {}),
    ...(has("isAgentPr") ? { isAgentPr: m.isAgentPr as boolean } : {}),
    commentUrl: extra.commentUrl,
  };
}
