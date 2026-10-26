import { codeSpan, type Message, type MessageCode } from "../../report.js";
import type { PolicyRuleId } from "../types.js";
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

/**
 * The message of each rule that has one, from its violations and the number a cap left out. P01 and P10 have no row:
 * P01 raises the agent setup messages and P10 is the POLICY_UNAVAILABLE message.
 */
const RULE_MESSAGES: Partial<Record<PolicyRuleId, (violations: PolicyViolation[], omitted: number) => string>> = {
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
      text: text(own, evaluation.omitted[id] ?? 0),
    });
  }
  return messages;
}
