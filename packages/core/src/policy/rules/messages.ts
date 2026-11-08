import type { AgentEvidence } from "../../agents.js";
import { codeSpan, type Message, type MessageCode } from "../../report.js";
import { byCodeUnit, replaceUnsafeChars } from "../../text.js";
import type { PolicyRuleId } from "../types.js";
import { P07_PACKAGE_MANAGER_PREFIX, P07_TEST_RUNNER_PREFIX, P07_UNREAD_DETAIL } from "./p07.js";
import { P11_BASE_UNREADABLE_DETAIL, P11_DIFF_UNAVAILABLE_DETAIL } from "./p11.js";
import { P13_DIFF_UNAVAILABLE_DETAIL } from "./p13.js";
import { P14_BASE_UNREADABLE_DETAIL, P14_DIFF_UNAVAILABLE_DETAIL } from "./p14.js";
import { levelOf, strongest } from "./severity.js";
import type { PolicyEvaluation, PolicyViolation } from "./types.js";

/** The most paths a rule message names; the rest are counted. */
const MAX_LISTED = 20;

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
 * The distinct (path, line) locations of the kept violations in violation order, the first 20 as `path` line N (or just
 * the path for a null line), then ` and M more` for the locations not shown and the violations a cap left out.
 */
function locsOf(violations: readonly PolicyViolation[], omitted: number): string {
  const seen = new Set<string>();
  const locations: string[] = [];
  for (const violation of violations) {
    if (violation.path === null) continue;
    const key = `${violation.path}\u0000${violation.line ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(
      violation.line === null ? codeSpan(violation.path) : `${codeSpan(violation.path)} line ${violation.line}`,
    );
  }
  const more = locations.length - Math.min(locations.length, MAX_LISTED) + omitted;
  const named = locations.slice(0, MAX_LISTED).join(", ");
  return more > 0 ? `${named} and ${more} more` : named;
}

/** P14's size detail (`detectP14`): the count, `files` or `lines`, the cap and the areas. */
const P14_SIZE_DETAIL = /^agent PR changes (\d+) (files|lines) \(cap (\d+)\); split it by area: (.*)$/s;

/** `1 thing` or `n things`. */
const counted = (n: number, singular: string, plural: string): string => (n === 1 ? `1 ${singular}` : `${n} ${plural}`);

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
  P13: (violations, omitted, evaluation) => {
    const sentences: string[] = [];
    const kept = pathsOf(violations);
    const total = kept.length + omitted;
    if (total > 0) {
      sentences.push(
        `This agent pull request widens what an agent may do, or changes a file that governs it in a way pharn-ci could not compare, in ${counted(total, "file", "files")}: ${listOf(kept, total)}. What each one widens is in the report's policy violations.`,
      );
    }
    if (violations.some((violation) => violation.detail === P13_DIFF_UNAVAILABLE_DETAIL)) {
      sentences.push(
        "This agent pull request could not be checked for changes to agent settings, MCP configs, workflows and CODEOWNERS, because the diff is unavailable.",
      );
    }
    const words = (evaluation.agentPr?.evidence ?? []).map((kind) => EVIDENCE_WORDS[kind]);
    const incomplete = evaluation.agentPr?.incomplete ?? null;
    if (incomplete !== null) words.push(`evidence it could not read (${codeSpan(incomplete)})`);
    if (words.length > 0) sentences.push(`It counts as an agent PR by: ${words.join("; ")}.`);
    return sentences.join(" ");
  },
  P02: (violations, omitted) =>
    `P02 forbidden permission allowed: ${counted(violations.length + omitted, "finding", "findings")} at ${locsOf(violations, omitted)}. Each is an allow rule equal to, broader than or inside a permission the org policy forbids, a defaultMode of bypassPermissions or auto, or additionalDirectories.`,
  P03: (violations, omitted) =>
    `P03 required deny missing: ${counted(violations.length + omitted, "required deny rule", "required deny rules")} not covered by a deny rule at ${locsOf(violations, omitted)}. A deny rule counts when it is equal to or broader than the required one.`,
  P04: (violations, omitted) =>
    `P04 MCP server not allowlisted: ${counted(violations.length + omitted, "MCP server", "MCP servers")} at ${locsOf(violations, omitted)} not on the org policy's allowlist, or enableAllProjectMcpServers set while the policy has one.`,
  P05: (violations, omitted) => {
    const n = violations.length + omitted;
    return `P05 forbidden MCP server: ${counted(n, "MCP server", "MCP servers")} at ${locsOf(violations, omitted)} ${n === 1 ? "matches" : "match"} an entry the org policy forbids, by name, command or URL.`;
  },
  P06: (violations, omitted) =>
    `P06 required hook missing: ${counted(violations.length + omitted, "required hook", "required hooks")} missing at ${locsOf(violations, omitted)}, or disableAllHooks set while the policy requires hooks. Only a command hook with no if condition, whose matcher covers the required one, counts.`,
  P07: (violations, omitted) => {
    const parts: string[] = [];
    const contradictions = violations.filter(
      (violation) =>
        violation.detail.startsWith(P07_PACKAGE_MANAGER_PREFIX) || violation.detail.startsWith(P07_TEST_RUNNER_PREFIX),
    );
    const paths = pathsOf(contradictions);
    if (paths.length > 0) {
      const head =
        paths.length === 1 ? "1 agent instruction file names" : `${paths.length} agent instruction files name`;
      const notListed =
        omitted > 0
          ? ` ${omitted === 1 ? "1 of the violations is" : `${omitted} of the violations are`} not listed in the report.`
          : "";
      parts.push(
        `${head} a different package manager or test runner than another file in the same directory: ${listOf(paths, paths.length)}.${notListed} Each file's line is in the report's policy violations.`,
      );
    }
    // The drop and missing details start with the number of files; every other detail starts with a letter.
    let notCompared = 0;
    for (const violation of violations) {
      const count = Number.parseInt(violation.detail, 10);
      if (violation.path === null && Number.isInteger(count)) notCompared += count;
    }
    if (notCompared > 0) {
      parts.push(
        `${notCompared} agent instruction ${notCompared === 1 ? "file was" : "files were"} not compared: binary, too large, past the read caps, an unsafe path or not a file at HEAD.`,
      );
    }
    if (violations.some((violation) => violation.detail === P07_UNREAD_DETAIL)) {
      parts.push("The agent instruction files were not read, so they were not compared.");
    }
    return parts.join(" ");
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
  P09: (violations, omitted) => {
    const paths = pathsOf(violations).sort(byCodeUnit);
    const total = paths.length + omitted;
    const head =
      total === 1
        ? "This change edits 1 file that the org policy guards"
        : `This change edits ${total} files that the org policy guards`;
    return `${head}: ${listOf(paths, total)}. The reason for each is in the report's policy violations.`;
  },
  P14: (violations, _omitted, evaluation) => {
    const sentences: string[] = [];
    // The size details are P14's own fixed template: `agent PR changes N files|lines (cap M); split it by area: …`.
    const counts: Partial<Record<string, string>> = {};
    let areas = "";
    for (const violation of violations) {
      const match = P14_SIZE_DETAIL.exec(violation.detail);
      if (match === null) continue;
      counts[match[2] as string] = `${match[1]} ${match[2]} (cap ${match[3]})`;
      areas = match[4] as string;
    }
    // Files before lines, whatever order the violations sorted in.
    const sizes = [counts.files, counts.lines].filter((size): size is string => size !== undefined);
    if (sizes.length > 0) {
      sentences.push(
        `This agent pull request changes ${sizes.join(" and ")}, more than the org policy allows; split it by area: ${areas}. Lockfiles, snapshots and *.generated.* files are not counted, nor are coverage.exclude paths unless the pull request edits the config or a workflow.`,
      );
    }
    if (violations.some((violation) => violation.detail === P14_DIFF_UNAVAILABLE_DETAIL)) {
      sentences.push(
        "This agent pull request could not be checked against the org policy's size caps, because the diff is unavailable.",
      );
    }
    if (violations.some((violation) => violation.detail === P14_BASE_UNREADABLE_DETAIL)) {
      sentences.push(
        "This agent pull request edits the policy file, and its version at the merge base could not be read, so the size caps that version sets could not be checked.",
      );
    }
    const words = (evaluation.agentPr?.evidence ?? []).map((kind) => EVIDENCE_WORDS[kind]);
    const incomplete = evaluation.agentPr?.incomplete ?? null;
    if (incomplete !== null) words.push(`evidence it could not read (${codeSpan(incomplete)})`);
    sentences.push(`It counts as an agent PR by: ${words.join("; ")}.`);
    return sentences.join(" ");
  },
};

