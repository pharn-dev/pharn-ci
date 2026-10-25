// Reads a reviewed precision-corpus CSV (written by scripts/corpus-run.mjs, with a verdict added by hand to every block
// row) and prints, per signal that has a block row, the false-block rate and the decision.
// A dev-only maintainer script, never part of the Action or the CLI; nothing the Action bundles imports it. It makes no
// network call and uses Node built-ins only.
//
//   node scripts/corpus-rate.mjs <reviewed.csv> [--format md|json]
//
// Verdicts: TP (a true block), FP (a false block), unclear (reviewed, and not counted as a false block). A signal's
// false-block rate is the number of PRs with an FP block row of that signal over every distinct PR in the CSV, PRs
// that errored included. Below 1 % with every block row of the signal reviewed it ships as block; otherwise it
// demotes to warn. A warn or info row without a verdict never matters.
//
// Exit codes: 0 every block row has a verdict, 1 at least one block row has none (the signal demotes), 2 usage or
// input error.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aggregate, formatRate, parseCsv, verdictError } from "./corpus-lib.mjs";

const USAGE = "usage: node scripts/corpus-rate.mjs <reviewed.csv> [--format md|json]";

// Pure argument parsing: { options } or { error }. No exit here, so tests can call it.
export function parseArgs(argv) {
  let file;
  let format = "md";
  let formatSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--format") {
      if (formatSeen) return { error: "--format given twice" };
      formatSeen = true;
      const value = argv[i + 1];
      if (value === undefined) return { error: "missing value for --format" };
      if (value !== "md" && value !== "json") return { error: `--format is md or json, got ${value}` };
      format = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      return { error: `unknown option ${arg}` };
    } else if (file === undefined) {
      file = arg;
    } else {
      return { error: `unexpected argument ${arg}` };
    }
  }
  if (file === undefined || file === "") return { error: "missing <reviewed.csv>" };
  return { options: { file, format } };
}

// The markdown rendering of an aggregate() summary.
export function renderMarkdown(summary) {
  const lines = [`PRs: ${summary.prs} (errors: ${summary.errors})`, ""];
  if (summary.signals.length === 0) {
    lines.push("No block rows.");
  } else {
    lines.push("| Signal | Block PRs | TP | FP | Unclear | Unreviewed | False-block rate | Decision |");
    lines.push("|---|---:|---:|---:|---:|---:|---:|---|");
    for (const e of summary.signals) {
      lines.push(
        `| ${e.signal} | ${e.blockPrs} | ${e.tp} | ${e.fp} | ${e.unclear} | ${e.unreviewed} | ${formatRate(e.fpPrs, summary.prs)} | ${e.decision} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

// The JSON rendering of an aggregate() summary, with a final newline.
export function renderJson(summary) {
  const signals = summary.signals.map(({ signal, blockPrs, tp, fp, unclear, unreviewed, rate, decision }) => ({
    signal,
    blockPrs,
    tp,
    fp,
    unclear,
    unreviewed,
    rate,
    decision,
  }));
  return `${JSON.stringify({ prs: summary.prs, errors: summary.errors, signals })}\n`;
}

function usageFail(message) {
  process.stderr.write(`corpus-rate: ${message}\n${USAGE}\n`);
  return 2;
}

function main(argv) {
  const parsed = parseArgs(argv);
  if ("error" in parsed) return usageFail(parsed.error);
  const { file, format } = parsed.options;

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    process.stderr.write(
      `corpus-rate: cannot read ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 2;
  }

  let rows;
  try {
    rows = parseCsv(text);
  } catch (error) {
    process.stderr.write(`corpus-rate: ${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const bad = verdictError(rows);
  if (bad !== null) {
    process.stderr.write(`corpus-rate: ${file}: ${bad}\n`);
    return 2;
  }

  const summary = aggregate(rows);
  process.stdout.write(format === "json" ? renderJson(summary) : renderMarkdown(summary));
  if (summary.unreviewedBlockRows > 0) {
    process.stderr.write(`corpus-rate: ${summary.unreviewedBlockRows} block row(s) have no verdict\n`);
    return 1;
  }
  return 0;
}

function isDirectRun() {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) process.exitCode = main(process.argv.slice(2));
