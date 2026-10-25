import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { escapeDetailText } from "./detailText.js";
import { isPackageJsonFile, isPytestConfigFile, isSnapshotFile } from "./signalFiles.js";
import { testLanguage } from "./testLines.js";
import { parseScriptLine, runsMocha } from "./ti10.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** More snapshot files than this, changed in one change, give the mass-change signal. */
const MAX_SNAPSHOT_FILES = 10;
/** This many inline snapshots rewritten in one test file give the inline signal. */
const MIN_INLINE_REWRITES = 10;
/** The most update-flag signals one file gives; the rest are dropped, keeping the lowest line numbers. */
const MAX_FLAG_SIGNALS_PER_FILE = 20;
/** The longest detail a signal carries. */
const MAX_DETAIL = 300;
/** The paths the mass-change detail names, at most. */
const NAMED_PATHS = 3;

// The flag words and the call are built from parts, so this file holds none of them as written.
const DASH = "-";
const UPDATE_FLAGS: ReadonlySet<string> = new Set([
  `${DASH}u`,
  `${DASH}${DASH}update`,
  `${DASH}${DASH}updateSnapshot`,
  `${DASH}${DASH}update-snapshots`,
  `${DASH}${DASH}snapshot-update`,
]);
const SHORT_FLAG = `${DASH}u`;
const PYTEST_FLAG = `${DASH}${DASH}snapshot-update`;
const INLINE_CALL = ["toMatchInline", "Snapshot("].join("");

const SCRIPT_DETAIL =
  "A test script now updates snapshots on every run, so a changed output rewrites its snapshot instead of failing the test.";
const PYTEST_DETAIL =
  "The pytest configuration now updates snapshots on every run, so a changed output rewrites its snapshot instead of failing the test.";

/** (a) Whether a diff entry counts as a changed snapshot file. */
function countsAsChangedSnapshot(file: DiffFile): boolean {
  if (!isSnapshotFile(file.path)) return false;
  if (file.status === "modified" || file.status === "deleted") return true;
  return file.status === "renamed" && file.addedLines.length > 0;
}

/** The mass-change detail: the count, then as many of the first three paths as keep it within 300 characters. */
function massChangeDetail(count: number, firstPaths: readonly string[]): string {
  const tail = "; check that each new snapshot was reviewed rather than regenerated.";
  const head = `${count} snapshot files were changed in this change`;
  const named = firstPaths.slice(0, NAMED_PATHS).map((path) => `"${escapeDetailText(path)}"`);
  while (named.length > 0) {
    const detail = `${head}, among them ${named.join(", ")}${tail}`;
    if (detail.length <= MAX_DETAIL) return detail;
    named.pop();
  }
  return `${head}${tail}`;
}

function detectSnapshotFiles(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const counted = [...new Set(diff.filter(countsAsChangedSnapshot).map((file) => file.path))].sort(byCodeUnit);
  if (counted.length <= MAX_SNAPSHOT_FILES) return [];
  return [
    {
      id: "TI08",
      severity: "warn",
      path: counted[0] as string,
      line: null,
      detail: massChangeDetail(counted.length, counted),
    },
  ];
}

/** (b) Inline snapshots rewritten in a JS/TS test file: the trimmed lines that hold the call, as multisets. */
function detectInlineRewrites(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true) continue;
    if (!isTestFile(file.path) || testLanguage(file.path) !== "jsts") continue;

    const removed = new Map<string, number>();
    let removedTotal = 0;
    for (const hunk of file.hunks) {
      for (const entry of hunk.removed) {
        if (!entry.text.includes(INLINE_CALL)) continue;
        const key = entry.text.trim();
        removed.set(key, (removed.get(key) ?? 0) + 1);
        removedTotal++;
      }
    }
    if (removedTotal === 0) continue;

    const added: Array<{ line: number; key: string }> = [];
    for (const hunk of file.hunks) {
      for (const entry of hunk.added) {
        if (entry.text.includes(INLINE_CALL)) added.push({ line: entry.line, key: entry.text.trim() });
      }
    }
    added.sort((a, b) => a.line - b.line);

    // An added line that has an equal removed line left takes it, earliest first; the others are rewritten.
    let removedLeft = removedTotal;
    const unmatchedAdded: number[] = [];
    for (const entry of added) {
      const left = removed.get(entry.key) ?? 0;
      if (left > 0) {
        removed.set(entry.key, left - 1);
        removedLeft--;
      } else {
        unmatchedAdded.push(entry.line);
      }
    }
    const rewritten = Math.min(removedLeft, unmatchedAdded.length);
    if (rewritten < MIN_INLINE_REWRITES) continue;
    signals.push({
      id: "TI08",
      severity: "warn",
      path: file.path,
      line: unmatchedAdded[0] as number,
      detail: `${rewritten} inline snapshots were rewritten in this test file at once; check that each new value was reviewed rather than regenerated.`,
    });
  }
  return signals;
}

