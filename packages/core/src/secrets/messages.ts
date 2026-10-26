import { codeSpan, type Message, type MessageCode, oneLine } from "../report.js";
import { type AgentConfigSecretFinding, type AgentConfigSources, scanAgentConfigSecrets } from "./scan.js";

/** The most locations one message names; the rest are counted. */
const MAX_LOCATIONS = 5;
/** The most unscanned files one message names; the rest are counted. */
const MAX_UNSCANNED_FILES = 20;

const SHAPES: Readonly<Record<string, string>> = {
  S01: "a GitHub token",
  S02: "an Anthropic API key",
  S03: "an OpenAI API key",
  S04: "a Google API key",
  S05: "an AWS access key ID",
  S06: "a Slack token",
  S07: "a Stripe live key",
  S08: "a private key",
  S09: "a password or token in a URL",
  S10: "a secret-like value under a secret-named key",
  S11: "a literal value under a secret-named key in a file that loads its other secrets from the environment",
};

const CODES: Readonly<Record<string, MessageCode>> = {
  S01: "AGENT_CONFIG_SECRET_S01",
  S02: "AGENT_CONFIG_SECRET_S02",
  S03: "AGENT_CONFIG_SECRET_S03",
  S04: "AGENT_CONFIG_SECRET_S04",
  S05: "AGENT_CONFIG_SECRET_S05",
  S06: "AGENT_CONFIG_SECRET_S06",
  S07: "AGENT_CONFIG_SECRET_S07",
  S08: "AGENT_CONFIG_SECRET_S08",
  S09: "AGENT_CONFIG_SECRET_S09",
  S10: "AGENT_CONFIG_SECRET_S10",
  S11: "AGENT_CONFIG_SECRET_S11",
};

/** The drop reasons that fail closed: a file that big, that many, or at such a path may hide a secret. */
const FAIL_CLOSED_REASONS: ReadonlySet<string> = new Set([
  "too-large",
  "over-file-cap",
  "over-total-cap",
  "unsafe-path",
]);

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function levelOf(id: string): Message["level"] {
  return id === "S10" ? "warn" : id === "S11" ? "info" : "error";
}

/** The first locations as `` `path` line N `` joined with `, `, then ` and M more` when there are more. */
function locations(findings: readonly AgentConfigSecretFinding[]): string {
  const named = findings
    .slice(0, MAX_LOCATIONS)
    .map((finding) => `${codeSpan(finding.path)} line ${finding.line}`)
    .join(", ");
  const more = findings.length - MAX_LOCATIONS;
  return more > 0 ? `${named} and ${more} more` : named;
}

/** The unscanned files as `` `path` (`reason`) `` joined with `, `, then ` and M more` when there are more. */
function unscannedFiles(files: readonly { path: string; reason: string }[]): string {
  const named = files
    .slice(0, MAX_UNSCANNED_FILES)
    .map((file) => `${codeSpan(file.path)} (${codeSpan(file.reason)})`)
    .join(", ");
  const more = files.length - MAX_UNSCANNED_FILES;
  return more > 0 ? `${named} and ${more} more` : named;
}

/**
 * The messages of check A7 for the agent config sources. One message per shape found, in id order, each naming the
 * shape, its id and up to 5 locations (path and line), never a value, a key or any file text; and one
 * `AGENT_CONFIG_SECRET_UNSCANNED` message when the sources are unavailable, or when a selected file was dropped or never
 * read (an error when a drop could hide a secret, a warning otherwise). `selected` is the paths that should have been
 * read, from `agentConfigSecretPaths`.
 */
export function agentConfigSecretMessages(sources: AgentConfigSources, selected: readonly string[]): Message[] {
  if ("unavailable" in sources) {
    return [
      {
        level: "warn",
        code: "AGENT_CONFIG_SECRET_UNSCANNED",
        text: `Agent config files were not scanned for committed secrets: ${codeSpan(oneLine(sources.unavailable))}.`,
      },
    ];
  }
  const messages: Message[] = [];
  const findings = scanAgentConfigSecrets(sources.files);
  const ids = [...new Set(findings.map((finding) => finding.id))].sort(byCodeUnit);
  for (const id of ids) {
    const ofId = findings.filter((finding) => finding.id === id);
    messages.push({
      level: levelOf(id),
      code: CODES[id] as MessageCode,
      text: `Agent config files hold ${SHAPES[id]} (${id}): ${locations(ofId)}.`,
    });
  }
  const read = new Set(sources.files.map((file) => file.path));
  const dropped = new Set(sources.dropped.map((drop) => drop.path));
  const unscanned: { path: string; reason: string }[] = [...sources.dropped];
  for (const path of selected) {
    if (!read.has(path) && !dropped.has(path)) unscanned.push({ path, reason: "not-read" });
  }
  if (unscanned.length > 0) {
    unscanned.sort((a, b) => byCodeUnit(a.path, b.path));
    messages.push({
      level: unscanned.some((file) => FAIL_CLOSED_REASONS.has(file.reason)) ? "error" : "warn",
      code: "AGENT_CONFIG_SECRET_UNSCANNED",
      text: `Some agent config files were not scanned for committed secrets: ${unscannedFiles(unscanned)}.`,
    });
  }
  return messages;
}
