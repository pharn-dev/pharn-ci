import {
  type Message,
  type Report,
  type TestIntegritySignal,
  testIntegritySignalMessages,
  verdictOf,
} from "./report.js";

/**
 * The accept label: a pull request label that a reviewer who is not the PR author applies to record a sign-off on
 * test-integrity block findings. Only the Action looks at it. Everything here is a pure function over plain data: the
 * Action reads the pull request and its issue events and passes them in.
 */

/** The label name used when the `accept-label` input is empty. */
export const DEFAULT_ACCEPT_LABEL = "pharn/accepted";

/** Most code points an `accept-label` value may have. */
export const MAX_ACCEPT_LABEL_LENGTH = 50;

/** What a GitHub user login looks like: 1 to 39 characters of letters, digits and hyphens, not starting with a hyphen. */
export const GITHUB_LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/**
 * Control characters (U+0000 to U+001F, U+007F to U+009F) and the invisible format characters that reorder or hide
 * text: zero-width spaces and joiners and the marks (U+200B to U+200F), the bidirectional embeddings and overrides
 * (U+202A to U+202E) and isolates (U+2066 to U+2069), and the byte order mark (U+FEFF). A right-to-left override in the
 * label would make the fixed hint text around it read differently from what it says.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

const INVALID_LABEL =
  "the accept-label input must be at most 50 characters and must not contain control or invisible formatting characters";

export type AcceptLabelValidation = { ok: true; label: string } | { ok: false; error: string };

/**
 * The accept label an input value names: trimmed, the default when empty or a spelling of the default in other letter
 * case. At most 50 code points and no control or invisible format character (see `CONTROL`). The error is one fixed
 * sentence that never repeats the value.
 */
export function validateAcceptLabel(raw: string): AcceptLabelValidation {
  const label = raw.trim();
  if (label === "") return { ok: true, label: DEFAULT_ACCEPT_LABEL };
  if ([...label].length > MAX_ACCEPT_LABEL_LENGTH || CONTROL.test(label)) return { ok: false, error: INVALID_LABEL };
  // A spelling of the default in other letter case is the default: the hints, `accepted.label` and the absent
  // `acceptLabel` then all name `pharn/accepted`, as GitHub matches labels case-insensitively anyway.
  return { ok: true, label: isDefaultAcceptLabel(label) ? DEFAULT_ACCEPT_LABEL : label };
}

/** True when `label` is the default label in any ASCII letter case. */
export function isDefaultAcceptLabel(label: string): boolean {
  return sameName(label, DEFAULT_ACCEPT_LABEL);
}

