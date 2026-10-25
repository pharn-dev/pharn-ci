import {
  type AcceptIgnoredReason,
  acceptTestIntegrity,
  carriesAcceptLabel,
  decideAcceptLabel,
  ignoreAcceptLabel,
  type Report,
  withAcceptLabel,
} from "@pharn-ci/core";
import type { ActionDeps } from "./run.js";

/** Most pages of issue events read (100 events each); a longer list is not read and the label is ignored. */
export const MAX_EVENT_PAGES = 10;

type Reads = Pick<ActionDeps, "api" | "info">;

/**
 * Apply the accept label to the report `check()` returned. The label is only looked at when the run is for a pull
 * request (`pullNumber` is given), test integrity is in mode block, and at least one signal blocks. Then the pull
 * request is read; nothing more is asked unless it carries the label. Whatever cannot be read, or does not have the
 * expected shape, counts as unreadable: the label is ignored and the blocks stand. The only text taken from the API is a
 * login that matches GitHub's login pattern, and only when the label is honoured; log lines and messages are fixed.
 */
export async function applyAcceptLabel(
  deps: Reads,
  report: Report,
  label: string,
  pullNumber: number | undefined,
): Promise<Report> {
  const labelled = withAcceptLabel(report, label);
  if (pullNumber === undefined) return labelled;
  const { mode, signals } = labelled.testIntegrity;
  if (mode !== "block" || !signals.some((s) => s.severity === "block")) return labelled;

  const ignored = (reason: AcceptIgnoredReason): Report => {
    deps.info(`accept label ignored: ${reason}`);
    return ignoreAcceptLabel(labelled, label, reason);
  };

  let signoff: { author: unknown; labels: unknown };
  try {
    signoff = await deps.api.getPullRequestSignoff(pullNumber);
  } catch {
    return ignored("unreadable");
  }
  const authorLogin = loginOf(signoff?.author);
  if (authorLogin === undefined) return ignored("unreadable");
  const carries = carriesAcceptLabel(signoff.labels, label);
  if (carries === "unreadable") return ignored("unreadable");
  // No label, nothing asked: no events request and no message.
  if (!carries) return labelled;

  const events = await readEvents(deps, pullNumber);
  if (events === undefined) return ignored("unreadable");
  const decision = decideAcceptLabel({ label, authorLogin, events });
  if (!decision.honoured) return ignored(decision.reason);
  deps.info("accept label honoured");
  return acceptTestIntegrity(labelled, { label, by: decision.by });
}

/** A non-empty string login of a GitHub user object, or undefined. */
function loginOf(user: unknown): string | undefined {
  if (typeof user !== "object" || user === null) return undefined;
  const login = (user as { login?: unknown }).login;
  return typeof login === "string" && login !== "" ? login : undefined;
}

/**
 * All issue events of the pull request, oldest first, read in pages of 100. Undefined when a request rejects, a page is
 * not a list, or the list does not end within MAX_EVENT_PAGES pages.
 */
async function readEvents(deps: Reads, pullNumber: number): Promise<unknown[] | undefined> {
  const events: unknown[] = [];
  try {
    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      const res = await deps.api.listIssueEvents(pullNumber, page);
      if (typeof res !== "object" || res === null || !Array.isArray(res.events)) return undefined;
      events.push(...res.events);
      if (res.hasNext !== true) return events;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
