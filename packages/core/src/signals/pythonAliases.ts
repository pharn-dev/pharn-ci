/**
 * The names a Python test file binds with its own top-level `import` and `from … import` statements, so TI03 can read
 * `@pt.mark.skip` as `@pytest.mark.skip` when the file says `import pytest as pt`.
 *
 * Only a statement that starts at column 0 is read, one left-to-right pass over the lines, each character looked at a
 * bounded number of times and no regular expression over the text. An `import` or `from` that is indented (inside an
 * `if`, a `try`, a function or a class), one inside a triple-quoted string, an assignment such as `pt = pytest`,
 * `from m import *`, a backslash continuation and `conftest.py` are not read: `docs/LIMITS.md` lists them. A binding
 * the reader gets wrong can only add a match, never remove one, because TI03 always tries the literal spelling first
 * and only then the resolved one.
 */

/** A local name and the dotted name it is bound to. */
type Binding = readonly [local: string, target: string];

/** A parenthesized name list of a `from m import` statement that has not been closed yet. */
interface OpenGroup {
  module: string;
  pending: Binding[];
}

const isIdentStart = (code: number): boolean =>
  (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;

const isIdentChar = (code: number): boolean => isIdentStart(code) || (code >= 48 && code <= 57);

/** The index just after the identifier that starts at `start` (equal to `start` when there is none). */
function identEnd(text: string, start: number): number {
  if (start >= text.length || !isIdentStart(text.charCodeAt(start))) return start;
  let i = start + 1;
  while (i < text.length && isIdentChar(text.charCodeAt(i))) i++;
  return i;
}

const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";

function skipBlanks(text: string, start: number): number {
  let i = start;
  while (i < text.length && isBlank(text.charAt(i))) i++;
  return i;
}

/** The index of the delimiter that closes a triple-quoted string at or after `from`, or -1. */
function closeTriple(line: string, from: number, quote: string): number {
  for (let i = from; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === "\\") i++;
    else if (c === quote && line.charAt(i + 1) === quote && line.charAt(i + 2) === quote) return i;
  }
  return -1;
}

/**
 * Scans `line` from `from` as code, skipping single-line strings and stopping at a `#` comment. Returns the triple
 * delimiter (`"""` or `'''`) left open at the end of the line, or the empty string.
 */
function scanCode(line: string, from: number): string {
  for (let i = from; i < line.length; i++) {
    const c = line.charAt(i);
    if (c === "#") return "";
    if (c !== '"' && c !== "'") continue;
    if (line.charAt(i + 1) === c && line.charAt(i + 2) === c) {
      const end = closeTriple(line, i + 3, c);
      if (end < 0) return c + c + c;
      i = end + 2;
      continue;
    }
    let j = i + 1;
    while (j < line.length && line.charAt(j) !== c) j += line.charAt(j) === "\\" ? 2 : 1;
    i = j;
  }
  return "";
}

/** Whether a character code ends the part of a line a statement is read from: `;`, `#`, `"` or `'`. */
const isStatementEnd = (code: number): boolean => code === 59 || code === 35 || code === 34 || code === 39;

/** Whether a line opens an `import` or `from` statement at column 0. */
function startsStatement(line: string): boolean {
  if (line.startsWith("import") && isBlank(line.charAt(6))) return true;
  return line.startsWith("from") && isBlank(line.charAt(4));
}

/** `name` or `name as local`, both plain identifiers; null for anything else. */
function fromItem(piece: string): Binding | null {
  const nameEnd = identEnd(piece, 0);
  if (nameEnd === 0) return null;
  const name = piece.slice(0, nameEnd);
  if (nameEnd === piece.length) return [name, name];
  const asAt = skipBlanks(piece, nameEnd);
  if (asAt === nameEnd || !piece.startsWith("as", asAt)) return null;
  const localAt = skipBlanks(piece, asAt + 2);
  if (localAt === asAt + 2) return null;
  const localEnd = identEnd(piece, localAt);
  if (localEnd === localAt || localEnd !== piece.length) return null;
  return [name, piece.slice(localAt, localEnd)];
}

/** `a.b.c` or `a.b.c as local`, a dotted name of plain identifiers; null for anything else. */
function importItem(piece: string): Binding | null {
  let end = identEnd(piece, 0);
  if (end === 0) return null;
  const first = piece.slice(0, end);
  while (piece.charAt(end) === ".") {
    const next = identEnd(piece, end + 1);
    if (next === end + 1) return null;
    end = next;
  }
  const dotted = piece.slice(0, end);
  if (end === piece.length) return [first, first];
  const asAt = skipBlanks(piece, end);
  if (asAt === end || !piece.startsWith("as", asAt)) return null;
  const localAt = skipBlanks(piece, asAt + 2);
  if (localAt === asAt + 2) return null;
  const localEnd = identEnd(piece, localAt);
  if (localEnd === localAt || localEnd !== piece.length) return null;
  return [piece.slice(localAt, localEnd), dotted];
}