/** ASCII letters to lower case, nothing else: `toLowerCase()` would fold the Kelvin sign U+212A into `k`. */
const asciiLower = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Two label names or logins compared as GitHub compares them: ASCII letters case-insensitively, all else exactly. */
function sameName(a: string, b: string): boolean {
  return asciiLower(a) === asciiLower(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether a pull request's labels include `label` (compared case-insensitively). "unreadable" when `labels` is not a
 * list of objects with a string `name`.
 */
export function carriesAcceptLabel(labels: unknown, label: string): boolean | "unreadable" {
  if (!Array.isArray(labels)) return "unreadable";
  let found = false;
  for (const entry of labels) {
    if (!isRecord(entry) || typeof entry.name !== "string") return "unreadable";
    if (sameName(entry.name, label)) found = true;
  }
  return found;
}

/** Why a label was not honoured. */
export type AcceptIgnoredReason = "author" | "not-user" | "no-event" | "unreadable";

export type AcceptDecision = { honoured: true; by: string } | { honoured: false; reason: AcceptIgnoredReason };

/**
 * Decide from a pull request's issue events whether the accept label counts. The newest `labeled` event for the label
 * (compared case-insensitively; the API lists events oldest first) decides: its actor must be a user account whose
 * login is not the PR author's. Anything unreadable is not honoured.
 */
export function decideAcceptLabel(input: { label: string; authorLogin: string; events: unknown }): AcceptDecision {
  const { label, authorLogin, events } = input;
  if (!Array.isArray(events)) return { honoured: false, reason: "unreadable" };
  let newest: Record<string, unknown> | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event: unknown = events[i];
    if (!isRecord(event) || event.event !== "labeled") continue;
    const named = event.label;
    if (isRecord(named) && typeof named.name === "string" && sameName(named.name, label)) {
      newest = event;
      break;
    }
  }
  if (newest === undefined) return { honoured: false, reason: "no-event" };
  const actor = newest.actor;
  if (!isRecord(actor)) return { honoured: false, reason: "unreadable" };
  if (typeof actor.type !== "string") return { honoured: false, reason: "unreadable" };
  // The type is judged before the login, so claude[bot] is a bot, not an unreadable login.
  if (actor.type !== "User") return { honoured: false, reason: "not-user" };
  const login = actor.login;
  if (typeof login !== "string" || !GITHUB_LOGIN.test(login)) return { honoured: false, reason: "unreadable" };
  if (sameName(login, authorLogin)) return { honoured: false, reason: "author" };
  return { honoured: true, by: login };
}

/**
 * The report with `testIntegrity.acceptLabel` set to `label`, unless it is the default label in any letter case, when
 * the report is returned as it is. Returns a new report; never changes its input.
 */
export function withAcceptLabel(report: Report, label: string): Report {
  if (isDefaultAcceptLabel(label)) return report;
  return { ...report, testIntegrity: { ...report.testIntegrity, acceptLabel: label } };
}

const TEST_INTEGRITY_SIGNAL_CODE = /^TEST_INTEGRITY_TI\d\d$/;

function isSignalMessage(message: Message): boolean {
  return TEST_INTEGRITY_SIGNAL_CODE.test(message.code);
}

/** The messages with `added` put after the last `TEST_INTEGRITY_TI*` message, or at the end when there is none. */
function insertAfterSignalMessages(messages: readonly Message[], added: readonly Message[]): Message[] {
  let last = -1;
  messages.forEach((m, i) => {
    if (isSignalMessage(m)) last = i;
  });
  if (last === -1) return [...messages, ...added];
  return [...messages.slice(0, last + 1), ...added, ...messages.slice(last + 1)];
}

function signalsVerdict(signals: readonly TestIntegritySignal[]): "pass" | "warn" | "fail" {
  if (signals.some((s) => s.severity === "block")) return "fail";
  if (signals.some((s) => s.severity === "warn")) return "warn";
  return "pass";
}

/**
 * A reviewer's sign-off: every `block` signal becomes `warn` (same id, path, line, detail), the `TEST_INTEGRITY_TI*`
 * messages are rebuilt from the new severities, one `TEST_INTEGRITY_ACCEPTED` message and `testIntegrity.accepted`
 * record who accepted it, and both verdicts are recomputed. Other messages, such as a diff coverage error, stay.
 * `by` must already be a validated login. Returns a new report; never changes its input.
 */
export function acceptTestIntegrity(report: Report, accepted: { label: string; by: string }): Report {
  const signals = report.testIntegrity.signals.map((s) =>
    s.severity === "block" ? { ...s, severity: "warn" as const } : s,
  );
  const accepting: Message = {
    level: "info",
    code: "TEST_INTEGRITY_ACCEPTED",
    text: `The accept label "${accepted.label}" was applied by ${accepted.by}, who is not the PR author, so the block findings above are warnings.`,
  };
  // The TI02 and TI05 messages keep their text (and the "not listed" counts only the report held); their level follows.
  const rebuilt = testIntegritySignalMessages(signals, { previous: report.messages });
  const messages: Message[] = [];
  let placed = false;
  for (const message of report.messages) {
    if (!isSignalMessage(message)) {
      messages.push(message);
      continue;
    }
    if (placed) continue;
    messages.push(...rebuilt, accepting);
    placed = true;
  }
  if (!placed) messages.push(...rebuilt, accepting);
  return {
    ...report,
    verdict: verdictOf(messages),
    messages,
    testIntegrity: {
      ...report.testIntegrity,
      verdict: signalsVerdict(signals),
      accepted: { label: accepted.label, by: accepted.by },
      signals,
    },
  };
}

const IGNORED_BECAUSE: Record<AcceptIgnoredReason, string> = {
  author: "it was applied by the PR author, and a reviewer other than the author must apply it",
  "not-user": "it was not applied by a user account",
  "no-event": "no labeling event for it was found",
  unreadable: "the pull request or its labeling events could not be read",
};

/**
 * The label was looked at and does not count: one `TEST_INTEGRITY_ACCEPT_IGNORED` warn message after the
 * `TEST_INTEGRITY_TI*` messages, and nothing else changes except the verdict recomputed from the messages. The text is
 * a fixed sentence and the label; no login and nothing the API returned goes in it. Returns a new report.
 */
export function ignoreAcceptLabel(report: Report, label: string, reason: AcceptIgnoredReason): Report {
  const ignored: Message = {
    level: "warn",
    code: "TEST_INTEGRITY_ACCEPT_IGNORED",
    text: `The accept label "${label}" was ignored: ${IGNORED_BECAUSE[reason]}.`,
  };
  const messages = insertAfterSignalMessages(report.messages, [ignored]);
  return { ...report, verdict: verdictOf(messages), messages };
}
