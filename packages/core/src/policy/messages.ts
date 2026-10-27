import type { AgentPrIncomplete } from "../agents.js";
import { formatNumber, type Message } from "../report.js";
import type { IgnoredSetting, ResolvedPolicy } from "./resolved.js";

/** The most settings POLICY_OVERRIDE_IGNORED names; the rest are counted. */
const MAX_NAMED_SETTINGS = 20;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The POLICY_UNAVAILABLE message: why no org policy was used. A warning, or an error when the workflow demanded a
 * policy (`policy: required`). Names the reason, the HTTP status when there is one and the request id when the app
 * sent a sane one; says the check ran with the workflow inputs and `.pharn/ci.yml`. Everything in it is a fixed word
 * or a number: nothing the app answered is quoted.
 */
export function policyUnavailableMessage(unavailable: NonNullable<ResolvedPolicy["unavailable"]>): Message {
  const status = unavailable.status === undefined ? "" : `, status ${String(unavailable.status)}`;
  const requestId = unavailable.requestId === undefined ? "" : `, request id ${unavailable.requestId}`;
  const head = `The org policy could not be used (${unavailable.reason}${status}${requestId}).`;
  const text = unavailable.required
    ? `${head} The workflow requires a policy (policy: required), so this check fails. It ran with the workflow inputs and .pharn/ci.yml.`
    : `${head} The check ran with the workflow inputs and .pharn/ci.yml.`;
  return { level: unavailable.required ? "error" : "warn", code: "POLICY_UNAVAILABLE", text };
}

/**
 * The AGENT_PR_DETECTION_INCOMPLETE message: the pull request counts as an agent PR because the detection could not
 * read all of its evidence, so the org policy's protected paths apply to it. A warning that names the reason as one
 * fixed word and nothing else.
 */
export function agentPrIncompleteMessage(reason: AgentPrIncomplete): Message {
  return {
    level: "warn",
    code: "AGENT_PR_DETECTION_INCOMPLETE",
    text: `This pull request counts as an agent PR because pharn-ci could not read all of its evidence (\`${reason}\`), so the org policy's protected paths apply to it.`,
  };
}

/**
 * The POLICY_OVERRIDE_IGNORED message: the settings of a layer that the policy's value beat, or that a policy file may
 * not set. One warning for the whole list, sorted by setting then layer in code-unit order, each setting and layer once,
 * at most 20 named and the rest counted. A threshold names both numbers; no pattern, root or label is ever named.
 */
export function policyOverrideIgnoredMessage(ignored: readonly IgnoredSetting[]): Message {
  const seen = new Set<string>();
  const unique = ignored.filter((record) => {
    const key = `${record.setting}\u0000${record.layer}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => byCodeUnit(a.setting, b.setting) || byCodeUnit(a.layer, b.layer));
  const named = unique.slice(0, MAX_NAMED_SETTINGS).map((record) => {
    const numbers =
      record.given !== undefined && record.applied !== undefined
        ? ` ${formatNumber(record.given)} → ${formatNumber(record.applied)}`
        : "";
    return `${record.setting} (${record.layer})${numbers}`;
  });
  const more = unique.length - MAX_NAMED_SETTINGS;
  const list = more > 0 ? `${named.join(", ")}, and ${String(more)} more` : named.join(", ");
  return {
    level: "warn",
    code: "POLICY_OVERRIDE_IGNORED",
    text: `Some settings were looser than the org policy, or are not allowed from a policy file, so the policy's value applies: ${list}.`,
  };
}
