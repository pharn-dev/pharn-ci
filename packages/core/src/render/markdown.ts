import type { CoverageFormat } from "../coverage/types.js";
import { formatNumber, type Message, type MessageCode, type Report } from "../report.js";
import { summarizeAgentSetup } from "../setup/summary.js";
import { logoMarkup } from "./logo.js";

export interface RenderMarkdownOptions {
  /** Maximum file rows per table; the rest are summarized. Keeps PR comments under GitHub's size limit. */
  maxRows?: number;
}

const VERDICT_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
const VERDICT_LABEL = { pass: "Pass", warn: "Warn", fail: "Fail" } as const;
/** The GitHub alert marker line that opens the verdict callout; fixed strings, keyed by verdict. */
const VERDICT_ALERT = { pass: "> [!TIP]", warn: "> [!WARNING]", fail: "> [!CAUTION]" } as const;
const BRAND = "🛡️";
/** Fixed words for the footer; a format outside the enum (another producer's) renders nothing. */
const COVERAGE_FORMAT_LABEL: Record<CoverageFormat, string> = { lcov: "lcov", cobertura: "cobertura" };
/** Ranges shown in one file's uncovered-lines cell; keeps a single file from making a huge table cell. */
const MAX_UNCOVERED_RANGES = 20;
const LEVEL_ICON = { info: "ℹ️", warn: "⚠️", error: "❌" } as const;
/** Where the full file list lives when the diff coverage table is cut short. */
const FULL_REPORT_NOTE =
  "_Full list in report.json: the Action's `report-path` output, or `pharn-ci check --format json`._";

/**
 * One-line remediation per message code, added at render time so message text (which consumers may
 * match on) stays as it is. Fixed strings only: nothing input-derived.
 */
const MESSAGE_HINTS: Record<MessageCode, string> = {
  DIFF_COVERAGE_BELOW_THRESHOLD: "Add tests that exercise the uncovered lines listed in the table above.",
  DIFF_COVERAGE_UNGATED:
    "To gate diff coverage, set a threshold above 0 (`coverage.threshold`, `threshold` or `--threshold`).",
  NO_COVERABLE_CHANGES:
    "Nothing to do if the change has no code; otherwise check that the coverage report includes the changed files.",
  COVERAGE_FILE_MISSING:
    "Run the tests with coverage before pharn-ci, and check the path (`coverage.file`, `coverage-file` or `--coverage`).",
  COVERAGE_FILE_EMPTY:
    "Run the tests with coverage enabled before pharn-ci, and check that the report covers this repo's sources.",
  COVERAGE_FORMAT_UNSUPPORTED:
    "Have the test runner write lcov or Cobertura XML; if it already does, set `coverage.format` explicitly.",
  DIFF_UNAVAILABLE:
    "Check out full history (`actions/checkout` with `fetch-depth: 0`) or set the base (`base-ref` or `--base`).",
  COVERAGE_PATHS_UNMATCHED:
    "Write coverage paths relative to the repository root, or set the directory they start from (`coverage.root`, `coverage-root` or `--coverage-root`).",
  COVERAGE_PATHS_PARTIALLY_UNMATCHED:
    "Nothing to do if those files are generated or outside the repo; if changed files are missing from the table, check the coverage root.",
  CONFIG_CHANGED_IN_DIFF:
    "Review the config and workflow changes before trusting the verdict; protect `.pharn/ci.yml` and `.github/workflows/` with CODEOWNERS.",
  COVERAGE_FILE_TRACKED:
    "Generate the coverage file in CI and stop tracking it (`git rm --cached` it and add it to `.gitignore`).",
  DIFF_BINARY_COVERED_FILE:
    "Remove `-diff` or `binary` attributes for source files from `.gitattributes` so their changes are measured.",
  TEST_FILES_DELETED:
    "Check that the deleted or renamed tests were meant to go, or that their cases moved to a file the test runner still runs.",
  NO_AGENT_SETUP_FILES: "Add an AGENTS.md or CLAUDE.md at the repository root that tells agents how to build and test.",
  AGENT_SETUP_FILE_EMPTY: "Fill in the empty file or delete it; an agent reads nothing from an empty file.",
  AGENT_SETUP_EXPECTED_MISSING:
    "Add a setup file for each missing tool (for example AGENTS.md, CLAUDE.md or .cursor/rules/), or remove it from `setup.expect`.",
};

