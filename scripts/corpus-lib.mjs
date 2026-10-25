// Pure helpers shared by scripts/corpus-run.mjs and scripts/corpus-rate.mjs: the review CSV (ten columns, RFC 4180),
// the rows of one CLI report, and the per-signal false-block aggregation and decision.
// A dev-only maintainer module, never part of the Action or the CLI; nothing the Action bundles imports it. It does no
// I/O (no files, no processes, no network) and uses no dependencies.

export const COLUMNS = ["repo", "pr", "signal", "severity", "path", "line", "code", "detail", "verdict", "note"];
export const HEADER = COLUMNS.join(",");

// The review verdicts a person may write into the `verdict` column; empty means not reviewed yet.
export const VERDICTS = ["", "TP", "FP", "unclear"];

// --- CSV (RFC 4180) ---------------------------------------------------------------------------------

const needsQuotes = (value) => /[",\r\n]/.test(value);
const field = (value) => (needsQuotes(value) ? `"${value.replaceAll('"', '""')}"` : value);

// Plain code-unit string order.
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Integer order on digit strings; anything that is not an integer falls back to string order.
function compareInt(a, b) {
  const x = Number.parseInt(a, 10);
  const y = Number.parseInt(b, 10);
  if (Number.isNaN(x) || Number.isNaN(y)) return compareText(a, b);
  return x - y;
}

const compareLine = (a, b) => (a === b ? 0 : a === "" ? -1 : b === "" ? 1 : compareInt(a, b));

// The row order: repo, PR number, signal, path, line (empty first); the rest only makes the order total.
export function compareRows(a, b) {
  return (
    compareText(a.repo, b.repo) ||
    compareInt(a.pr, b.pr) ||
    compareText(a.signal, b.signal) ||
    compareText(a.path, b.path) ||
    compareLine(a.line, b.line) ||
    compareText(a.code, b.code) ||
    compareText(a.severity, b.severity) ||
    compareText(a.detail, b.detail) ||
    compareText(a.verdict, b.verdict) ||
    compareText(a.note, b.note)
  );
}

// A copy with every column present as a string.
const complete = (row) => Object.fromEntries(COLUMNS.map((column) => [column, String(row[column] ?? "")]));

export function sortRows(rows) {
  return rows.map(complete).sort(compareRows);
}

// The header and the sorted rows, every record ended by CRLF, no BOM. Any input order gives the same text.
export function serializeCsv(rows) {
  const records = [HEADER, ...sortRows(rows).map((row) => COLUMNS.map((column) => field(row[column])).join(","))];
  return records.map((record) => `${record}\r\n`).join("");
}

// Splits CSV text into records of fields. Inside quotes everything is literal; spaces are never trimmed.
function parseRecords(text) {
  const records = [];
  let record = [];
  let value = "";
  let state = "start"; // start (field start) | bare | quoted | after (after a closing quote)
  let number = 1;

  const endField = () => {
    record.push(value);
    value = "";
    state = "start";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
    number += 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (state === "quoted") {
      if (c !== '"') value += c;
      else if (text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else state = "after";
      continue;
    }
    if (c === ",") endField();
    else if (c === "\n") endRecord();
    else if (c === "\r" && text[i + 1] === "\n") {
      i += 1;
      endRecord();
    } else if (state === "after") {
      throw new Error(`record ${number}: text after a closing quote`);
    } else if (c === '"') {
      if (state !== "start") throw new Error(`record ${number}: a quote inside an unquoted field`);
      state = "quoted";
    } else {
      value += c;
      state = "bare";
    }
  }
  if (state === "quoted") throw new Error(`record ${number}: unterminated quoted field`);
  // An empty trailing record (the text ended on a line break) is dropped.
  if (record.length > 0 || value !== "" || state !== "start") endRecord();
  return records;
}

// The data rows of a review CSV as objects. Throws an Error naming the 1-based record on malformed text, and for a
// first record that is not exactly the ten columns.
export function parseCsv(text) {
  const [header, ...data] = parseRecords(text);
  if (header === undefined || header.length !== COLUMNS.length || header.some((name, i) => name !== COLUMNS[i]))
    throw new Error(`header must be exactly: ${HEADER}`);
  return data.map((fields, index) => {
    if (fields.length !== COLUMNS.length)
      throw new Error(`record ${index + 2}: ${fields.length} fields, expected ${COLUMNS.length}`);
    return Object.fromEntries(COLUMNS.map((column, i) => [column, fields[i] ?? ""]));
  });
}

// The first row whose verdict is outside VERDICTS, as a message naming `<repo>#<pr>`, or null.
export function verdictError(rows) {
  for (const row of rows) {
    if (!VERDICTS.includes(row.verdict))
      return `${row.repo}#${row.pr}: verdict must be empty, TP, FP or unclear, got ${JSON.stringify(row.verdict)}`;
  }
  return null;
}

// --- Rows of one CLI report --------------------------------------------------------------------------

const SEVERITIES = ["block", "warn", "info"];

// True when `value.testIntegrity.signals` is an array of well-formed signal entries.
export function isReport(value) {
  const signals = value?.testIntegrity?.signals;
  if (!Array.isArray(signals)) return false;
  return signals.every(
    (signal) =>
      signal !== null &&
      typeof signal === "object" &&
      typeof signal.id === "string" &&
      /^TI\d\d$/.test(signal.id) &&
      SEVERITIES.includes(signal.severity) &&
      typeof signal.path === "string" &&
      (signal.line === null || (Number.isInteger(signal.line) && signal.line > 0)) &&
      typeof signal.detail === "string",
  );
}

const blankRow = (repo, pr) => ({
  ...Object.fromEntries(COLUMNS.map((column) => [column, ""])),
  repo,
  pr: String(pr),
});

// One row per signal of the report, or a single `none` row when there are none. Verdict and note start empty.
export function rowsFromReport(repo, pr, report) {
  const signals = report.testIntegrity.signals;
  if (signals.length === 0) return [{ ...blankRow(repo, pr), signal: "none" }];
  return signals.map((signal) => ({
    ...blankRow(repo, pr),
    signal: signal.id,
    severity: signal.severity,
    path: signal.path,
    line: signal.line === null ? "" : String(signal.line),
    code: `TEST_INTEGRITY_${signal.id}`,
    detail: signal.detail,
  }));
}

// The single row of a PR that could not be run.
export function errorRow(repo, pr, detail) {
  return { ...blankRow(repo, pr), signal: "error", detail };
}

// --- Aggregation and decision ------------------------------------------------------------------------

const prKey = (row) => `${row.repo}\u0000${row.pr}`;

// Below 1 % false-block rate (an integer comparison, so 2 of 200 is exactly 1 % and demotes) with every block row
// reviewed ships as block; anything else demotes to warn.
export function decide({ fpPrs, prs, unreviewed }) {
  return fpPrs * 100 < prs && unreviewed === 0 ? "ships as block" : "demote to warn";
}

export function formatRate(fpPrs, prs) {
  return `${((fpPrs * 100) / prs).toFixed(1)} %`;
}

// Per signal with at least one block row: the PRs with a block row, the verdict counts of those rows, the PRs with a
// false block, the rate over every distinct PR in the CSV (error PRs included) and the decision.
export function aggregate(rows) {
  const allPrs = new Set(rows.map(prKey));
  const errorPrs = new Set(rows.filter((row) => row.signal === "error").map(prKey));
  const prs = allPrs.size;

  const ids = [
    ...new Set(
      rows
        .filter((row) => row.severity === "block" && row.signal !== "none" && row.signal !== "error")
        .map((row) => row.signal),
    ),
  ].sort(compareText);

  const signals = ids.map((signal) => {
    const blocks = rows.filter((row) => row.signal === signal && row.severity === "block");
    const count = (verdict) => blocks.filter((row) => row.verdict === verdict).length;
    const fpPrs = new Set(blocks.filter((row) => row.verdict === "FP").map(prKey)).size;
    const unreviewed = count("");
    return {
      signal,
      blockPrs: new Set(blocks.map(prKey)).size,
      tp: count("TP"),
      fp: count("FP"),
      unclear: count("unclear"),
      unreviewed,
      fpPrs,
      rate: prs === 0 ? 0 : fpPrs / prs,
      decision: decide({ fpPrs, prs, unreviewed }),
    };
  });

  return {
    prs,
    errors: errorPrs.size,
    signals,
    unreviewedBlockRows: signals.reduce((total, entry) => total + entry.unreviewed, 0),
  };
}
