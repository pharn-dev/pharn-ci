import type { Report, ReportMeta } from "./report.js";

/** The coding agents pharn-ci recognizes by name. */
export type AgentHint = "claude-code" | "copilot" | "codex" | "devin" | "cursor" | "gemini" | "jules";

/** One known agent: the GitHub logins and commit e-mail addresses it is known by (compared in lower case). */
export interface KnownAgent {
  hint: AgentHint;
  logins: readonly string[];
  emails: readonly string[];
}

const agent = (hint: AgentHint, logins: readonly string[], emails: readonly string[]): KnownAgent =>
  Object.freeze({ hint, logins: Object.freeze([...logins]), emails: Object.freeze([...emails]) });

/** The verified known agents, in a fixed order: that order decides the hint when several agents show up. */
export const KNOWN_AGENTS: readonly KnownAgent[] = Object.freeze([
  agent("claude-code", ["claude[bot]"], ["noreply@anthropic.com"]),
  agent("copilot", ["Copilot", "copilot-swe-agent[bot]"], []),
  agent("codex", ["chatgpt-codex-connector[bot]"], []),
  agent("devin", ["devin-ai-integration[bot]"], []),
  agent("cursor", ["cursor[bot]", "cursoragent"], ["cursoragent@cursor.com"]),
  agent("gemini", ["gemini-code-assist[bot]"], []),
  agent("jules", ["google-labs-jules[bot]"], []),
]);

/** Pull request labels that mark an agent PR, compared in lower case. A given list adds to these, never replaces them. */
export const DEFAULT_AGENT_LABELS: readonly string[] = Object.freeze(["agent", "ai-generated"]);

/** How much of a commit message is read for trailers, in UTF-16 code units. */
const MAX_MESSAGE_UNITS = 65_536;
/** Trailers read from one message. */
const MAX_TRAILERS = 50;
/** Co-author entries kept. */
const MAX_CO_AUTHORS = 20;
/** Pull request labels kept in the meta, and the code points kept of each. */
const MAX_META_LABELS = 100;
const MAX_META_LABEL_CODE_POINTS = 50;

const TRAILER_PREFIX = "co-authored-by:";

/** A pull request author's login, as GitHub allows it, with the `[bot]` suffix of an App. */
const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}(\[bot\])?$/;
/** A GitHub noreply address; the login is group 1. Run only on an e-mail the trailer parser already bounded. */
const NOREPLY_PATTERN = /^(?:[0-9]+\+)?([^@+]+)@users\.noreply\.github\.com$/i;

