import { instructionDeclarations, instructionScope, isInstructionFile } from "../../setup/instructions.js";
import type { AgentSetupFile } from "../../setup/scan.js";
import { classifySetupPath } from "../../setup/scan.js";
import type { IgnoredSetting, ResolvedPolicy } from "../resolved.js";
import { resolveKeyedSeverity } from "./severity.js";
import type { PolicyRuleInput, PolicyViolationSeverity, RuleFinding } from "./types.js";

/** The detail of the one violation for instruction files that could not be read. Fixed. */
export const P07_UNREAD_DETAIL = "agent instruction files were not read; P07 did not compare them";
/** The prefixes of a contradiction detail, one for each class of tool. */
export const P07_PACKAGE_MANAGER_PREFIX = "package manager: ";
export const P07_TEST_RUNNER_PREFIX = "test runner: ";

const noun = (n: number) => (n === 1 ? "file was" : "files were");

/** The detail for files dropped for a reason a pull request can cause (binary, too large, past a cap, unsafe path). */
export function p07DroppedDetail(n: number): string {
  return `${n} agent instruction ${noun(n)} not compared (binary, too large, past the read caps or an unsafe path)`;
}

/** The detail for files that are not a file at HEAD. */
export function p07MissingDetail(n: number): string {
  return `${n} agent instruction ${noun(n)} not compared (not a file at HEAD)`;
}

/**
 * The severity of P07 under a policy: `null` when there is no app or file policy document, or the app switched it off;
 * otherwise `setup.consistency` and `policy.rules.P07` resolved like the other keyed rules, with `warn` as the default.
 * A policy file never gets below `warn`; what it asked for below that is returned in `ignored` and `lowered`.
 */
export function consistencySeverity(policy: ResolvedPolicy): {
  severity: PolicyViolationSeverity | null;
  ignored: IgnoredSetting[];
  lowered: boolean;
} {
  if (
    (policy.source !== "app" && policy.source !== "file") ||
    policy.document === null ||
    policy.document === undefined
  ) {
    return { severity: null, ignored: [], lowered: false };
  }
  return resolveKeyedSeverity(policy, "P07", {
    featureValue: policy.document.setup?.consistency,
    featureSetting: "setup.consistency",
    fallback: "warn",
  });
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** One compared file: its path and what it declares in one class of tool. */
interface Declaring {
  path: string;
  tools: readonly string[];
  line: number;
}

const overlaps = (a: readonly string[], b: readonly string[]) => a.some((tool) => b.includes(tool));

/** One finding per file of the class that is disjoint from at least one other file of the scope. */
function classFindings(files: readonly Declaring[], prefix: string, severity: PolicyViolationSeverity): RuleFinding[] {
  const sorted = [...files].sort((a, b) => byCodeUnit(a.path, b.path));
  const findings: RuleFinding[] = [];
  for (const file of sorted) {
    const others = sorted.filter((other) => other !== file && !overlaps(file.tools, other.tools));
    const first = others[0];
    if (first === undefined) continue;
    const more = others.length - 1;
    const tail = more === 0 ? "" : more === 1 ? " and 1 other file" : ` and ${more} other files`;
    findings.push({
      id: "P07",
      fallback: severity,
      path: file.path,
      line: file.line,
      detail: `${prefix}${file.tools.join("/")} here, ${first.tools.join("/")} in ${first.path}:${first.line}${tail}`,
    });
  }
  return findings;
}

/**
 * P07, agent instruction files in one directory name different package managers or JavaScript test runners. Runs only
 * when the caller gave the text of the instruction files and the policy has P07 in effect. Unreadable files are one
 * path-less info finding; files dropped for a reason the pull request can cause take P07's severity, and files that are
 * not a file at HEAD are info. Pattern-scoped files are left out. The details hold only fixed words, the tool words,
 * paths and numbers, never text of a file.
 */
export function detectP07(input: PolicyRuleInput, severity: PolicyViolationSeverity | null): RuleFinding[] {
  const sources = input.agentInstructions;
  if (severity === null || sources === null || sources === undefined) return [];
  if ("unavailable" in sources)
    return [{ id: "P07", fallback: "info", path: null, line: null, detail: P07_UNREAD_DETAIL }];
  const findings: RuleFinding[] = [];
  const missing = sources.dropped.filter((drop) => drop.reason === "missing").length;
  const dropped = sources.dropped.length - missing;
  if (dropped > 0)
    findings.push({ id: "P07", fallback: severity, path: null, line: null, detail: p07DroppedDetail(dropped) });
  if (missing > 0)
    findings.push({ id: "P07", fallback: "info", path: null, line: null, detail: p07MissingDetail(missing) });

  const scopes = new Map<string, { managers: Declaring[]; runners: Declaring[] }>();
  const seen = new Set<string>();
  for (const file of sources.files) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const kind = classifySetupPath(file.path);
    if (kind === null) continue;
    const setupFile: AgentSetupFile = { path: file.path, kind };
    if (!isInstructionFile(setupFile)) continue;
    const declared = instructionDeclarations(file.text);
    if (declared.patternScoped) continue;
    const scope = instructionScope(setupFile);
    let group = scopes.get(scope);
    if (group === undefined) {
      group = { managers: [], runners: [] };
      scopes.set(scope, group);
    }
    const { packageManagers, testRunners } = declared;
    if (packageManagers.line !== null) {
      group.managers.push({ path: file.path, tools: packageManagers.tools, line: packageManagers.line });
    }
    if (testRunners.line !== null) {
      group.runners.push({ path: file.path, tools: testRunners.tools, line: testRunners.line });
    }
  }
  for (const group of scopes.values()) {
    findings.push(...classFindings(group.managers, P07_PACKAGE_MANAGER_PREFIX, severity));
    findings.push(...classFindings(group.runners, P07_TEST_RUNNER_PREFIX, severity));
  }
  return findings;
}
