import { formatNumber, type Message, type Report } from "../report.js";

export interface RenderMarkdownOptions {
  /** Maximum file rows per table; the rest are summarized. Keeps PR comments under GitHub's size limit. */
  maxRows?: number;
}

const VERDICT_ICON = { pass: "✅", warn: "⚠️", fail: "❌" } as const;
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

  out.push("### Agent setup", "");
  const setup = report.agentSetup.files;
  if (setup.length === 0) {
    out.push("_No agent setup files found._", "");
  } else {
    out.push("| Path | Kind |", "| --- | --- |");
    for (const f of setup.slice(0, maxRows)) out.push(`| ${code(f.path)} | ${f.kind} |`);
    if (setup.length > maxRows) out.push(`| _…and ${setup.length - maxRows} more files_ | |`);
    out.push("");
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
  return `- ${LEVEL_ICON[m.level]} \`${m.code}\` ${m.text}`;
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

function code(path: string): string {
  // Pipes would break the table; backticks would break the code span.
  return `\`${path.replace(/\|/g, "\\|").replace(/`/g, "'")}\``;
}
