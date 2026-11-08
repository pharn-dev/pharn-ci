import type { DiffFile } from "../../diff/unified.js";
import { compileGlob } from "../../glob.js";
import { byCodeUnit, replaceUnsafeChars } from "../../text.js";
import { resolveSeverity } from "./severity.js";
import type { PolicyRuleInput, RuleFinding } from "./types.js";

/**
 * The generated files rule P14 never counts, as globs in the syntax of `coverage.exclude` matched against a diff path:
 * the lockfiles of the common package managers by name in any directory, snapshot files (anything under a
 * `__snapshots__` directory, and any `.snap` file) and files named `*.generated.*`. A file outside this list counts
 * unless the run's `coverage.exclude` patterns match it.
 */
export const P14_GENERATED_FILES: readonly string[] = Object.freeze([
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lock",
  "**/bun.lockb",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/uv.lock",
  "**/Pipfile.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/go.sum",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/*.generated.*",
]);

/** The most top-level directories a P14 detail names; the rest are counted. */
export const P14_MAX_AREAS = 10;

/** The start of the detail of a violation for an exceeded cap. */
export const P14_SIZE_PREFIX = "agent PR changes ";
/** The detail of the one violation a missing diff gives. */
export const P14_DIFF_UNAVAILABLE_DETAIL = "diff unavailable; the size of the agent PR could not be checked";
/** The detail of the violation for an edited policy file whose merge-base version could not be read. */
export const P14_BASE_UNREADABLE_DETAIL =
  "policy file edited and unreadable at the merge base; the size caps could not be checked";

const WORKFLOWS_DIR = ".github/workflows/";

/** What P14 counts of a diff. */
export interface AgentPrSize {
  /** The diff entries counted; a rename is one entry. */
  files: number;
  /** The added plus removed lines of the counted entries; a binary file has none. */
  lines: number;
  /** The distinct top-level directories of the counted entries (`.` for a root-level file), in code-unit order. */
  areas: string[];
}

/** The top-level directory of a path, or `.` for a file at the root. */
const areaOf = (path: string): string => {
  const slash = path.indexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
};

/**
 * The size of a diff as P14 counts it. An entry is left out when every path it has (its path, and its old path for a
 * rename) is a generated file (`P14_GENERATED_FILES`) or matches `excluded`; so renaming a file to a generated name
 * does not hide it. Pure; linear in the size of the diff.
 */
export function agentPrSize(diff: readonly DiffFile[], excluded: (path: string) => boolean): AgentPrSize {
  const generated = P14_GENERATED_FILES.map((glob) => compileGlob(glob));
  const skipped = (path: string) => generated.some((matches) => matches(path)) || excluded(path);
  let files = 0;
  let lines = 0;
  const areas = new Set<string>();
  for (const entry of diff) {
    if (skipped(entry.path) && (entry.oldPath === entry.path || skipped(entry.oldPath))) continue;
    files++;
    lines += entry.addedLines.length + (entry.removedCount ?? 0);
    areas.add(areaOf(entry.path));
    if (entry.oldPath !== entry.path) areas.add(areaOf(entry.oldPath));
  }
  return { files, lines, areas: [...areas].sort(byCodeUnit) };
}

/**
 * The areas as a detail names them: the first 10, each control, invisible or bidirectional character replaced by
 * U+FFFD, joined with `, `, then ` and N more`.
 */
function areaList(areas: readonly string[]): string {
  const named = areas
    .slice(0, P14_MAX_AREAS)
    .map((area) => replaceUnsafeChars(area, "�"))
    .join(", ");
  return areas.length > P14_MAX_AREAS ? `${named} and ${areas.length - P14_MAX_AREAS} more` : named;
}

/**
 * P14, agent PR size cap. Runs only for an agent PR (a person's pull request is never subject to it) under an app or
 * file policy whose P14 severity is not off and whose effective `agents.max_files` or `agents.max_changed_lines` is set
 * (`agentPolicy`; there is no default cap). One path-less finding per exceeded cap: a count equal to the cap passes.
 * The detail names the count, the cap and the top-level directories of the counted files, never file text. Generated
 * files do not count, nor do paths the run's `coverage.exclude` matches, except when the pull request edits the config
 * in use or a workflow (the inputs of its own grade) and the exclusions are not an app policy's: then a pull request
 * could exclude its own files, so every file counts. A missing diff is one path-less finding (fail closed), and so is an
 * edited policy file that could not be read at the merge base. Each finding's `fallback` is block; `evaluate.ts`
 * applies `policy.rules.P14`.
 */
export function detectP14(input: PolicyRuleInput): RuleFinding[] {
  const { policy, agentPolicy, agentPr } = input;
  const document = policy.document;
  if ((policy.source !== "app" && policy.source !== "file") || document === null || document === undefined) return [];
  if (agentPolicy === undefined) return [];
  const { maxFiles, maxChangedLines } = agentPolicy;
  if (maxFiles === null && maxChangedLines === null) return [];
  if (agentPr?.isAgentPr !== true) return [];
  if (resolveSeverity(policy, "P14", "block").severity === null) return [];
  const finding = (detail: string): RuleFinding => ({ id: "P14", fallback: "block", path: null, line: null, detail });
  if (input.diff === null) return [finding(P14_DIFF_UNAVAILABLE_DETAIL)];

  const gradeInputEdited = (path: string) =>
    (input.configPath !== null && path === input.configPath) || path.startsWith(WORKFLOWS_DIR);
  const editsGradeInputs = input.diff.some((entry) => gradeInputEdited(entry.path) || gradeInputEdited(entry.oldPath));
  const appExclusions = policy.source === "app" && document.coverage?.exclude !== undefined;
  const patterns = editsGradeInputs && !appExclusions ? [] : (input.coverageExclude ?? []);
  const matchers = patterns.map((pattern) => compileGlob(pattern));
  const size = agentPrSize(input.diff, (path) => matchers.some((matches) => matches(path)));

  const findings: RuleFinding[] = [];
  const areas = areaList(size.areas);
  if (maxFiles !== null && size.files > maxFiles) {
    findings.push(finding(`${P14_SIZE_PREFIX}${size.files} files (cap ${maxFiles}); split it by area: ${areas}`));
  }
  if (maxChangedLines !== null && size.lines > maxChangedLines) {
    findings.push(
      finding(`${P14_SIZE_PREFIX}${size.lines} lines (cap ${maxChangedLines}); split it by area: ${areas}`),
    );
  }
  if (agentPolicy.listsIncomplete && agentPolicy.policyFileEdited === true) {
    findings.push(finding(P14_BASE_UNREADABLE_DETAIL));
  }
  return findings;
}
