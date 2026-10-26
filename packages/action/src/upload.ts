import { gzipSync } from "node:zlib";
import {
  buildUploadBundle,
  buildUploadMeta,
  buildUploadTar,
  type Report,
  UPLOAD_REPORT_MAX_BYTES,
  type UploadOutcome,
  VERSION,
} from "@pharn-ci/core";
import { type AppResult, appRequest, requestAppToken } from "./app-client.js";
import type { ActionDeps, IssueComment } from "./run.js";
import type { UploadChoice } from "./upload-input.js";

/**
 * The info line when the run cannot be uploaded for lack of an OIDC token. It is the line `requestAppToken` logs, so
 * the one line a run that reached the token request prints about its upload.
 */
export const UPLOAD_NO_TOKEN_LINE = "pharn-ci: the run is not uploaded to pharn.dev: no OIDC token is available";

const NO_INSTALLATION_LINE =
  "pharn-ci: the run is not uploaded to pharn.dev: the Pharn GitHub App is not installed for this repository";
const NO_COMMENT_LINE = "pharn-ci: could not read the pull request comments, so the upload carries no comment link";

/** The PUT of the bundle is cut off after this long when `deps.timeoutMs` is not set. */
const PUT_TIMEOUT_MS = 120_000;
/** The upload-url and runs requests are each cut off after this long when `deps.timeoutMs` is not set. */
const REQUEST_TIMEOUT_MS = 60_000;

const JSON_CONTENT_TYPE = /^application\/json\s*(?:;|$)/i;
const OBJECT_KEY = /^[A-Za-z0-9/_.=-]{1,512}$/;
/** The PUT statuses that mean storage took the bundle. */
const PUT_OK = [200, 201, 204];

/** What `runUpload` reads from the Action's deps: the app client's, and the clock. No new `ActionDeps` field. */
export type UploadDeps = Pick<
  ActionDeps,
  "fetch" | "getIDToken" | "setSecret" | "hasOidcEnv" | "now" | "timeoutMs" | "sleep" | "info" | "warning"
>;

export interface UploadInput {
  choice: UploadChoice;
  report: Report;
  appOrigin: URL;
  /** The head commit the run was asked to measure (the `head-sha` input in pr-number mode); the report's otherwise. */
  prHeadShaExpected?: string;
  /** Finds this run's own pull request comment, when the run may have one. A rejection means no comment link. */
  findOwnComment?: () => Promise<IssueComment | undefined>;
}

/** An outcome with the request id of the app answer that decided it, for the log line. */
interface Step {
  outcome: UploadOutcome;
  requestId?: string;
}

/**
 * Uploads the run to pharn.dev and says how it went. It never throws and never fails the check: whatever goes wrong is
 * an outcome (and one log line), and an exception is `failed` with the reason `internal`. Nothing here puts the token,
 * the signed URL or what the app answered into a log line, an error or the outcome.
 */
export async function runUpload(deps: UploadDeps, input: UploadInput): Promise<UploadOutcome> {
  let step: Step;
  try {
    step = await uploadSteps(deps, input);
  } catch {
    step = { outcome: { status: "failed", reason: "internal" } };
  }
  logOutcome(deps, step);
  return step.outcome;
}

/** The one log line of an outcome that reached the token request; the other outcomes log nothing here. */
function logOutcome(deps: UploadDeps, step: Step): void {
  const { outcome } = step;
  const id = step.requestId;
  if (outcome.status === "ok") {
    deps.info(`pharn-ci: the run was uploaded to pharn.dev${id === undefined ? "" : ` (request id ${id})`}`);
  } else if (outcome.status === "skipped") {
    if (outcome.reason === "no-installation") deps.info(NO_INSTALLATION_LINE);
  } else if (outcome.status === "failed") {
    const detail = id === undefined ? "" : `, request id ${id}`;
    deps.warning(
      `pharn-ci: the run was not uploaded to pharn.dev (failed: ${outcome.reason}${detail}); the check is not affected`,
    );
  } else {
    deps.warning("pharn-ci: the run was not uploaded to pharn.dev (too_large); the check is not affected");
  }
}

