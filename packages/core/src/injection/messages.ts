import { MAX_ADDED_TEXT_CHARS, MAX_ADDED_TEXT_LINES } from "../diff/unified.js";
import type { InjectionSignalId } from "../policy/types.js";
import { codeSpan, type Message, type MessageCode } from "../report.js";
import { INJECTION_SIGNAL_IDS } from "./policy.js";
import type { InjectionSignal, OmittedInjection } from "./scan.js";

/** The most locations one message names; the rest are counted. */
const MAX_LOCATIONS = 5;
/** The most cut files the truncated message names; the rest are counted. */
const MAX_CUT_FILES = 5;

const CODES: Readonly<Record<InjectionSignalId, MessageCode>> = {
  PI01: "INJECTION_PI01",
  PI02: "INJECTION_PI02",
  PI03: "INJECTION_PI03",
  PI04: "INJECTION_PI04",
  PI05: "INJECTION_PI05",
};

/** What each signal found, as the start of its message. Fixed words. */
const SENTENCES: Readonly<Record<InjectionSignalId, string>> = {
  PI01: "This change adds invisible or bidirectional Unicode characters, which can hide text from a reviewer or reorder what an agent reads (PI01)",
  PI02: "This change adds hidden Markdown text (an HTML comment, a link title or a reference definition) that addresses an agent (PI02)",
  PI03: "This change adds known prompt-injection phrases (PI03)",
  PI04: "This change adds a long base64 or hex blob to an agent instruction file, which an agent may decode and follow (PI04)",
  PI05: "This change adds agent instruction files inside a vendored directory, where an agent may read them as instructions (PI05)",
};

/** The first locations as `` `path` line N `` (or `` `path` `` for a file-level finding), then ` and M more`. */
function locations(signals: readonly InjectionSignal[]): string {
  const named = signals
    .slice(0, MAX_LOCATIONS)
    .map((signal) => (signal.line === null ? codeSpan(signal.path) : `${codeSpan(signal.path)} line ${signal.line}`))
    .join(", ");
  const more = signals.length - MAX_LOCATIONS;
  return more > 0 ? `${named} and ${more} more` : named;
}

/**
 * The messages of the prompt-injection scan. One `INJECTION_<id>` message per signal id found, in id order: its level
 * is the highest severity among the findings of the id (error for block, warn, else info), and its text names up to 5
 * locations (path and line) and how many findings the cap left out, never any file text. Then one
 * `INJECTION_TEXT_TRUNCATED` warning when some files were too large to scan in full.
 */
export function injectionMessages(
  signals: readonly InjectionSignal[],
  omitted: readonly OmittedInjection[],
  cut: readonly string[],
): Message[] {
  const messages: Message[] = [];
  for (const id of INJECTION_SIGNAL_IDS) {
    const own = signals.filter((signal) => signal.id === id);
    if (own.length === 0) continue;
    const level = own.some((s) => s.severity === "block")
      ? "error"
      : own.some((s) => s.severity === "warn")
        ? "warn"
        : "info";
    const left = omitted.filter((entry) => entry.id === id).reduce((sum, entry) => sum + entry.count, 0);
    const notListed = left > 0 ? ` ${left} more ${left === 1 ? "finding is" : "findings are"} not listed.` : "";
    messages.push({ level, code: CODES[id], text: `${SENTENCES[id]}: ${locations(own)}.${notListed}` });
  }
  if (cut.length > 0) {
    const named = cut.slice(0, MAX_CUT_FILES).map(codeSpan).join(", ");
    const more = cut.length - MAX_CUT_FILES;
    messages.push({
      level: "warn",
      code: "INJECTION_TEXT_TRUNCATED",
      text: `This change is too large to scan in full for hidden instructions: the content scan reads the first ${MAX_ADDED_TEXT_LINES} added lines of a file and ${MAX_ADDED_TEXT_CHARS} characters of added text in all, so a finding past them is not seen in ${named}${more > 0 ? ` and ${more} more` : ""}.`,
    });
  }
  return messages;
}
