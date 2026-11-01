import type { Report } from "../report.js";
import { MESSAGE_MAX_BYTES, redactSecrets, truncateUtf8 } from "../secrets/redact.js";
import type { UploadMeta } from "./meta.js";

/** The two texts of an upload: `report.json` and `meta.json`, each `JSON.stringify(x, null, 2)` and a newline. */
export interface UploadBundle {
  reportJson: string;
  metaJson: string;
}

export interface UploadBundleOptions {
  /** The byte budget of each message text and signal detail; never more than the default 2048. At least 32. */
  messageMaxBytes?: number;
}

type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container => value !== null && typeof value === "object";

/** Replaces every string leaf under `root` with its redacted text, in place. Keys are untouched; no recursion. */
function redactLeaves(root: Container): void {
  const stack: Container[] = [root];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const node = next as Record<string, unknown>;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === "string") node[key] = redactSecrets(value);
      else if (isContainer(value)) stack.push(value);
    }
  }
}

/** Cuts the string at `key` of each item to `cap` bytes (items that are not objects, or hold no string there, stay). */
function capField(items: unknown, key: string, cap: number): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isContainer(item) || Array.isArray(item)) continue;
    const value = item[key];
    if (typeof value === "string") item[key] = truncateUtf8(value, cap);
  }
}

/**
 * The text of a run as it leaves the job: a copy of the report and of its upload metadata in which every string is
 * redacted, every message text and test-integrity signal detail is cut to the byte budget, the signals carry no
 * `base` or `head` excerpt, and `meta.upload` says `ok` (the upload this text is for). The inputs are not changed and
 * key order is kept. Throws a RangeError when `messageMaxBytes` is not a safe integer of at least 32.
 */
export function buildUploadBundle(report: Report, meta: UploadMeta, options?: UploadBundleOptions): UploadBundle {
  const cap = Math.min(options?.messageMaxBytes ?? MESSAGE_MAX_BYTES, MESSAGE_MAX_BYTES);
  // Validates the budget even for a report with no message to cut.
  truncateUtf8("", cap);

  const reportCopy = JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
  const metaCopy = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
  redactLeaves(reportCopy);
  redactLeaves(metaCopy);

  capField(reportCopy.messages, "text", cap);
  const integrity = reportCopy.testIntegrity;
  if (isContainer(integrity) && !Array.isArray(integrity)) {
    capField(integrity.signals, "detail", cap);
    if (Array.isArray(integrity.signals)) {
      for (const signal of integrity.signals) {
        if (isContainer(signal) && !Array.isArray(signal)) {
          delete signal.base;
          delete signal.head;
        }
      }
    }
  }
  const runMeta = reportCopy.meta;
  if (isContainer(runMeta) && !Array.isArray(runMeta)) runMeta.upload = { status: "ok" };

  return {
    reportJson: `${JSON.stringify(reportCopy, null, 2)}\n`,
    metaJson: `${JSON.stringify(metaCopy, null, 2)}\n`,
  };
}
