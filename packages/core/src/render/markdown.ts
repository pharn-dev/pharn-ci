import { formatNumber, type Message, type Report } from "../report.js";
import { summarizeAgentSetup } from "../setup/summary.js";

export interface RenderMarkdownOptions {
  /** Maximum file rows per table; the rest are summarized. Keeps PR comments under GitHub's size limit. */
  maxRows?: number;
}

const VERDICT_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
/** Inventories larger than this get their table collapsed in a `<details>` block. */
const COLLAPSE_ABOVE = 25;
const LEVEL_ICON = { info: "ℹ️", warn: "⚠️", error: "❌" } as const;

/** Render a Report as GitHub-flavored markdown (PR comment, job summary, CLI). */
export function renderMarkdown(report: Report, options: RenderMarkdownOptions = {}): string {
  const maxRows = options.maxRows ?? 50;
  const out: string[] = [];

  out.push(`## ${VERDICT_ICON[report.verdict]} pharn-ci: ${report.verdict}`, "");

  out.push("### Diff coverage", "");
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
    out.push("| File | Coverage | Covered | Uncovered lines |", "| --- | ---: | ---: | --- |");
    for (const f of dc.files.slice(0, maxRows)) {
      const pct = f.percent === null ? "—" : `${formatNumber(f.percent)}%`;
      const uncovered = f.uncoveredLines.length === 0 ? "" : formatRanges(f.uncoveredLines);
      out.push(`| ${code(f.path)} | ${pct} | ${f.coveredLines}/${f.coverableLines} | ${uncovered} |`);
    }
    if (dc.files.length > maxRows) out.push(`| _…and ${dc.files.length - maxRows} more files_ | | | |`);
    out.push("");
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

  out.push("### Agent setup", "");
  const setup = report.agentSetup.files;
  if (setup.length === 0) {
    out.push("_No agent setup files found._", "");
  } else {
    // Count, fixed words and names from the fixed tool list only: nothing input-derived. buildReport
    // already summarized the files; a report without a summary (an older producer's) is summarized here.
    const { tools } = report.agentSetup.summary ?? summarizeAgentSetup(setup);
    out.push(`Agent setup: ${setup.length} ${setup.length === 1 ? "file" : "files"} · ${tools.join(", ")}`, "");
    const collapse = setup.length > COLLAPSE_ABOVE;
    if (collapse) out.push("<details>", `<summary>Show all ${setup.length} agent setup files</summary>`, "");
    out.push("| Path | Kind |", "| --- | --- |");
    for (const f of setup.slice(0, maxRows)) out.push(`| ${code(f.path)} | ${f.kind} |`);
    if (setup.length > maxRows) out.push(`| _…and ${setup.length - maxRows} more files_ | |`);
    out.push("");
    if (collapse) out.push("</details>", "");
  }

  if (report.messages.length > 0) {
    out.push("### Messages", "");
    for (const m of report.messages) out.push(renderMessage(m));
    out.push("");
  }

  out.push(`<sub>pharn-ci ${report.tool.version} · report schema v${report.schemaVersion}</sub>`);
  return `${out.join("\n")}\n`;
}

function renderMessage(m: Message): string {
  return `- ${LEVEL_ICON[m.level]} \`${m.code}\` ${inlineText(m.text)}`;
}

/** Collapse ascending line numbers into ranges: [1,2,3,7] -> "1-3, 7". */
export function formatRanges(lines: readonly number[]): string {
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
  return parts.join(", ");
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
