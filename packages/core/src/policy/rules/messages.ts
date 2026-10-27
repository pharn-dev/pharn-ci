import type { AgentEvidence } from "../../agents.js";
import { codeSpan, type Message, type MessageCode } from "../../report.js";
import type { PolicyRuleId } from "../types.js";
import { P11_BASE_UNREADABLE_DETAIL, P11_DIFF_UNAVAILABLE_DETAIL } from "./p11.js";
import { levelOf, strongest } from "./severity.js";
import type { PolicyEvaluation, PolicyViolation } from "./types.js";

/** The most paths a rule message names; the rest are counted. */
const MAX_LISTED = 20;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The first 20 paths as code spans joined with `, `, then ` and N more` when there are more than 20. */
function listOf(paths: readonly string[], total: number): string {
  const named = paths.slice(0, MAX_LISTED).map(codeSpan).join(", ");
  return total > MAX_LISTED ? `${named} and ${total - MAX_LISTED} more` : named;
}

/** The distinct, non-null paths of violations. */
function pathsOf(violations: readonly PolicyViolation[]): string[] {
  return [...new Set(violations.flatMap((violation) => (violation.path === null ? [] : [violation.path])))];
}

/** The fixed words that name each kind of agent evidence in the P11 message; no label, login or file text is ever quoted. */
const EVIDENCE_WORDS: Record<AgentEvidence, string> = {
  "author-bot": "a bot author",
  "author-known-agent": "a known agent as author",
  "author-extra-login": "an author login the policy lists",
  "commit-bot": "a bot commit",
  "commit-known-agent": "a commit by a known agent",
  "commit-extra-login": "a commit by a login the policy lists",
  "co-author-known-agent": "a known agent's Co-authored-by trailer",
  "co-author-extra-login": "a Co-authored-by trailer of a login the policy lists",
  label: "an agent label",
};

/**
 * The message of each rule that has one, from its violations, the number a cap left out and the whole evaluation. P01
 * and P10 have no row: P01 raises the agent setup messages and P10 is the POLICY_UNAVAILABLE message.
 */
const RULE_MESSAGES: Partial<
  Record<PolicyRuleId, (violations: PolicyViolation[], omitted: number, evaluation: PolicyEvaluation) => string>
> = {
  P11: (violations, omitted, evaluation) => {
    const sentences: string[] = [];
    const kept = pathsOf(violations);
    const total = kept.length + omitted;
    if (total > 0) {
      const head =
        total === 1
          ? "This agent pull request changes 1 path the org policy protects"
          : `This agent pull request changes ${total} paths the org policy protects`;
      const notListed =
        omitted > 0 ? ` ${omitted} of ${omitted === 1 ? "them is" : "them are"} not listed in the report.` : "";
      sentences.push(`${head}: ${listOf(kept, total)}.${notListed}`);
    }
    if (violations.some((violation) => violation.detail === P11_DIFF_UNAVAILABLE_DETAIL)) {
      sentences.push(
        "This agent pull request could not be checked against the paths the org policy protects, because the diff is unavailable.",
      );
    }
    if (violations.some((violation) => violation.detail === P11_BASE_UNREADABLE_DETAIL)) {
      sentences.push(
        "This agent pull request edits the policy file, and its version at the merge base could not be read, so the paths that version protects could not be checked.",
      );
    }
    const words = (evaluation.agentPr?.evidence ?? []).map((kind) => EVIDENCE_WORDS[kind]);
    const incomplete = evaluation.agentPr?.incomplete ?? null;
    if (incomplete !== null) words.push(`evidence it could not read (${codeSpan(incomplete)})`);
    sentences.push(`It counts as an agent PR by: ${words.join("; ")}.`);
    return sentences.join(" ");
  },
  P08: (violations, omitted) => {
    const kept = pathsOf(violations);
    const total = kept.length + omitted;
    const head =
      total === 1
        ? "This repository tracks 1 file that matches a forbidden file pattern of the org policy"
        : `This repository tracks ${total} files that match a forbidden file pattern of the org policy`;
    const notListed =
      total > 50 ? ` ${total - 50} of ${total - 50 === 1 ? "them is" : "them are"} not listed in the report.` : "";
    return `${head}: ${listOf(kept, total)}.${notListed}`;
  },
  P09: (violations) => {
    const paths = pathsOf(violations).sort(byCodeUnit);
    const total = paths.length;
    const head =
      total === 1
        ? "This change edits 1 file that the org policy guards"
        : `This change edits ${total} files that the org policy guards`;
    return `${head}: ${listOf(paths, total)}. The reason for each is in the report's policy violations.`;
  },
};

/**
 * One message per rule id that has violations and a row in the table, in id order. The level is the strongest severity
 * of that id's violations: block is an error, warn a warning, info info.
 */
export function policyRuleMessages(evaluation: PolicyEvaluation): Message[] {
  const messages: Message[] = [];
  const ids = [...new Set(evaluation.violations.map((violation) => violation.id))].sort(byCodeUnit) as PolicyRuleId[];
  for (const id of ids) {
    const text = RULE_MESSAGES[id];
    if (text === undefined) continue;
    const own = evaluation.violations.filter((violation) => violation.id === id);
    messages.push({
      level: levelOf(strongest(own.map((violation) => violation.severity))),
      code: `POLICY_${id}` as MessageCode,
      text: text(own, evaluation.omitted[id] ?? 0, evaluation),
    });
  }
  return messages;
}
