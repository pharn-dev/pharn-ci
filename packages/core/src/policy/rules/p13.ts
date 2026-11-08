import type { TestSourceSide } from "../../testSources.js";
import { codeownersWidenings } from "../selfmod/codeowners.js";
import { mcpWidenings, parseSide, settingsWidenings } from "../selfmod/jsonFiles.js";
import { type SelfModificationClass, selfModificationClass } from "../selfmod/paths.js";
import { workflowWidenings } from "../selfmod/workflows.js";
import { isJsoncMcpPath } from "../settings/paths.js";
import { resolveSeverity } from "./severity.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

/** The detail of the one violation a missing diff gives. */
export const P13_DIFF_UNAVAILABLE_DETAIL =
  "diff unavailable; agent settings, MCP configs, workflows and CODEOWNERS could not be checked";
/** The detail of a violation for a file whose merge-base or head text could not be read or parsed. */
export const P13_UNCOMPARED_DETAIL =
  "agent PR changes this file and it could not be read or parsed at the merge base and at HEAD, so it could not be compared";

/** The fixed start of each class's detail; the widening words follow. */
const PREFIX: Record<SelfModificationClass, string> = {
  settings: "agent PR widens its agent settings: ",
  mcp: "agent PR widens its MCP servers: ",
  workflow: "agent PR widens a workflow: ",
  codeowners: "agent PR loosens CODEOWNERS: ",
};

/** The text of a path on one side: a string, null when the file is absent there, undefined when it was not read. */
function textOn(side: TestSourceSide | null, path: string): string | null | undefined {
  if (side === null) return null;
  if ("unavailable" in side) return undefined;
  const file = side.files.find((entry) => entry.path === path);
  return file === undefined ? undefined : file.text;
}

/** The widening words of one file, or null when it could not be compared. */
function wideningsOf(cls: SelfModificationClass, path: string, base: string | null, head: string | null) {
  if (cls === "workflow") return workflowWidenings(base, head);
  if (cls === "codeowners") return codeownersWidenings(base, head);
  const jsonc = cls === "mcp" && isJsoncMcpPath(path);
  const b = parseSide(base, jsonc);
  const h = parseSide(head, jsonc);
  if (b === undefined || h === undefined) return null;
  return cls === "settings" ? settingsWidenings(b, h) : mcpWidenings(path, b, h);
}

/**
 * P13, agent self-modification. Runs only for an agent PR (a person's pull request is never subject to it), under an
 * app or file policy whose P13 severity is not off, and only when the caller gave the merge-base and head text of the
 * files it compares (`selfModification`). Each agent settings file, MCP config, workflow and CODEOWNERS file the diff
 * adds, modifies, renames or deletes is compared between the merge base and HEAD (an added file against nothing, a
 * deleted one against nothing; a rename is the old path deleted and the new path added). One finding per file that
 * widens what an agent may do, whose detail names the kinds of widening in fixed words; one finding with a fixed detail
 * per file that could not be read or parsed on a side it exists on; one path-less finding for a missing diff (fail
 * closed). The default severity is block. Nothing here repeats a rule, server, secret, owner or command.
 */
export function detectP13(input: PolicyRuleInput): RuleFinding[] {
  const { policy, agentPr, selfModification } = input;
  if ((policy.source !== "app" && policy.source !== "file") || policy.document === null) return [];
  if (agentPr?.isAgentPr !== true) return [];
  if (selfModification === undefined) return [];
  if (resolveSeverity(policy, "P13", "block").severity === null) return [];
  if (input.diff === null) {
    return [{ id: "P13", fallback: "block", path: null, line: null, detail: P13_DIFF_UNAVAILABLE_DETAIL }];
  }
  const compared = new Map<string, RuleFinding>();
  const compare = (
    path: string,
    cls: SelfModificationClass,
    base: TestSourceSide | null,
    head: TestSourceSide | null,
  ) => {
    if (compared.has(path)) return;
    const before = textOn(base, path);
    const after = textOn(head, path);
    const words = before === undefined || after === undefined ? null : wideningsOf(cls, path, before, after);
    if (words !== null && words.length === 0) return;
    const detail = words === null ? P13_UNCOMPARED_DETAIL : `${PREFIX[cls]}${words.join(", ")}`;
    compared.set(path, { id: "P13", fallback: "block", path, line: null, detail });
  };
  for (const entry of input.diff) {
    const oldClass = selfModificationClass(entry.oldPath);
    const newClass = selfModificationClass(entry.path);
    if (entry.status === "added" && newClass !== null) compare(entry.path, newClass, null, selfModification.head);
    else if (entry.status === "modified" && newClass !== null) {
      compare(entry.path, newClass, selfModification.base, selfModification.head);
    } else if (entry.status === "deleted" && oldClass !== null) {
      compare(entry.oldPath, oldClass, selfModification.base, null);
    } else if (entry.status === "renamed") {
      if (oldClass !== null) compare(entry.oldPath, oldClass, selfModification.base, null);
      if (newClass !== null) compare(entry.path, newClass, null, selfModification.head);
    }
  }
  return [...compared.values()];
}
