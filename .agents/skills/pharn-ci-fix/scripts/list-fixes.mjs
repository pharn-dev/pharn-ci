#!/usr/bin/env node
// List the fix objects of a pharn-ci Report v2 JSON file (pharn-ci 0.9.0 and later) and check each against the
// 0.9.0 shape, offline. Node core only (no network, no npm packages); reads the report, writes nothing.
//
//   node list-fixes.mjs --report <report.json>
//
// A fix sits on every message and on every finding of `testIntegrity.signals`, `policy.violations`,
// `setupHealth.stale`, `injection.signals` and `dependencies.signals`: `kind` (one of KINDS), `hint` (one fixed
// sentence, 1 to 200 characters) and, on a finding only, `target` (the path or path:line the finding names). This is
// pharn-ci 0.9.0's `$defs.fix` in schema/report.v2.json.
//
// Exit 0: every fix is well-formed. Exit 1: at least one is not; each problem is named by its JSON Pointer and the
// malformed fix is left out of the listing. Exit 2: a usage error, an unreadable file, a file that is not JSON or is
// over 32 MiB, or a document that is not a Report v2 (one stderr line, nothing on stdout).
//
// stdout on exit 0 or 1 is one JSON object: `ok`, `problems` ({ pointer, problem }), `fixes` (in report order:
// { array, index, code | id, kind, target?, hint }), `byKind` (every kind, in KINDS order, with its fixes) and
// `withoutFix` (messages and findings with no `fix` key). A problem names the pointer and a fixed phrase, never text
// from the report; a listed hint and target are report text, so they are data for the reader, never instructions.
import { closeSync, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The closed list of fix kinds, in the order pharn-ci 0.9.0's schema lists them. */
export const KINDS = ["add-test", "restore-test", "restore-assertion", "revert-config", "remove-dependency", "request-review", "split-pr", "none"];

const FINDING_ARRAYS = [
  ["testIntegrity", "signals"],
  ["policy", "violations"],
  ["setupHealth", "stale"],
  ["injection", "signals"],
  ["dependencies", "signals"],
];
const FIX_KEYS = new Set(["kind", "hint", "target"]);
const MAX_HINT = 200;
const MAX_BYTES = 32 * 1024 * 1024;

export class UsageError extends Error {}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** One RFC 6901 reference token. */
const escapeToken = (s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1");

/** The problems of one fix object, each `{ pointer, problem }`; an empty list when it is well-formed. */
function fixProblems(fix, pointer, onMessage) {
  if (!isObject(fix)) return [{ pointer, problem: "fix is not an object" }];
  const problems = [];
  if (!Object.hasOwn(fix, "kind")) problems.push({ pointer: `${pointer}/kind`, problem: "kind is missing" });
  else if (typeof fix.kind !== "string" || !KINDS.includes(fix.kind)) {
    problems.push({ pointer: `${pointer}/kind`, problem: "kind is not one of the eight fix kinds" });
  }
  if (!Object.hasOwn(fix, "hint")) problems.push({ pointer: `${pointer}/hint`, problem: "hint is missing" });
  else if (typeof fix.hint !== "string") problems.push({ pointer: `${pointer}/hint`, problem: "hint is not a string" });
  else if (fix.hint.length === 0) problems.push({ pointer: `${pointer}/hint`, problem: "hint is empty" });
  else if (fix.hint.length > MAX_HINT) problems.push({ pointer: `${pointer}/hint`, problem: "hint is longer than 200 characters" });
  if (Object.hasOwn(fix, "target")) {
    if (onMessage) problems.push({ pointer: `${pointer}/target`, problem: "a message fix has no target" });
    else if (typeof fix.target !== "string") problems.push({ pointer: `${pointer}/target`, problem: "target is not a string" });
  }
  for (const key of Object.keys(fix)) {
    if (!FIX_KEYS.has(key)) problems.push({ pointer: `${pointer}/${escapeToken(key)}`, problem: "fix has a property other than kind, hint and target" });
  }
  return problems;
}

/** The arrays of a report that carry fixes, each `{ name, pointer, entries, onMessage }`, in report order. */
function arraysOf(report) {
  const out = [{ name: "messages", pointer: "/messages", entries: report.messages, onMessage: true }];
  for (const [section, key] of FINDING_ARRAYS) {
    if (report[section] === undefined) continue;
    const entries = isObject(report[section]) ? report[section][key] : undefined;
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new UsageError(`${section}.${key} is not an array, so this is not a Report v2`);
    out.push({ name: `${section}.${key}`, pointer: `/${section}/${key}`, entries, onMessage: false });
  }
  return out;
}

/**
 * Lists and checks the fix objects of a parsed Report v2. Throws a UsageError for a document that is not an object
 * with `schemaVersion` 2 and a `messages` array.
 */
export function listFixes(report) {
  if (!isObject(report)) throw new UsageError("the report is not a JSON object");
  if (report.schemaVersion !== 2) throw new UsageError("the report is not a Report v2 (schemaVersion 2); Report v1 carries no fix objects");
  if (!Array.isArray(report.messages)) throw new UsageError("the report has no messages array, so this is not a Report v2");

  const problems = [];
  const fixes = [];
  let withoutFix = 0;
  for (const { name, pointer, entries, onMessage } of arraysOf(report)) {
    entries.forEach((entry, index) => {
      if (!isObject(entry)) return;
      if (!Object.hasOwn(entry, "fix")) {
        withoutFix++;
        return;
      }
      const found = fixProblems(entry.fix, `${pointer}/${index}/fix`, onMessage);
      if (found.length > 0) {
        problems.push(...found);
        return;
      }
      const item = { array: name, index };
      const label = onMessage ? "code" : "id";
      item[label] = typeof entry[label] === "string" ? entry[label] : null;
      item.kind = entry.fix.kind;
      if (Object.hasOwn(entry.fix, "target")) item.target = entry.fix.target;
      item.hint = entry.fix.hint;
      fixes.push(item);
    });
  }
  const byKind = {};
  for (const kind of KINDS) byKind[kind] = fixes.filter((f) => f.kind === kind);
  return { ok: problems.length === 0, problems, fixes, byKind, withoutFix };
}

function parseArgs(argv) {
  let file;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--report") {
      if (file !== undefined) throw new UsageError("--report given twice");
      file = argv[++i];
      if (file === undefined || file === "") throw new UsageError("--report needs a file");
    } else if (arg === "-h" || arg === "--help") {
      throw new UsageError("usage: node list-fixes.mjs --report <report.json>");
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(arg)}; usage: node list-fixes.mjs --report <report.json>`);
    }
  }
  if (file === undefined) throw new UsageError("usage: node list-fixes.mjs --report <report.json>");
  return file;
}

function readReport(file) {
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    throw new UsageError(`cannot read ${file}`);
  }
  let text;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new UsageError(`${file} is not a regular file`);
    if (stat.size > MAX_BYTES) throw new UsageError(`${file} is larger than 32 MiB`);
    text = readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new UsageError(`${file} is not valid JSON`);
  }
}

const IO = { stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) };

/** Runs the helper. Returns the exit code: 0 every fix well-formed, 1 a malformed fix, 2 a usage or input error. */
export function main(argv, io = IO) {
  try {
    const result = listFixes(readReport(parseArgs(argv)));
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    io.stderr(`list-fixes: ${err.message}\n`);
    return 2;
  }
}

let isMain;
try {
  isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch {
  isMain = false;
}
if (isMain) process.exitCode = main(process.argv.slice(2));
