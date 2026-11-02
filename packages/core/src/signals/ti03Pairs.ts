import type { DiffFile } from "../diff/unified.js";
import type { TestBlock } from "../testIndex/types.js";
import type { TestSourceSide, TestSources } from "../testSources.js";
import { pythonImportAliases } from "./pythonAliases.js";
import { type PythonSkipLine, parseJsTestCall, parsePythonSkip } from "./testLines.js";
import type { TestMatch } from "./testMatch.js";
import { languageOf, type TouchedTests } from "./testPairs.js";

/** A TI03 category: `existing` takes the mode as its severity; `conditional`, `cannot-place` and `adds` are `warn`. */
export type Ti03Category = "existing" | "conditional" | "cannot-place" | "adds";

/** One TI03 finding before its severity and fixed sentence are given: the head path, a line and a category. */
export interface Ti03Finding {
  path: string;
  line: number;
  category: Ti03Category;
}

/** How a test is skipped, ordered so the stronger state is the larger number. */
type SkipState = 0 | 1 | 2;
const NONE: SkipState = 0;
const CONDITIONAL: SkipState = 1;
const UNCONDITIONAL: SkipState = 2;

const stronger = (a: SkipState, b: SkipState): SkipState => (a > b ? a : b);
const contains = (outer: TestBlock, inner: TestBlock) => outer.line <= inner.line && inner.endLine <= outer.endLine;

/** One side of one test file as the pair pass reads it. */
interface FileView {
  python: boolean;
  /** The text split into lines, or null without text. */
  lines: readonly string[] | null;
  /** The describe blocks (JS/TS `describe`, Python test classes), by line and then by end line from the last. */
  groups: readonly TestBlock[];
  /** The index of the innermost group that holds each group, or -1. */
  parent: Int32Array;
  /** Each group's effective state: its own, or that of the group holding it when that is stronger. */
  groupState: SkipState[];
}

/** A JS/TS `skipIf(true)` or `runIf(false)` (unconditional), `skipIf(false)` or `runIf(true)` (no skip), else null. */
function jsConstant(text: string | undefined): SkipState | null {
  if (text === undefined) return null;
  const parsed = parseJsTestCall(text);
  if (parsed === null || parsed.kind !== "call") return null;
  if (parsed.token === "skipIf") {
    return parsed.condition === "true" ? UNCONDITIONAL : parsed.condition === "false" ? NONE : null;
  }
  if (parsed.token === "runIf") {
    return parsed.condition === "false" ? UNCONDITIONAL : parsed.condition === "true" ? NONE : null;
  }
  return null;
}

/**
 * A block's own skip state from its modifiers: `skip`, `todo` and `fails` are unconditional, `skipIf` and `runIf`
 * conditional. A JS/TS constant condition on the block's opening line decides it (the block records no condition, so
 * the line is read from the source text); in a Python file `fails` with `skipIf` (a conditional xfail) is conditional,
 * and no Python condition is read as a constant.
 */
function ownState(block: TestBlock, view: Pick<FileView, "python" | "lines">): SkipState {
  const modifiers = block.modifiers;
  if (modifiers.includes("skip") || modifiers.includes("todo")) return UNCONDITIONAL;
  if (modifiers.includes("fails") && !(view.python && modifiers.includes("skipIf"))) return UNCONDITIONAL;
  if (!modifiers.includes("skipIf") && !modifiers.includes("runIf")) return NONE;
  if (view.python) return CONDITIONAL;
  return jsConstant(view.lines?.[block.line - 1]) ?? CONDITIONAL;
}

function viewOf(path: string, groups: readonly TestBlock[], text: string | undefined): FileView {
  const python = languageOf(path) === "py";
  const lines = text === undefined ? null : text.split(/\r\n|\r|\n/);
  const sorted = [...groups].sort((a, b) => a.line - b.line || b.endLine - a.endLine);
  const parent = new Int32Array(sorted.length).fill(-1);
  const groupState: SkipState[] = [];
  const open: number[] = [];
  sorted.forEach((group, index) => {
    while (open.length > 0 && !contains(sorted[open[open.length - 1] as number] as TestBlock, group)) open.pop();
    const up = open.length > 0 ? (open[open.length - 1] as number) : -1;
    parent[index] = up;
    groupState[index] = stronger(ownState(group, { python, lines }), up === -1 ? NONE : (groupState[up] as SkipState));
    open.push(index);
  });
  return { python, lines, groups: sorted, parent, groupState };
}