async function uploadSteps(deps: UploadDeps, input: UploadInput): Promise<Step> {
  if (input.choice === "never") return { outcome: { status: "skipped", reason: "input-never" } };
  if (input.report.meta === undefined) return { outcome: { status: "skipped", reason: "no-meta" } };

  const token = await requestAppToken(deps, UPLOAD_NO_TOKEN_LINE);
  if (token === null) return { outcome: { status: "skipped", reason: "no-oidc" } };

  const commentUrl = await findCommentUrl(deps, input.findOwnComment);
  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const meta = buildUploadMeta(input.report, { version: VERSION, createdAt, commentUrl });
  if (meta === null) return { outcome: { status: "skipped", reason: "no-meta" } };
  const { reportJson, metaJson } = buildUploadBundle(input.report, meta);
  if (Buffer.byteLength(reportJson, "utf8") > UPLOAD_REPORT_MAX_BYTES) {
    return { outcome: { status: "too_large", maxBytes: UPLOAD_REPORT_MAX_BYTES } };
  }
  const gz = gzipSync(
    buildUploadTar([
      { name: "report.json", text: reportJson },
      { name: "meta.json", text: metaJson },
    ]),
    { level: 9 },
  );
  // The redacted metadata is what the app is told, so nothing the bundle redacted is sent beside it.
  const m = JSON.parse(metaJson) as Record<string, unknown>;

  // 1. The signed URL.
  const urlResult = await appRequest(deps, {
    url: new URL("/api/v1/runs/upload-url", input.appOrigin),
    token,
    method: "POST",
    timeoutMs: REQUEST_TIMEOUT_MS,
    body: JSON.stringify({
      repository: m.repository,
      headSha: m.headSha,
      runId: m.runId,
      runAttempt: m.runAttempt,
      scope: m.scope,
      sizes: { report: gz.byteLength, junit: 0 },
    }),
  });
  const urlId = requestIdOf(urlResult);
  if (urlResult.kind === "response" && urlResult.status === 404) {
    return { outcome: { status: "skipped", reason: "no-installation" }, ...urlId };
  }
  if (urlResult.kind === "response" && urlResult.status === 413) {
    return { outcome: { status: "too_large", maxBytes: null }, ...urlId };
  }
  if (urlResult.kind !== "response" || urlResult.status !== 200) {
    return failed(failReason("upload-url", urlResult), urlId);
  }
  const urlAnswer = readUploadUrlAnswer(urlResult);
  if (urlAnswer === null) return failed("upload-url:malformed", urlId);
  if (gz.byteLength > urlAnswer.maxBytes) {
    return { outcome: { status: "too_large", maxBytes: urlAnswer.maxBytes }, ...urlId };
  }

  // 2. The bundle, to storage. The signed URL is a secret from here on, and the PUT is never retried.
  deps.setSecret?.(urlAnswer.uploadUrl);
  const putFailure = await putBundle(deps, urlAnswer.uploadUrl, gz);
  if (putFailure !== null) return failed(putFailure, {});

  // 3. The run is registered.
  const runsResult = await appRequest(deps, {
    url: new URL("/api/v1/runs", input.appOrigin),
    token,
    method: "POST",
    timeoutMs: REQUEST_TIMEOUT_MS,
    body: JSON.stringify({
      objectKey: urlAnswer.objectKey,
      repository: m.repository,
      repositoryId: m.repositoryId ?? null,
      prNumber: m.prNumber ?? null,
      headSha: m.headSha,
      baseSha: m.baseSha ?? null,
      scope: m.scope,
      runId: m.runId,
      runAttempt: m.runAttempt,
      event: m.event,
      prHeadShaExpected: input.prHeadShaExpected ?? m.headSha,
    }),
  });
  const runsId = requestIdOf(runsResult);
  if (runsResult.kind !== "response" || ![200, 201, 202].includes(runsResult.status)) {
    return failed(failReason("runs", runsResult), runsId);
  }
  const runUrl = readRunsAnswer(runsResult, input.appOrigin);
  if (runUrl === null) return failed("runs:malformed", runsId);
  return { outcome: { status: "ok", runUrl }, ...runsId };
}

const failed = (reason: string, id: { requestId?: string }): Step => ({ outcome: { status: "failed", reason }, ...id });

function requestIdOf(result: AppResult): { requestId?: string } {
  return result.kind === "response" && result.requestId !== undefined ? { requestId: result.requestId } : {};
}