/** Whitespace as one code unit, for the trailer's e-mail. */
function isSpaceUnit(c: number): boolean {
  return (
    c <= 0x20 ||
    c === 0x7f ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

/** The trailer on `text[from, to)`, or null. One indexed pass and one backward scan: linear in the line. */
function trailerOnLine(text: string, from: number, to: number): { name: string; email: string } | null {
  let i = from;
  while (i < to && (text.charCodeAt(i) === 0x20 || text.charCodeAt(i) === 0x09)) i++;
  if (to - i < TRAILER_PREFIX.length) return null;
  if (text.slice(i, i + TRAILER_PREFIX.length).toLowerCase() !== TRAILER_PREFIX) return null;
  const rest = text.slice(i + TRAILER_PREFIX.length, to).trim();
  if (!rest.endsWith(">")) return null;
  const lt = rest.lastIndexOf("<");
  if (lt === -1) return null;
  const email = rest.slice(lt + 1, rest.length - 1);
  if (email === "") return null;
  for (let k = 0; k < email.length; k++) {
    const c = email.charCodeAt(k);
    if (isSpaceUnit(c) || c === 0x3c || c === 0x3e) return null;
  }
  return { name: rest.slice(0, lt).trim(), email };
}

/**
 * The `Co-authored-by: Name <email>` lines of a commit message, in order: at most 50, read from the first 65,536 code
 * units. A line may start with spaces or tabs and may be in any letter case; it needs a non-empty `<email>` without
 * whitespace. Linear in the message, with no regular expression over it.
 */
export function parseCoAuthorTrailers(message: string): { name: string; email: string }[] {
  if (typeof message !== "string") return [];
  const text = message.length > MAX_MESSAGE_UNITS ? message.slice(0, MAX_MESSAGE_UNITS) : message;
  const trailers: { name: string; email: string }[] = [];
  let start = 0;
  while (start <= text.length && trailers.length < MAX_TRAILERS) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const lineEnd = end > start && text.charCodeAt(end - 1) === 0x0d ? end - 1 : end;
    const trailer = trailerOnLine(text, start, lineEnd);
    if (trailer !== null) trailers.push(trailer);
    start = end + 1;
  }
  return trailers;
}

/** What the Action read of a pull request. Untrusted data, shape-checked by the caller; nothing in it removes evidence. */
export interface AgentPrFacts {
  pr: {
    /** `null`: unknown, or not a valid login and type. */
    author: { login: string; type: "User" | "Bot" | "Organization" } | null;
    /** The pull request's label names. */
    labels: readonly string[];
    /** `null`: the commits could not be read. */
    commits: readonly { authorLogin: string | null; committerLogin: string | null; message: string }[] | null;
    /** `true`: the list is not all of the commits. */
    commitsIncomplete?: boolean;
  } | null; // null: the run has no pull request
  /** Extra agent labels, united with `DEFAULT_AGENT_LABELS`; never replaces them. */
  labels?: readonly string[];
  /** Extra agent logins. */
  extraLogins?: readonly string[];
}

export type AgentEvidence =
  | "author-bot"
  | "author-known-agent"
  | "author-extra-login"
  | "commit-bot"
  | "commit-known-agent"
  | "commit-extra-login"
  | "co-author-known-agent"
  | "co-author-extra-login"
  | "label";

/** The evidence kinds in their fixed output order. */
const EVIDENCE_ORDER: readonly AgentEvidence[] = [
  "author-bot",
  "author-known-agent",
  "author-extra-login",
  "commit-bot",
  "commit-known-agent",
  "commit-extra-login",
  "co-author-known-agent",
  "co-author-extra-login",
  "label",
];

/** Why detection could not read all of the evidence; any of these makes the pull request an agent PR. */
export type AgentPrIncomplete = "author-unknown" | "commits-unreadable" | "commits-truncated";

export interface AgentPrDetection {
  isAgentPr: boolean;
  /** The known agent of the lowest index in the agent list among the matches, or null. */
  agentHint: AgentHint | null;
  evidence: AgentEvidence[];
  incomplete: AgentPrIncomplete | null;
  /** Agent co-authors only, as `<hint or login> <email>`; at most 20. */
  coAuthors: string[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * Whether a pull request counts as an agent PR, from what it carries: its author, its commits' authors, committers and
 * Co-authored-by trailers, and its labels. Evidence is only ever added: nothing in the facts removes any. Facts that
 * cannot be read in full set `incomplete`, and `incomplete` alone makes the pull request an agent PR. Never throws.
 */
export function detectAgentPr(facts: AgentPrFacts, agents: readonly KnownAgent[] = KNOWN_AGENTS): AgentPrDetection {
  const pr = facts?.pr;
  if (pr === null || pr === undefined || typeof pr !== "object") {
    return { isAgentPr: false, agentHint: null, evidence: [], incomplete: null, coAuthors: [] };
  }

  // Lower-case lookups; the first agent in the list wins a login or e-mail two agents share.
  const loginAgent = new Map<string, number>();
  const emailAgent = new Map<string, number>();
  agents.forEach((a, index) => {
    for (const login of strings(a.logins))
      if (!loginAgent.has(login.toLowerCase())) loginAgent.set(login.toLowerCase(), index);
    for (const email of strings(a.emails))
      if (!emailAgent.has(email.toLowerCase())) emailAgent.set(email.toLowerCase(), index);
  });
  const extraLogins = new Set(strings(facts.extraLogins).map((l) => l.toLowerCase()));
  const labelSet = new Set([...DEFAULT_AGENT_LABELS, ...strings(facts.labels)].map((l) => l.toLowerCase()));

  const found = new Set<AgentEvidence>();
  let hintIndex = Number.POSITIVE_INFINITY;
  const coAuthors: string[] = [];
  const known = (index: number) => {
    if (index < hintIndex) hintIndex = index;
  };

  // The pull request's author.
  const rawAuthor: unknown = pr.author;
  let author: { login: string; type: string } | null = null;
  if (rawAuthor !== null && typeof rawAuthor === "object") {
    const { login, type } = rawAuthor as { login?: unknown; type?: unknown };
    if (typeof login === "string" && typeof type === "string") author = { login, type };
  }
  if (author !== null) {
    const login = author.login.toLowerCase();
    if (author.type === "Bot" || login.endsWith("[bot]")) found.add("author-bot");
    const index = loginAgent.get(login);
    if (index !== undefined) {
      found.add("author-known-agent");
      known(index);
    }
    if (extraLogins.has(login)) found.add("author-extra-login");
  }

  // The commits: their authors, committers and trailers.
  const commits: unknown = pr.commits;
  if (Array.isArray(commits)) {
    for (const commit of commits as unknown[]) {
      if (commit === null || typeof commit !== "object") continue;
      const { authorLogin, committerLogin, message } = commit as {
        authorLogin?: unknown;
        committerLogin?: unknown;
        message?: unknown;
      };
      for (const raw of [authorLogin, committerLogin]) {
        if (typeof raw !== "string") continue;
        const login = raw.toLowerCase();
        if (login.endsWith("[bot]")) found.add("commit-bot");
        const index = loginAgent.get(login);
        if (index !== undefined) {
          found.add("commit-known-agent");
          known(index);
        }
        if (extraLogins.has(login)) found.add("commit-extra-login");
      }
      if (typeof message !== "string") continue;
      for (const trailer of parseCoAuthorTrailers(message)) {
        const email = trailer.email.toLowerCase();
        const noreply = NOREPLY_PATTERN.exec(email);
        const login = noreply === null ? null : (noreply[1] as string);
        const index = login === null ? emailAgent.get(email) : loginAgent.get(login);
        const extra = login !== null && extraLogins.has(login);
        if (index !== undefined) {
          found.add("co-author-known-agent");
          known(index);
        }
        if (extra) found.add("co-author-extra-login");
        // A trailer that matches nothing adds nothing: its name and e-mail are dropped here.
        let entry: string | undefined;
        if (index !== undefined) entry = `${agents[index]?.hint} <${email}>`;
        else if (extra) entry = `${login} <${email}>`;
        if (entry !== undefined && coAuthors.length < MAX_CO_AUTHORS && !coAuthors.includes(entry))
          coAuthors.push(entry);
      }
    }
  }

  // The labels, by exact lower-case equality.
  for (const label of strings(pr.labels)) {
    if (labelSet.has(label.toLowerCase())) {
      found.add("label");
      break;
    }
  }

  let incomplete: AgentPrIncomplete | null = null;
  if (author === null) incomplete = "author-unknown";
  else if (!Array.isArray(commits)) incomplete = "commits-unreadable";
  else if (pr.commitsIncomplete === true) incomplete = "commits-truncated";

  const evidence = EVIDENCE_ORDER.filter((kind) => found.has(kind));
  return {
    isAgentPr: evidence.length > 0 || incomplete !== null,
    agentHint: Number.isFinite(hintIndex) ? (agents[hintIndex]?.hint ?? null) : null,
    evidence,
    incomplete,
    coAuthors,
  };
}

/**
 * The agent fields of a report's `meta`. No pull request: exactly `{ isAgentPr: false }`. Otherwise the flag, the
 * author when it is a valid login and type, the first 100 labels cut to 50 code points, the agent co-authors and the
 * hint. No trailer name and no commit message is read here.
 */
export function agentPrMetaFields(
  detection: AgentPrDetection,
  facts: AgentPrFacts,
): Pick<ReportMeta, "isAgentPr" | "prAuthor" | "prLabels" | "coAuthors" | "agentHint"> {
  const pr = facts?.pr;
  if (pr === null || pr === undefined || typeof pr !== "object") return { isAgentPr: false };
  const author: unknown = pr.author;
  let prAuthor: NonNullable<ReportMeta["prAuthor"]> | null = null;
  if (author !== null && typeof author === "object") {
    const { login, type } = author as { login?: unknown; type?: unknown };
    if (
      typeof login === "string" &&
      LOGIN_PATTERN.test(login) &&
      (type === "User" || type === "Bot" || type === "Organization")
    ) {
      prAuthor = { login, type };
    }
  }
  return {
    isAgentPr: detection.isAgentPr,
    prAuthor,
    prLabels: strings(pr.labels)
      .slice(0, MAX_META_LABELS)
      .map((label) => Array.from(label).slice(0, MAX_META_LABEL_CODE_POINTS).join("")),
    coAuthors: detection.coAuthors.slice(0, MAX_CO_AUTHORS),
    agentHint: detection.agentHint,
  };
}

/** The report with the agent fields merged into its `meta`; without `meta` it is returned as it is. Verdict and messages are untouched. */
export function withAgentPrMeta(report: Report, detection: AgentPrDetection, facts: AgentPrFacts): Report {
  if (report.meta === undefined) return report;
  return { ...report, meta: { ...report.meta, ...agentPrMetaFields(detection, facts) } };
}