/** The index of the innermost group of the view whose line range holds `block`, or -1. */
function innermost(view: FileView, block: TestBlock): number {
  let lo = 0;
  let hi = view.groups.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((view.groups[mid] as TestBlock).line <= block.line) lo = mid + 1;
    else hi = mid;
  }
  let at = lo - 1;
  while (at !== -1 && !contains(view.groups[at] as TestBlock, block)) at = view.parent[at] as number;
  return at;
}

/** A test's effective skip state: its own, or that of the innermost group holding it when that is stronger. */
function effective(view: FileView, block: TestBlock): SkipState {
  const at = innermost(view, block);
  return stronger(ownState(block, view), at === -1 ? NONE : (view.groupState[at] as SkipState));
}

/** The text of each file one side of the test sources holds, by path; empty when the side is unavailable. */
function textsOf(side: TestSourceSide): ReadonlyMap<string, string> {
  const texts = new Map<string, string>();
  if ("files" in side) for (const file of side.files) texts.set(file.path, file.text);
  return texts;
}

/** The first index of a sorted list whose value is at least `value`. */
function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const indentOf = (text: string) => text.length - text.trimStart().length;

/** Whether a Python skip line read as a decorator or a mark has the conditionality asked for; a call always has. */
const fits = (parsed: PythonSkipLine, target: SkipState) =>
  parsed.kind === "call" || (target === UNCONDITIONAL ? !parsed.conditional : parsed.conditional);

export interface Ti03PairInput {
  /** The judged pairs, as TI05 reads them: the match's pairs (with TI01's moved-file pairs), moves and replacements. */
  match: Pick<TestMatch, "pairs" | "moved" | "replaced">;
  /** The touched test files, whose describe blocks each side keeps. */
  touched: Pick<TouchedTests, "pairs" | "added">;
  /** The describe blocks of each deleted test file TI01 indexed, by path: the base side of its moved-file pairs. */
  movedGroups?: ReadonlyMap<string, readonly TestBlock[]>;
  diff: readonly DiffFile[];
  sources: TestSources;
}

/**
 * TI03's pair pass. For every judged pair, a head test that is unconditionally skipped while its base test was not is
 * an `existing` finding, and a head test that is conditionally skipped while its base test had no skip at all is a
 * `conditional` one. A test's skip is its own modifiers together with those of every describe block of the same file
 * whose line range holds it (a Python module-level `pytestmark` is already on every block, a class one on the class).
 *
 * A finding is placed at its skip site, so one skip covering many tests is one finding: the lowest added line of the
 * head file that brings the skip in (the opening line of the block that carries it, an added skip decorator above a
 * Python block, an added in-body skip call of a Python test, an added `pytestmark` line in a Python class), trying the
 * test and then each group around it, innermost first; then an added column-0 `pytestmark` line of a Python file; else
 * the head test's own line. Each carrier's site and each file's module mark are worked out once.
 */