/** The update flags a script value holds: the words between white space and `;`, `|` and `&`, each cut at its first `=`. */
function updateFlagsOf(value: string): Set<string> {
  const found = new Set<string>();
  const mocha = runsMocha(value);
  for (const word of value.split(/[\s;|&]+/)) {
    const equals = word.indexOf("=");
    const flag = equals === -1 ? word : word.slice(0, equals);
    if (!UPDATE_FLAGS.has(flag)) continue;
    if (flag === SHORT_FLAG && mocha) continue;
    found.add(flag);
  }
  return found;
}

/** (c) An update flag added to a `test*` script of a modified or renamed `package.json`. */
function detectScriptFlags(file: DiffFile): TestIntegritySignal[] {
  if (file.hunks === undefined || file.binary === true || !isPackageJsonFile(file.path)) return [];
  if (file.status !== "modified" && file.status !== "renamed") return [];

  const before = new Map<string, Set<string>>();
  for (const hunk of file.hunks) {
    for (const entry of hunk.removed) {
      const script = parseScriptLine(entry.text);
      if (script === null || !script.key.startsWith("test")) continue;
      const flags = before.get(script.key) ?? new Set<string>();
      for (const flag of updateFlagsOf(script.value)) flags.add(flag);
      before.set(script.key, flags);
    }
  }

  const lines: number[] = [];
  for (const hunk of file.hunks) {
    for (const entry of hunk.added) {
      const script = parseScriptLine(entry.text);
      if (script === null || !script.key.startsWith("test")) continue;
      const known = before.get(script.key);
      for (const flag of updateFlagsOf(script.value)) {
        if (known?.has(flag)) continue;
        lines.push(entry.line);
        break;
      }
    }
  }
  return toFlagSignals(file.path, lines, SCRIPT_DETAIL);
}

/** (c) The pytest snapshot-update word added to a pytest config file. */
function detectPytestFlag(file: DiffFile): TestIntegritySignal[] {
  if (file.hunks === undefined || file.binary === true || !isPytestConfigFile(file.path)) return [];
  if (file.status === "deleted") return [];
  const holdsFlag = (text: string) => text.split(/\s+/).includes(PYTEST_FLAG);

  for (const hunk of file.hunks) {
    for (const entry of hunk.removed) if (holdsFlag(entry.text)) return [];
  }
  const lines: number[] = [];
  for (const hunk of file.hunks) {
    for (const entry of hunk.added) if (holdsFlag(entry.text)) lines.push(entry.line);
  }
  return toFlagSignals(file.path, lines, PYTEST_DETAIL);
}

function toFlagSignals(path: string, lines: number[], detail: string): TestIntegritySignal[] {
  return lines
    .sort((a, b) => a - b)
    .slice(0, MAX_FLAG_SIGNALS_PER_FILE)
    .map((line) => ({ id: "TI08", severity: "warn" as const, path, line, detail }));
}

/**
 * TI08, snapshot churn; always severity `warn`, in mode block as in mode warn. Three rules:
 *
 * (a) More than 10 snapshot files changed in one change (`isSnapshotFile`; modified, deleted, or renamed with added
 * lines; an added file never counts) give one signal with line null at the first counted path in code-unit order.
 * (b) A JS/TS test file that rewrites 10 or more inline-snapshot lines gives one signal at the lowest rewritten added
 * line: the removed and the added lines holding the call are compared as multisets of their trimmed text, and the
 * count is the smaller side of what is left. (c) An update flag added to a `test*` script of `package.json`, or the
 * pytest snapshot-update word added to a pytest config file, gives one signal at the added line (at most 20 per file).
 *
 * Only the status, the added line numbers and the kept line text are read. A path in a detail is written by
 * `escapeDetailText`; no other diff text reaches a signal.
 */
export function detectTI08(diff: readonly DiffFile[]): TestIntegritySignal[] {
  const signals = [...detectSnapshotFiles(diff), ...detectInlineRewrites(diff)];
  for (const file of diff) signals.push(...detectScriptFlags(file), ...detectPytestFlag(file));
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}