/** Render a Report as GitHub-flavored markdown (PR comment, job summary, CLI). */
export function renderMarkdown(report: Report, options: RenderMarkdownOptions = {}): string {
  const maxRows = options.maxRows ?? 50;
  const out: string[] = [];

  const logo = logoMarkup();
  if (logo !== "") out.push(logo, "");
  out.push(`## ${BRAND} pharn-ci · ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]}`, "");
  out.push(VERDICT_ALERT[report.verdict], `> **${VERDICT_LABEL[report.verdict]}** · ${overviewLine(report)}`, "");
  out.push(...summaryLines(report));

  out.push("### 🧪 Diff coverage", "");
  const dc = report.diffCoverage;
  if (dc === null) {
    out.push("_Not computed — see messages below._", "");
  } else if (dc.percent === null) {
    out.push("_No coverable lines changed._", "");
  } else {
    const threshold = dc.threshold === null ? "no threshold" : `threshold ${formatNumber(dc.threshold)}%`;
    out.push(
      `**${formatNumber(dc.percent)}%** of changed lines covered (${dc.coveredLines}/${dc.coverableLines}, ${threshold})`,
      "",
    );
    // Open exactly when the table is what the below-threshold message points at.
    const open = report.messages.some((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD");
    out.push(open ? "<details open>" : "<details>", `<summary>Changed files (${dc.files.length})</summary>`, "");
    out.push("| File | Coverage | Covered | Uncovered lines |", "| --- | ---: | ---: | --- |");
    // Worst first, so the files that need tests survive truncation; files with nothing to measure go last.
    for (const f of byCoverage(dc.files).slice(0, maxRows)) {
      const pct = f.percent === null ? "—" : `${formatNumber(f.percent)}%`;
      const uncovered = f.uncoveredLines.length === 0 ? "" : uncoveredCell(f.uncoveredLines);
      out.push(`| ${code(f.path)} | ${pct} | ${f.coveredLines}/${f.coverableLines} | ${uncovered} |`);
    }
    if (dc.files.length > maxRows) out.push(`| _…and ${dc.files.length - maxRows} more files_ | | | |`);
    out.push("", "</details>", "");
    if (dc.files.length > maxRows) out.push(FULL_REPORT_NOTE, "");
  }
  const excluded = dc?.excludedFiles ?? [];
  if (excluded.length > 0) {
    out.push(
      `<details><summary>Excluded: ${excluded.length} ${excluded.length === 1 ? "file" : "files"}</summary>`,
      "",
    );
    for (const path of excluded.slice(0, maxRows)) out.push(`- ${code(path)}`);
    // report.json keeps the full list; the cap keeps the verdict inside GitHub's comment size limit.
    if (excluded.length > maxRows) out.push(`- _…and ${excluded.length - maxRows} more files_`);
    out.push("", "</details>", "");
  }

  // Before the agent setup inventory: when the Action has to drop rows to fit a size limit, the
  // reason for the verdict is never what goes.
  if (report.messages.length > 0) {
    out.push(`### 💬 Messages (${report.messages.length})`, "");
    for (const m of report.messages) out.push(renderMessage(m));
    out.push("");
  }

  const setup = report.agentSetup.files;
  out.push(`### 🤖 Agent setup (${setup.length === 0 ? "no files" : countFiles(setup.length)})`, "");
  const missingTools = report.agentSetup.missing ?? [];
  const missingLine = `Missing: ${missingTools.map(code).join(", ")}`;
  if (setup.length === 0) {
    out.push(
      "_No agent setup files found._",
      "",
      missingTools.length > 0
        ? missingLine
        : "Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.",
      "",
    );
  } else {
    // Count, fixed words and names from the fixed tool list only: nothing input-derived. buildReport
    // already summarized the files; a report without a summary (an older producer's) is summarized here.
    const { tools } = report.agentSetup.summary ?? summarizeAgentSetup(setup);
    out.push(`Agent setup: ${setup.length} ${setup.length === 1 ? "file" : "files"} · ${tools.join(", ")}`, "");
    if (missingTools.length > 0) out.push(missingLine, "");
    out.push("<details>", `<summary>Agent setup files (${setup.length})</summary>`, "");
    out.push("| Path | Kind |", "| --- | --- |");
    for (const f of setup.slice(0, maxRows)) out.push(`| ${code(f.path)} | ${f.kind} |`);
    if (setup.length > maxRows) out.push(`| _…and ${setup.length - maxRows} more files_ | |`);
    out.push("", "</details>", "");
  }

  // The line before the rule is empty, so "---" is a thematic break and never a setext underline.
  const format = report.diffCoverage?.format;
  const formatNote =
    format !== undefined && Object.hasOwn(COVERAGE_FORMAT_LABEL, format)
      ? ` · coverage format ${COVERAGE_FORMAT_LABEL[format]}`
      : "";
  out.push("---", "");
  out.push(`<sub>pharn-ci ${report.tool.version} · report schema v${report.schemaVersion}${formatNote}</sub>`);
  return `${out.join("\n")}\n`;
}

function countFiles(n: number): string {
  return n === 1 ? "1 file" : `${n} files`;
}

/**
 * The sentence inside the verdict callout under the heading. Fixed words, numbers and counts only: nothing input-derived, so no
 * path or message text can reach it.
 */
function overviewLine(report: Report): string {
  const dc = report.diffCoverage;
  let first: string;
  if (dc === null) first = "Diff coverage was not computed";
  else if (dc.percent === null) first = "This change adds no coverable lines";
  else if (dc.threshold === null)
    first = `Diff coverage of this change is ${formatNumber(dc.percent)}%, with no threshold set`;
  else
    first = `Diff coverage of this change is ${formatNumber(dc.percent)}% against a threshold of ${formatNumber(dc.threshold)}%`;
  const n = report.agentSetup.files.length;
  const setup =
    n === 0 ? "no agent setup files found." : n === 1 ? "1 agent setup file found." : `${n} agent setup files found.`;
  return `${first}; ${setup}`;
}

/**
 * The one-glance summary table under the verdict heading. Every cell is a fixed string, an icon, a
 * number or a count: nothing input-derived, so no path or message text can reach it.
 */
function summaryLines(report: Report): string[] {
  const dc = report.diffCoverage;
  let coverage: string;
  if (dc === null) coverage = "not computed";
  else if (dc.percent === null) coverage = "no coverable lines";
  else {
    const threshold = dc.threshold === null ? "no threshold" : `threshold ${formatNumber(dc.threshold)}%`;
    coverage = `${formatNumber(dc.percent)}% (${threshold})`;
  }
  const n = report.agentSetup.files.length;
  const setup = n === 0 ? "none" : n === 1 ? "1 file" : `${n} files`;
  return [
    "| Verdict | Diff coverage | Agent setup |",
    "| --- | --- | --- |",
    `| ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]} | ${coverage} | ${setup} |`,
    "",
  ];
}

function renderMessage(m: Message): string {
  const line = `- ${LEVEL_ICON[m.level]} \`${m.code}\` ${inlineText(m.text)}`;
  // Object.hasOwn: a code from a newer producer has no hint, and must not reach Object.prototype.
  return Object.hasOwn(MESSAGE_HINTS, m.code) ? `${line}\n  - Hint: ${MESSAGE_HINTS[m.code]}` : line;
}

/** Ascending coverage, then path; files without coverable lines (percent null) last. Does not mutate. */
function byCoverage<T extends { path: string; percent: number | null }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => {
    if (a.percent !== b.percent) {
      if (a.percent === null) return 1;
      if (b.percent === null) return -1;
      return a.percent - b.percent;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/** Collapse ascending line numbers into ranges: [1,2,3,7] -> "1-3, 7". */
export function formatRanges(lines: readonly number[]): string {
  return rangeParts(lines).join(", ");
}

/** The uncovered-lines table cell: at most MAX_UNCOVERED_RANGES ranges, then how many are not shown. */
function uncoveredCell(lines: readonly number[]): string {
  const parts = rangeParts(lines);
  if (parts.length <= MAX_UNCOVERED_RANGES) return parts.join(", ");
  return `${parts.slice(0, MAX_UNCOVERED_RANGES).join(", ")}, …and ${parts.length - MAX_UNCOVERED_RANGES} more`;
}

function rangeParts(lines: readonly number[]): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const start = lines[i] as number;
    let end = start;
    while (i + 1 < lines.length && lines[i + 1] === end + 1) {
      end = lines[++i] as number;
    }
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i++;
  }
  return parts;
}

// Paths come from the PR (git allows newlines in file names) and message text can carry inputs
// such as the coverage path or base ref. A line break would let them end the table row or list
// item and inject their own markdown into the PR comment, so control characters never get through.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

function code(path: string): string {
  // Pipes would break the table; backticks would break the code span. Backslashes are escaped first,
  // so a name ending in "\" cannot turn the following "\|" into "\\" plus a real cell separator.
  const safe = path.replace(CONTROL_CHARS, "\uFFFD").replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/`/g, "'");
  return `\`${safe}\``;
}

// Message text carries inputs a PR controls (the coverage path from .pharn/ci.yml, the base ref), so
// the characters that open links, images, emphasis, strikethrough, code spans, headings and tables
// are backslash-escaped. GitHub resolves @mentions after markdown, where a backslash no longer counts,
// so "@" gets a zero-width space after it instead (as Dependabot does). "://" and "www." are escaped
// so a bare URL is not autolinked.
const MARKDOWN_ACTIVE = /[\\`*_[\]#!|~]/g;

/** Message text on one line, with HTML, markdown, mentions and autolinks neutralized. */
function inlineText(text: string): string {
  return text
    .replace(CONTROL_CHARS, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(MARKDOWN_ACTIVE, "\\$&")
    .replace(/@/g, "@\u200B")
    .replace(/:\/\//g, ":\\/\\/")
    .replace(/(www)\./gi, "$1\\.");
}
