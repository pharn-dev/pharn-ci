import { DEFAULT_ACCEPT_LABEL, GITHUB_LOGIN } from "../acceptLabel.js";
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

/** A hint is a fixed string, or a function of the accept label's code span; the label is validated, never free text. */
type Hint = string | ((labelSpan: string) => string);

/** The accept label a report was made with: the configured name, or the default one. */
function acceptLabelOf(report: Report): string {
  const configured = report.testIntegrity.acceptLabel;
  return typeof configured === "string" && configured !== "" ? configured : DEFAULT_ACCEPT_LABEL;
}

/**
 * One-line remediation per message code, added at render time so message text (which consumers may
 * match on) stays as it is. Fixed strings only: nothing input-derived. The TI03, TI10 and TI13 hints name the
 * accept label, so they are functions of its code span.
 */
const MESSAGE_HINTS: Record<MessageCode, Hint> = {
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
  COVERAGE_LINES_SKIPPED:
    "Regenerate the coverage report and check that the reporter finished writing it; a truncated or hand-edited file can show more coverage than the tests gave.",
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
  TEST_INTEGRITY_MODE_IGNORED:
    "Set the mode with the `test-integrity` input in the workflow; `test_integrity.mode` in `.pharn/ci.yml` can only make the check stricter, so remove the looser value.",
  TEST_INTEGRITY_OFF:
    "Set the `test-integrity` input to `warn` or `block` in the workflow to check for weakened tests.",
  TEST_INTEGRITY_TI01: "Restore the deleted tests, or say in the PR why they go so a reviewer can confirm it.",
  TEST_INTEGRITY_TI02: (label) =>
    `Restore the removed tests, or say in the PR why they go; a reviewer who is not the PR author can record that sign-off by applying the accept label ${label}. A test that only moved or was renamed is not reported when its body is the same or close to it.`,
  TEST_INTEGRITY_TI03: (label) =>
    `A reviewer must decide whether each skipped test may stay, for example one that fails in CI; a reviewer who is not the PR author records that sign-off by applying the accept label ${label}.`,
  TEST_INTEGRITY_TI04:
    "Remove the marker so the whole suite runs, or say in the PR why only the marked tests should run.",
  TEST_INTEGRITY_TI05: (label) =>
    `Restore the assertions the test had, or say in the PR why it checks less now; a reviewer who is not the PR author can record that sign-off by applying the accept label ${label}.`,
  TEST_INTEGRITY_TI08:
    "Review the snapshot changes, or regenerate them in a separate change, and keep snapshot-update flags out of the test command.",
  TEST_INTEGRITY_TI10: (label) =>
    `Restore the test script, or say in the PR why it changes so a reviewer can confirm it; a reviewer who is not the PR author can record that sign-off by applying the accept label ${label}.`,
  TEST_INTEGRITY_TI13: (label) =>
    `Write a test for the code in place of the ignore comment, or say in the PR why it cannot be tested; a reviewer who is not the PR author can record that sign-off by applying the accept label ${label}.`,
  TEST_INTEGRITY_TI11:
    "Restore the test step or trigger, or say in the PR why CI stops running these tests so a reviewer can confirm it.",
  TEST_INTEGRITY_TI14:
    "Restore the threshold or the exclusions, or say in the PR why they change so a reviewer can confirm it.",
  TEST_INTEGRITY_TI15:
    "Check that the code handles the general case and not only the test's value, and add a test with another input.",
  TEST_INTEGRITY_TI16: "Fix the lint or type error the comment hides, or say in the PR why the test needs it.",
  TEST_INTEGRITY_INDEX_UNAVAILABLE:
    "Review the named test files by hand for removed tests and weakened assertions. A file over 512 KiB, one with many syntax errors, a missing Python 3.8 or newer for `.py` files, or git objects that could not be read stop the comparison.",
  TEST_INTEGRITY_TEXT_TRUNCATED:
    "Review the named files by hand for skipped, focused or weakened tests, or split the change so each file stays under the limit.",
  TEST_INTEGRITY_ACCEPTED:
    "A reviewer other than the PR author signed off, so the block findings are warnings. The sign-off belongs to the pull request, not to a commit: remove the label if a later push should be judged again.",
  TEST_INTEGRITY_ACCEPT_IGNORED:
    "The block findings stand. Fix them, or ask a reviewer who is not the PR author to apply the label; it counts only when a user account other than the author applied it last.",
};

