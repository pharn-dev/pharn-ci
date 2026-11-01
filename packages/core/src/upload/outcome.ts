import { type Message, type Report, verdictOf } from "../report.js";

/** The largest `report.json` the Action offers for upload, in bytes of the gzip-free archive text. */
export const UPLOAD_REPORT_MAX_BYTES = 5_242_880;

/** How the upload of a run ended. `reason` is for the log; the report carries only the status (and the URL). */
export type UploadOutcome =
  | { status: "ok"; runUrl: string }
  | { status: "skipped"; reason: "input-never" | "no-meta" | "no-oidc" | "no-installation" }
  | { status: "failed"; reason: string }
  | { status: "too_large"; maxBytes: number | null };

const TOO_LARGE_TAIL = "The check ran in full; only the history on pharn.dev misses this run.";

/** The `UPLOAD_TOO_LARGE` text, with the byte limit when the app named one. */
function tooLargeText(maxBytes: number | null): string {
  const size = typeof maxBytes === "number" ? ` (${maxBytes} bytes)` : "";
  return `The run was not uploaded to pharn.dev: the report is larger than the upload limit${size}. ${TOO_LARGE_TAIL}`;
}

/**
 * The report with `meta.upload` set to the outcome's status (and `runUrl` for `ok`). A report without run metadata is
 * returned as it is. `too_large` also adds one `UPLOAD_TOO_LARGE` warning, which can move a passing verdict to warn;
 * no other status touches the messages or the verdict. The input is not changed.
 */
export function withUploadOutcome(report: Report, outcome: UploadOutcome): Report {
  if (report.meta === undefined) return report;
  const upload =
    outcome.status === "ok" ? { status: "ok" as const, runUrl: outcome.runUrl } : { status: outcome.status };
  const meta = { ...report.meta, upload };
  if (outcome.status !== "too_large") return { ...report, meta };
  const message: Message = { level: "warn", code: "UPLOAD_TOO_LARGE", text: tooLargeText(outcome.maxBytes) };
  const messages = [...report.messages, message];
  // The verdict only rises: a passing run gets the warning's level, a warn or fail stays.
  const verdict = report.verdict === "pass" ? verdictOf(messages) : report.verdict;
  return { ...report, messages, verdict, meta };
}
