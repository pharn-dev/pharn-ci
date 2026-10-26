import type { AgentPrFacts } from "@pharn-ci/core";
import type { PrNumberTarget } from "./pr-number.js";
import type { ActionDeps } from "./run.js";

/** Most pages of the pull request's commits read (100 commits each); a longer list is cut and counts as an agent PR. */
export const MAX_COMMIT_PAGES = 3;
/** Most commits a pull request may have for its commits to count as read in full. */
export const MAX_PR_COMMITS = 250;

/** How much of a commit message is kept, in UTF-16 code units (the same bound the trailer parser reads). */
const MAX_MESSAGE_UNITS = 65_536;

/** A GitHub login, with the `[bot]` suffix of an App. */
const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;

type Pr = NonNullable<AgentPrFacts["pr"]>;
type Author = NonNullable<Pr["author"]>;
type Commits = NonNullable<Pr["commits"]>;

/**
 * What the Action reads of the pull request for the agent PR detection: the author, the labels and the commit count from
 * the event payload (or, in PR-number mode, from the API), and the commits from the API. Everything is untrusted and is
 * shape-checked here; a value of the wrong shape reads as unknown, never as an error. Never rejects: whatever goes wrong,
 * the result is the fail-closed one (author unknown, commits unreadable), which counts as an agent PR. The commit messages
 * stay in memory inside the returned facts: nothing here logs, stores or returns any text of theirs beyond that.
 * No pull request in the run (no payload, no target) is `{ pr: null }`, with no API call.
 */
export async function gatherAgentPrFacts(
  deps: Pick<ActionDeps, "api" | "context">,
  target: PrNumberTarget | undefined,
): Promise<AgentPrFacts> {
  const payloadPr = deps.context.payload.pull_request;
  if (payloadPr === undefined && target === undefined) return { pr: null };
  try {
    let number: number;
    let rawAuthor: unknown;
    let rawLabels: unknown;
    let rawCount: unknown;
    if (payloadPr !== undefined) {
      number = payloadPr.number;
      rawAuthor = payloadPr.user;
      rawLabels = payloadPr.labels;
      rawCount = payloadPr.commits;
    } else {
      number = (target as PrNumberTarget).number;
      try {
        const signoff = await deps.api.getPullRequestSignoff(number);
        rawAuthor = signoff?.author;
        rawLabels = signoff?.labels;
        rawCount = signoff?.commits;
      } catch {
        // Author, labels and count stay unknown; the commits are still listed.
      }
    }
    const count = typeof rawCount === "number" && Number.isInteger(rawCount) && rawCount >= 0 ? rawCount : undefined;
    const { commits, cut } = await listCommits(deps, number);
    const incomplete =
      cut ||
      (commits !== null && commits.length > MAX_PR_COMMITS) ||
      (count !== undefined && (count > MAX_PR_COMMITS || (commits !== null && count !== commits.length)));
    return {
      pr: {
        author: authorOf(rawAuthor),
        labels: labelsOf(rawLabels),
        commits,
        ...(incomplete ? { commitsIncomplete: true } : {}),
      },
    };
  } catch {
    return { pr: { author: null, labels: [], commits: null } };
  }
}

/** The author when it is an object with a valid login and a known type; null otherwise (a Mannequin, no user). */
function authorOf(user: unknown): Author | null {
  if (typeof user !== "object" || user === null) return null;
  const { login, type } = user as { login?: unknown; type?: unknown };
  if (typeof login !== "string" || !LOGIN_PATTERN.test(login)) return null;
  if (type !== "User" && type !== "Bot" && type !== "Organization") return null;
  return { login, type };
}

/** The label names of an array of label objects; anything else reads as no labels. */
function labelsOf(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  const names: string[] = [];
  for (const label of labels as unknown[]) {
    const name = typeof label === "object" && label !== null ? (label as { name?: unknown }).name : undefined;
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/** A valid login of a commit's `author` or `committer` object, or null. */
function loginOf(user: unknown): string | null {
  if (typeof user !== "object" || user === null) return null;
  const login = (user as { login?: unknown }).login;
  return typeof login === "string" && LOGIN_PATTERN.test(login) ? login : null;
}

/**
 * The pull request's commits, in pages of 100 up to MAX_COMMIT_PAGES. `commits` is null when a request rejects, a page is
 * not a list, or an entry has no string message. `cut` is true when the last page read still has a next page.
 */
async function listCommits(
  deps: Pick<ActionDeps, "api">,
  number: number,
): Promise<{ commits: Commits | null; cut: boolean }> {
  const commits: Commits[number][] = [];
  try {
    for (let page = 1; page <= MAX_COMMIT_PAGES; page++) {
      const res = await deps.api.listPullRequestCommits(number, page);
      if (typeof res !== "object" || res === null || !Array.isArray(res.commits)) return { commits: null, cut: false };
      for (const entry of res.commits as unknown[]) {
        if (typeof entry !== "object" || entry === null) return { commits: null, cut: false };
        const { commit, author, committer } = entry as { commit?: unknown; author?: unknown; committer?: unknown };
        const message =
          typeof commit === "object" && commit !== null ? (commit as { message?: unknown }).message : undefined;
        if (typeof message !== "string") return { commits: null, cut: false };
        commits.push({
          authorLogin: loginOf(author),
          committerLogin: loginOf(committer),
          message: message.slice(0, MAX_MESSAGE_UNITS),
        });
      }
      if (res.hasNext !== true) return { commits, cut: false };
    }
  } catch {
    return { commits: null, cut: false };
  }
  return { commits, cut: true };
}