/** The items of a comma-separated list, each trimmed, empty ones left out. */
function pieces(segment: string): string[] {
  const out: string[] = [];
  for (const piece of segment.split(",")) {
    const trimmed = piece.trim();
    if (trimmed !== "") out.push(trimmed);
  }
  return out;
}

/** The dotted name a `from module import name` binding refers to; a relative module gives a name nothing matches. */
const fromTarget = (module: string, name: string): string => `${module}.${name}`;

/**
 * Maps each local name to the dotted name it is bound to by the module's column-0 `import` / `from` statements, in
 * source order, a later binding replacing an earlier one:
 *
 * - `import a` and `import a.b` bind `a` to `a`; `import a.b as c` binds `c` to `a.b`;
 * - `from m import x` binds `x` to `m.x`; `from m import x as y` binds `y` to `m.x`;
 * - comma lists and the parenthesized, also multi-line, name list of `from m import` are read;
 * - `from m import *` binds nothing; a relative `from .m import x` binds `x` to `.m.x`, which no name matches.
 *
 * Every binding is stored whatever the module is, so `import os as pt` replaces an earlier `pt` of pytest.
 */
export function pythonImportAliases(text: string): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>();
  const lines = text.split("\n");
  // The state carried between lines; a holder object, so the closures below and the loop agree on its type.
  const state: { triple: string; group: OpenGroup | null } = { triple: "", group: null };

  /** Reads the items of a group from `from` on `line`; closes the group at `)` and commits its bindings. */
  const readGroup = (line: string, from: number): void => {
    const open = state.group as OpenGroup;
    let stop = from;
    while (stop < line.length) {
      const code = line.charCodeAt(stop);
      if (code === 41 || isStatementEnd(code)) break;
      stop++;
    }
    for (const piece of pieces(line.slice(from, stop))) {
      const item = fromItem(piece);
      if (item !== null) open.pending.push([item[1], fromTarget(open.module, item[0])]);
    }
    const c = line.charAt(stop);
    if (c === ")") {
      for (const [local, target] of open.pending) aliases.set(local, target);
      state.group = null;
      state.triple = scanCode(line, stop + 1);
    } else if (c === "#" || stop >= line.length) {
      // the group stays open
    } else {
      state.group = null;
      state.triple = scanCode(line, stop);
    }
  };

  /** Reads an `import` or `from` statement that starts the line, then scans what follows it. */
  const readStatement = (line: string): void => {
    let end = 0;
    while (end < line.length && !isStatementEnd(line.charCodeAt(end))) end++;
    const body = end === line.length ? line : line.slice(0, end);
    if (body.startsWith("import")) {
      for (const piece of pieces(body.slice(6))) {
        const item = importItem(piece);
        if (item !== null) aliases.set(item[0], item[1]);
      }
    } else {
      const moduleAt = skipBlanks(body, 4);
      let moduleEnd = moduleAt;
      while (moduleEnd < body.length && (body.charAt(moduleEnd) === "." || isIdentChar(body.charCodeAt(moduleEnd)))) {
        moduleEnd++;
      }
      const module = body.slice(moduleAt, moduleEnd);
      const importAt = skipBlanks(body, moduleEnd);
      const listAt = importAt + 6;
      if (
        module !== "" &&
        importAt > moduleEnd &&
        body.startsWith("import", importAt) &&
        isBlank(body.charAt(listAt))
      ) {
        const rest = skipBlanks(body, listAt);
        if (body.charAt(rest) === "(") {
          state.group = { module, pending: [] };
          readGroup(line, rest + 1);
          return;
        }
        for (const piece of pieces(body.slice(rest))) {
          const item = fromItem(piece);
          if (item !== null) aliases.set(item[1], fromTarget(module, item[0]));
        }
      }
    }
    state.triple = line.charAt(end) === ";" ? scanCode(line, end + 1) : scanCode(line, end);
  };

  for (let n = 0; n < lines.length; n++) {
    let line = lines[n] as string;
    if (n === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (state.triple !== "") {
      const close = closeTriple(line, 0, state.triple.charAt(0));
      if (close < 0) continue;
      state.triple = scanCode(line, close + 3);
      continue;
    }
    if (state.group !== null) {
      if (!startsStatement(line)) {
        readGroup(line, 0);
        continue;
      }
      state.group = null;
    }
    if (startsStatement(line)) readStatement(line);
    else state.triple = scanCode(line, 0);
  }
  return aliases;
}

/**
 * Replaces the first dotted segment of `name` with the name it is bound to (`pt.mark.skip` becomes
 * `pytest.mark.skip` under `import pytest as pt`); null when that segment is not bound.
 */
export function resolvePythonName(name: string, aliases: ReadonlyMap<string, string>): string | null {
  const dot = name.indexOf(".");
  const head = dot < 0 ? name : name.slice(0, dot);
  const target = aliases.get(head);
  if (target === undefined) return null;
  return dot < 0 ? target : target + name.slice(dot);
}