/** The reason of a request that did not end in an answer the step accepts: the status, or timeout and network. */
function failReason(step: "upload-url" | "runs", result: AppResult): string {
  if (result.kind === "timeout") return `${step}:timeout`;
  if (result.kind === "network") return `${step}:network`;
  switch (result.status) {
    case 401:
      return `${step}:token_invalid`;
    case 403:
      return `${step}:repo_not_in_installation`;
    case 429:
      return `${step}:rate-limited`;
    case 409:
      if (step === "runs") return "runs:pr_head_mismatch";
      break;
    case 422:
      if (step === "runs") return "runs:report_invalid";
      break;
    default:
  }
  return `${step}:status-${result.status}`;
}

/**
 * The URL in `text` when it is an https URL of printable ASCII (no space or control character) of at most `maxChars`
 * characters, with no user name or password and a host, and no fragment unless `fragment` allows one (a comment's link
 * ends in `#issuecomment-<id>`); otherwise null.
 */
function httpsUrl(text: string, maxChars: number, fragment = false): URL | null {
  if (text.length > maxChars || !/^https:\/\/[!-~]+$/.test(text) || (!fragment && text.includes("#"))) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
  return url.hostname === "" ? null : url;
}

/** The parsed JSON object of a 200 answer, or null when it is not JSON, not that content type or not an object. */
function jsonObject(result: Extract<AppResult, { kind: "response" }>): Record<string, unknown> | null {
  if (result.tooLarge === true || result.contentType === null || !JSON_CONTENT_TYPE.test(result.contentType)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body ?? "");
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

interface UploadUrlAnswer {
  uploadUrl: string;
  objectKey: string;
  maxBytes: number;
}

/** The signed URL, object key and size limit of an upload-url answer; unknown keys are ignored. Null when malformed. */
function readUploadUrlAnswer(result: Extract<AppResult, { kind: "response" }>): UploadUrlAnswer | null {
  const answer = jsonObject(result);
  if (answer === null) return null;
  const { uploadUrl, objectKey, maxBytes, expiresAt } = answer;
  if (typeof uploadUrl !== "string" || httpsUrl(uploadUrl, 8192) === null) return null;
  if (typeof objectKey !== "string" || !OBJECT_KEY.test(objectKey)) return null;
  if (typeof maxBytes !== "number" || !Number.isSafeInteger(maxBytes) || maxBytes < 1) return null;
  if (typeof expiresAt !== "string" || expiresAt.length < 1 || expiresAt.length > 64) return null;
  return { uploadUrl, objectKey, maxBytes };
}

/** The run's page URL of a runs answer: an https URL on the app's own origin, as the URL class writes it, or null. */
function readRunsAnswer(result: Extract<AppResult, { kind: "response" }>, origin: URL): string | null {
  const answer = jsonObject(result);
  if (answer === null || typeof answer.url !== "string") return null;
  const url = httpsUrl(answer.url, 2048);
  return url !== null && url.origin === origin.origin ? url.href : null;
}

/**
 * One PUT of the gzip bytes to the signed URL: exactly `Content-Type` and `User-Agent`, never an `Authorization` header
 * (the OIDC token goes to the app origin only), no redirect, a timeout and no retry. Null when storage answered 200,
 * 201 or 204, else the reason. The URL never reaches a log line or the reason.
 */
async function putBundle(deps: UploadDeps, url: string, bytes: Uint8Array): Promise<string | null> {
  if (deps.fetch === undefined) return "put:network";
  const signal = AbortSignal.timeout(deps.timeoutMs ?? PUT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/gzip", "User-Agent": `pharn-ci/${VERSION}` },
      body: bytes as unknown as NonNullable<RequestInit["body"]>,
      redirect: "error",
      signal,
    });
  } catch {
    return signal.aborted ? "put:timeout" : "put:network";
  }
  await response.body?.cancel().catch(() => {});
  return PUT_OK.includes(response.status) ? null : `put:status-${response.status}`;
}

/** The https `html_url` of this run's own pull request comment, or null (no finder, no comment, or a bad URL). */
async function findCommentUrl(
  deps: UploadDeps,
  findOwnComment: (() => Promise<IssueComment | undefined>) | undefined,
): Promise<string | null> {
  if (findOwnComment === undefined) return null;
  let comment: IssueComment | undefined;
  try {
    comment = await findOwnComment();
  } catch {
    deps.info(NO_COMMENT_LINE);
    return null;
  }
  const url = comment?.html_url;
  return typeof url === "string" && httpsUrl(url, 2048, true) !== null ? url : null;
}