/** The POLICY_SETTINGS_INVALID message: the files were not read, or the problems that stopped a rule fully using one. */
function settingsInvalidMessage(settings: NonNullable<PolicyEvaluation["settings"]>): Message | null {
  if (settings.unavailable !== null) {
    return {
      level: settings.unavailable.level,
      code: "POLICY_SETTINGS_INVALID",
      // The reason can carry git text: control, invisible and bidirectional characters become spaces (see text.ts).
      text: `The agent settings files were not read (${replaceUnsafeChars(settings.unavailable.reason, " ")}), so P02–P06 did not run.`,
    };
  }
  if (settings.problems.length === 0) return null;
  const items = settings.problems.map((problem) =>
    problem.path === null
      ? `the rule comparison (\`${problem.reason}\`)`
      : `${codeSpan(problem.path)}${problem.line === null ? "" : ` line ${problem.line}`} (\`${problem.reason}\`)`,
  );
  const named = items.slice(0, MAX_LISTED).join(", ");
  const listed = items.length > MAX_LISTED ? `${named} and ${items.length - MAX_LISTED} more` : named;
  return {
    level: settings.problems.some((problem) => problem.level === "error") ? "error" : "warn",
    code: "POLICY_SETTINGS_INVALID",
    text: `P02–P06 could not fully use these agent settings files: ${listed}. Claude Code skips an unparseable file or entry; pharn-ci never guesses what it meant, and a file it could not read counts against the policy.`,
  };
}

/**
 * One message per rule id that has violations and a row in the table, in id order, then the POLICY_SETTINGS_INVALID
 * message when the settings reader has something to say. The level is the strongest severity of that id's violations:
 * block is an error, warn a warning, info info.
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
  if (evaluation.settings !== undefined) {
    const invalid = settingsInvalidMessage(evaluation.settings);
    if (invalid !== null) messages.push(invalid);
  }
  return messages;
}