export function detectTI03Pairs(input: Ti03PairInput): Ti03Finding[] {
  const groups = { base: new Map<string, readonly TestBlock[]>(), head: new Map<string, readonly TestBlock[]>() };
  for (const file of input.touched.pairs) {
    groups.base.set(file.basePath, file.baseGroups ?? []);
    groups.head.set(file.headPath, file.headGroups ?? []);
  }
  for (const file of input.touched.added) groups.head.set(file.headPath, file.headGroups ?? []);
  for (const [path, list] of input.movedGroups ?? []) if (!groups.base.has(path)) groups.base.set(path, list);
  const texts = { base: textsOf(input.sources.base), head: textsOf(input.sources.head) };
  const added = new Map<string, readonly number[]>();
  for (const file of input.diff) if (file.status !== "deleted") added.set(file.path, file.addedLines);

  const views = { base: new Map<string, FileView>(), head: new Map<string, FileView>() };
  const view = (side: "base" | "head", path: string): FileView => {
    let found = views[side].get(path);
    if (found === undefined) {
      found = viewOf(path, groups[side].get(path) ?? [], texts[side].get(path));
      views[side].set(path, found);
    }
    return found;
  };
  const aliasMaps = new Map<string, ReadonlyMap<string, string> | undefined>();
  const aliasesOf = (path: string) => {
    if (!aliasMaps.has(path)) {
      const text = texts.head.get(path);
      aliasMaps.set(path, text === undefined ? undefined : pythonImportAliases(text));
    }
    return aliasMaps.get(path);
  };
  /** A Python line as the line reader reads it: the literal spelling first, then through the head file's aliases. */
  const readPython = (path: string, text: string): PythonSkipLine | null => {
    const literal = parsePythonSkip(text);
    if (literal !== null) return literal;
    const aliases = aliasesOf(path);
    return aliases === undefined ? null : parsePythonSkip(text, aliases);
  };

  const carrierSite = (headView: FileView, path: string, carrier: TestBlock, target: SkipState): number | null => {
    const lines = added.get(path) ?? [];
    const isAdded = (line: number) => {
      const at = lowerBound(lines, line);
      return at < lines.length && lines[at] === line;
    };
    let best: number | null = isAdded(carrier.line) ? carrier.line : null;
    const text = headView.lines;
    if (!headView.python || text === null) return best;
    const take = (line: number) => {
      if (best === null || line < best) best = line;
    };
    // The decorators directly above the block: blank and comment lines and deeper continuation lines are passed over.
    const indent = indentOf(text[carrier.line - 1] ?? "");
    for (let k = carrier.line - 1; k >= 1; k--) {
      const line = text[k - 1] ?? "";
      const trimmed = line.trimStart();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const own = indentOf(line);
      if (own > indent) continue;
      if (own < indent || !trimmed.startsWith("@")) break;
      if (!isAdded(k)) continue;
      const parsed = readPython(path, line);
      if (parsed !== null && parsed.kind === "decorator" && fits(parsed, target)) take(k);
    }
    // The added lines inside the block: a skip call in a test or hook, a `pytestmark` line in a class.
    for (
      let i = lowerBound(lines, carrier.line + 1);
      i < lines.length && (lines[i] as number) <= carrier.endLine;
      i++
    ) {
      const k = lines[i] as number;
      const parsed = readPython(path, text[k - 1] ?? "");
      if (parsed === null) continue;
      if (carrier.kind === "describe" ? parsed.kind === "mark" && fits(parsed, target) : parsed.kind === "call")
        take(k);
    }
    return best;
  };
  const carrierSites = new Map<TestBlock, number | null>();
  const moduleMarks = new Map<string, number | null>();
  const moduleMark = (headView: FileView, path: string, target: SkipState): number | null => {
    const key = `${target}:${path}`;
    const known = moduleMarks.get(key);
    if (known !== undefined) return known;
    let found: number | null = null;
    for (const k of headView.lines === null ? [] : (added.get(path) ?? [])) {
      const line = (headView.lines as readonly string[])[k - 1] ?? "";
      if (!line.startsWith("pytestmark")) continue;
      const parsed = readPython(path, line);
      if (parsed !== null && parsed.kind === "mark" && fits(parsed, target)) {
        found = k;
        break;
      }
    }
    moduleMarks.set(key, found);
    return found;
  };
  const siteOf = (headView: FileView, path: string, test: TestBlock, target: SkipState): number => {
    const chain: TestBlock[] = [test];
    for (let at = innermost(headView, test); at !== -1; at = headView.parent[at] as number) {
      chain.push(headView.groups[at] as TestBlock);
    }
    for (const carrier of chain) {
      if (ownState(carrier, headView) !== target) continue;
      let line = carrierSites.get(carrier);
      if (line === undefined) {
        line = carrierSite(headView, path, carrier, target);
        carrierSites.set(carrier, line);
      }
      if (line !== null) return line;
    }
    const mark = headView.python ? moduleMark(headView, path, target) : null;
    return mark ?? test.line;
  };

  const findings: Ti03Finding[] = [];
  for (const pair of [...input.match.pairs, ...input.match.moved, ...input.match.replaced]) {
    const headView = view("head", pair.headPath);
    const now = effective(headView, pair.head);
    if (now === NONE) continue;
    const was = effective(view("base", pair.basePath), pair.base);
    let category: Ti03Category | null = null;
    if (now === UNCONDITIONAL && was !== UNCONDITIONAL) category = "existing";
    else if (now === CONDITIONAL && was === NONE) category = "conditional";
    if (category === null) continue;
    findings.push({ path: pair.headPath, line: siteOf(headView, pair.headPath, pair.head, now), category });
  }
  return findings;
}
