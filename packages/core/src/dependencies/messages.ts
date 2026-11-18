import { codeSpan, type Message, type MessageCode } from "../report.js";
import { DEPENDENCY_SOURCE_LIMITS } from "../testSources.js";
import type { DependencySignal, DependencySignalId } from "./types.js";

/** The most locations or paths one dependency message names; the rest are counted. */
const NAMED = 10;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Up to 10 `path:line` code spans (or paths), then `+N more`. */
function locations(signals: readonly DependencySignal[]): string {
  const named = signals
    .slice(0, NAMED)
    .map((s) => codeSpan(s.line === null ? s.path : `${s.path}:${s.line}`))
    .join(", ");
  const more = signals.length - NAMED;
  return more > 0 ? `${named}, +${more} more` : named;
}

/** The text of the one message a signal id adds; `min` is the threshold D02 and D03 used. */
function signalText(id: DependencySignalId, signals: readonly DependencySignal[], min: number): string {
  const n = signals.length;
  const where = locations(signals);
  switch (id) {
    case "D01":
      return `${n} added ${plural(n, "package does", "packages do")} not exist in the registry, which is how slopsquatting starts: ${where}.`;
    case "D02":
      return `${n} added ${plural(n, "package was", "packages were")} first published fewer than ${min} days before the head commit: ${where}.`;
    case "D03":
      return `${n} added npm ${plural(n, "package was", "packages were")} downloaded fewer than ${min} times last week: ${where}.`;
    case "D04":
      return `${n} lockfile drift ${plural(n, "finding", "findings")}: a manifest's dependencies and its lockfile do not agree, or a lockfile gives a version a different hash than the merge base did: ${where}.`;
    case "D05":
      return `${n} ${plural(n, "dependency comes", "dependencies come")} from outside the allowed registries (a git repository, a URL on another host or a local file): ${where}.`;
  }
}

/**
 * One message per signal id with findings, in id order: `DEPENDENCY_<id>`, an error when any finding of the id blocks,
 * else a warning. The text names counts, thresholds and up to 10 locations, never a package name or file text.
 */
export function dependencySignalMessages(
  signals: readonly DependencySignal[],
  thresholds: { minAgeDays: number; minWeeklyDownloads: number },
): Message[] {
  const messages: Message[] = [];
  for (const id of ["D01", "D02", "D03", "D04", "D05"] as const) {
    const ofId = signals.filter((signal) => signal.id === id);
    if (ofId.length === 0) continue;
    const min = id === "D02" ? thresholds.minAgeDays : thresholds.minWeeklyDownloads;
    messages.push({
      level: ofId.some((signal) => signal.severity === "block") ? "error" : "warn",
      code: `DEPENDENCY_${id}` as MessageCode,
      text: signalText(id, ofId, min),
    });
  }
  return messages;
}

/** The `DEPENDENCY_LOOKUP_UNAVAILABLE` warning: how many added packages were not looked up, and why, in fixed words. */
export function lookupUnavailableMessage(counts: { unanswered: number; overCap: number; planned: number }): Message {
  const missed = counts.unanswered + counts.overCap;
  const total = counts.planned + counts.overCap;
  const reasons: string[] = [];
  if (counts.unanswered > 0) {
    reasons.push(
      `${counts.unanswered} got no usable answer from the registry (a timeout, a network error or an error status)`,
    );
  }
  if (counts.overCap > 0) reasons.push(`${counts.overCap} were over the limit of 50 lookups per run`);
  return {
    level: "warn",
    code: "DEPENDENCY_LOOKUP_UNAVAILABLE",
    text: `Registry lookups did not complete for ${missed} of ${total} added ${plural(total, "package", "packages")}, so D01 to D03 were not checked for ${plural(missed, "it", "them")}: ${reasons.join("; ")}.`,
  };
}

const mib = (bytes: number) => `${bytes / 1_048_576} MiB`;

/** The cap a file went past, after its reason; empty for a reason that is no cap. */
function capWords(reason: string): string {
  switch (reason) {
    case "too-large":
      return `: over the ${mib(DEPENDENCY_SOURCE_LIMITS.fileBytes)} cap for one file`;
    case "over-total-cap":
      return `: past the ${mib(DEPENDENCY_SOURCE_LIMITS.totalBytes)} cap for one side`;
    case "over-file-cap":
      return `: past the ${DEPENDENCY_SOURCE_LIMITS.files}-file cap for one side`;
    default:
      return "";
  }
}

/**
 * The `DEPENDENCY_CHECK_INCOMPLETE` message: the manifests and lockfiles that could not be read, each with its fixed
 * reason and, past a cap, the cap. An error (CORE-100) when any file's reason is one the pull request can cause (it is
 * unparsable, over a cap, binary, missing at its revision or an unsafe path), so a file the check could not read never
 * passes where the same file read would block; a warning only when every file is `unavailable` (git could not read
 * that side at all, which is the runner's doing, not the pull request's).
 */
export function checkIncompleteMessage(unread: readonly { path: string; reason: string }[]): Message {
  const n = unread.length;
  const named = unread
    .slice(0, NAMED)
    .map((file) => `${codeSpan(file.path)} (${file.reason}${capWords(file.reason)})`)
    .join(", ");
  const more = n - NAMED;
  return {
    level: unread.every((file) => file.reason === "unavailable") ? "warn" : "error",
    code: "DEPENDENCY_CHECK_INCOMPLETE",
    text: `${n} manifest or lockfile ${plural(n, "file", "files")} could not be read, so dependency safety did not check ${plural(n, "it", "them")}: ${named}${more > 0 ? `, +${more} more` : ""}.`,
  };
}