/** The hint text for a message code, or undefined when it has none. `label` is the report's accept label. */
function hintFor(code: string, label: string): string | undefined {
  // Object.hasOwn: a code from a newer producer has no hint, and must not reach Object.prototype.
  if (!Object.hasOwn(MESSAGE_HINTS, code)) return undefined;
  const hint = MESSAGE_HINTS[code as MessageCode];
  return typeof hint === "function" ? hint(labelSpan(label)) : hint;
}

/**
 * Quote the accept label as one code span on one line. Control characters become U+FFFD; the fence is one backtick
 * longer than the longest backtick run in the text, so no run in it can close the span; a space pads each side when
 * the text starts or ends with a backtick or a space (CommonMark strips one from each side).
 */
function labelSpan(text: string): string {
  const safe = text.replace(CONTROL_CHARS, "�");
  const longest = Math.max(0, ...(safe.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = /^[` ]|[` ]$/.test(safe) ? " " : "";
  return `${fence}${pad}${safe}${pad}${fence}`;
}

/** The signal ids that have a hint under their finding. */
const SIGNAL_HINT_IDS: ReadonlySet<string> = new Set([
  "TI01",
  "TI02",
  "TI03",
  "TI04",
  "TI05",
  "TI08",
  "TI10",
  "TI11",
  "TI13",
  "TI14",
  "TI15",
  "TI16",
]);

/** Hint under the finding of a test-integrity signal id: the hint of its `TEST_INTEGRITY_<id>` code. */
function signalHint(id: string, label: string): string | undefined {
  return SIGNAL_HINT_IDS.has(id) ? hintFor(`TEST_INTEGRITY_${id}`, label) : undefined;
}

/** Most findings listed in the Test integrity section; the rest are counted. */
const MAX_FINDINGS = 20;
/** Findings listed open; the rest of the listed ones go in a collapsed `<details>`. */
const OPEN_FINDINGS = 10;

const SEVERITY_RANK = { block: 0, warn: 1, info: 2 } as const;

/** The signals block first, then warn, then info, each in report order (path, then line). Does not mutate. */
function bySeverity<T extends { severity: string }>(signals: readonly T[]): T[] {
  const rank = (s: T) => SEVERITY_RANK[s.severity as keyof typeof SEVERITY_RANK] ?? 3;
  return signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => rank(a.signal) - rank(b.signal) || a.index - b.index)
    .map(({ signal }) => signal);
}

/** A `TEST_INTEGRITY_<id>` message of a signal: its findings and hints are in the Test integrity section. */
const SIGNAL_MESSAGE_CODE = /^TEST_INTEGRITY_TI\d\d$/;

const SEVERITY_ICON = { block: LEVEL_ICON.error, warn: LEVEL_ICON.warn, info: LEVEL_ICON.info } as const;

/**
 * The lines of the Test integrity section after its heading: one finding per signal with a hint line, or the one
 * fixed line when there is none. The fixed line has nothing from the pull request in it.
 */
function testIntegrityLines(report: Report): string[] {
  const { mode, signals } = report.testIntegrity;
  const label = acceptLabelOf(report);
  const lines: string[] = [];
  if (signals.length === 0) {
    lines.push(mode === "off" ? "Test integrity is off for this run." : `No test-integrity findings (mode: ${mode}).`);
  } else {
    // Blocks first, so the findings that decide the verdict are never the ones collapsed or cut.
    const listed = bySeverity(signals).slice(0, MAX_FINDINGS);
    const findingLines = (signal: (typeof signals)[number]) => {
      const location = signal.line === null ? code(signal.path) : code(`${signal.path}:${signal.line}`);
      const out = [
        `- ${SEVERITY_ICON[signal.severity] ?? LEVEL_ICON.info} **${inlineText(signal.id)}** ${location} — ${inlineText(signal.detail)}`,
      ];
      const hint = signalHint(signal.id, label);
      if (hint !== undefined) out.push(`  - Hint: ${hint}`);
      return out;
    };
    for (const signal of listed.slice(0, OPEN_FINDINGS)) lines.push(...findingLines(signal));
    const folded = listed.slice(OPEN_FINDINGS);
    if (folded.length > 0) {
      lines.push(
        "",
        `<details><summary>${countOf(folded.length, "more finding", "more findings")}</summary>`,
        "",
        ...folded.flatMap(findingLines),
        "",
        "</details>",
        "",
      );
    }
    if (signals.length > MAX_FINDINGS) {
      lines.push(`- _…and ${signals.length - MAX_FINDINGS} more findings in report.json._`);
    }
  }
  const accepted = report.testIntegrity.accepted;
  if (typeof accepted === "object" && accepted !== null && typeof accepted.label === "string") {
    // The login is shown only when it has the shape of one; anything else (an older or another producer's report)
    // leaves the line without a name rather than printing free text.
    const by = typeof accepted.by === "string" && GITHUB_LOGIN.test(accepted.by) ? ` by @${accepted.by}` : "";
    // A blank line first: right after a list item, the text would read as a continuation of its hint.
    lines.push("", `Accepted via label ${labelSpan(accepted.label)}${by}`);
  }
  return lines;
}

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

  out.push("### 🔍 Test integrity", "", ...testIntegrityLines(report), "");

  // Before the agent setup inventory: when the Action has to drop rows to fit a size limit, the
  // reason for the verdict is never what goes.
  // A signal's message repeats what the Test integrity section lists with its hint, so it is left out here when the
  // section lists that signal id; report.json and the job's verdict still carry it.
  const listedIds = new Set(report.testIntegrity.signals.map((s) => `TEST_INTEGRITY_${s.id}`));
  const messages = report.messages.filter((m) => !(SIGNAL_MESSAGE_CODE.test(m.code) && listedIds.has(m.code)));
  if (messages.length > 0) {
    out.push(`### 💬 Messages (${messages.length})`, "");
    for (const m of messages) out.push(renderMessage(m, report));
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
  const findings = report.testIntegrity.signals;
  if (findings.length === 0) return `${first}; ${setup}`;
  const blocking = findings.filter((s) => s.severity === "block").length;
  const integrity = `${countOf(findings.length, "test-integrity finding", "test-integrity findings")}${blocking > 0 ? `, ${blocking} blocking` : ""}`;
  return `${first}; ${integrity}; ${setup}`;
}

/** `1 finding`, `3 findings`: a count with the word for it. */
function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The Test integrity cell of the summary table: `off`, `none (warn)` or a count of findings. Fixed words and numbers. */
function integrityCell(report: Report): string {
  const { mode, signals } = report.testIntegrity;
  if (mode === "off") return "off";
  if (signals.length === 0) return `none (${mode})`;
  const blocking = signals.filter((s) => s.severity === "block").length;
  const icon =
    blocking > 0 ? LEVEL_ICON.error : signals.some((s) => s.severity === "warn") ? LEVEL_ICON.warn : LEVEL_ICON.info;
  return `${icon} ${countOf(signals.length, "finding", "findings")}${blocking > 0 ? `, ${blocking} blocking` : ""}`;
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
    "| Verdict | Diff coverage | Test integrity | Agent setup |",
    "| --- | --- | --- | --- |",
    `| ${VERDICT_ICON[report.verdict]} ${VERDICT_LABEL[report.verdict]} | ${coverage} | ${integrityCell(report)} | ${setup} |`,
    "",
  ];
}

function renderMessage(m: Message, report: Report): string {
  const line = `- ${LEVEL_ICON[m.level]} \`${m.code}\` ${inlineText(m.text)}`;
  const hint = hintFor(m.code, acceptLabelOf(report));
  return hint === undefined ? line : `${line}\n  - Hint: ${hint}`;
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
// Control characters, line and paragraph separators, and the invisible format characters that reorder or hide text
// (zero-width marks, bidirectional overrides and isolates, the byte order mark): each becomes U+FFFD.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

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
