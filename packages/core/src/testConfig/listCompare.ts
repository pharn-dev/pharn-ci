import { compileGlob } from "../glob.js";
import { type ConfigValue, printValue } from "./value.js";

/**
 * How two entries of a list setting are compared: `glob` (the glob subset of `compileGlob`), `regex` (equality only),
 * or `testpaths` (a glob, or a directory that holds the other entry).
 */
export type ListMode = "glob" | "regex" | "testpaths";

/** At most this many alternatives come out of one entry's brace groups; past that the entry is its own alternative. */
export const MAX_BRACE_ALTERNATIVES = 64;

/** One entry of a list setting: a string, another literal (kept as its printed text), or a part that is not a literal. */
export type ListEntry = { opaque: false; isString: boolean; text: string } | { opaque: true; text: string };

/** The names of build output and dependency directories that a list may start to skip without loosening the run. */
export const BUILD_OR_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".nox",
  ".cache",
  ".next",
  ".nuxt",
  ".eggs",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".nyc_output",
  ".turbo",
  ".svelte-kit",
]);

const DECLARATION_FILES: ReadonlySet<string> = new Set(["*.d.ts", "**/*.d.ts", "\\.d\\.ts$", "\\.d\\.ts"]);

const PREFIXES = ["./", "^", "/", "**/"] as const;
const SUFFIXES = ["/**/*", "/**", "/*", "/", "$"] as const;

/**
 * Whether a list entry names build output, a dependency directory or declaration files, so adding it to an exclude list
 * skips nothing the project wrote. `<rootDir>`, then a leading `./`, `^`, `/` or `**` + `/`, and a trailing `$`, `/`,
 * `/**`, `/**` + `/*` or `/*` are stripped, repeatedly; what is left must be one of `BUILD_OR_DEPENDENCY_NAMES`.
 * `*.d.ts`, `**` + `/*.d.ts` and `\.d\.ts$` are exempt as written or stripped.
 */
export function isBuildOrDependencyEntry(entry: string): boolean {
  if (DECLARATION_FILES.has(entry)) return true;
  let text = entry;
  for (;;) {
    const before = text;
    if (text.startsWith("<rootDir>")) text = text.slice("<rootDir>".length);
    for (const prefix of PREFIXES) if (text.startsWith(prefix)) text = text.slice(prefix.length);
    for (const suffix of SUFFIXES) if (text.endsWith(suffix)) text = text.slice(0, -suffix.length);
    if (text === before) break;
  }
  return BUILD_OR_DEPENDENCY_NAMES.has(text) || DECLARATION_FILES.has(text);
}

/** The entries of a list value: an array gives its items, a string one entry (or, split on whitespace, several). */
export function entriesOf(value: ConfigValue, splitWhitespace: boolean): ListEntry[] {
  const entry = (item: ConfigValue): ListEntry =>
    item.type === "opaque"
      ? { opaque: true, text: item.text }
      : {
          opaque: false,
          isString: item.type === "string",
          text: item.type === "string" ? item.value : printValue(item),
        };
  if (value.type === "array") return value.items.map(entry);
  if (value.type === "string" && splitWhitespace) {
    return value.value
      .split(/\s+/)
      .filter((part) => part !== "")
      .map((part) => ({ opaque: false, isString: true, text: part }));
  }
  return [entry(value)];
}

/** Single-level `{a,b}` brace expansion, at most 64 alternatives; past that, or without a group, the entry itself. */
export function expandBraces(entry: string): string[] {
  let alternatives = [""];
  let expanded = false;
  let i = 0;
  while (i < entry.length) {
    const ch = entry[i] as string;
    const close = ch === "{" ? entry.indexOf("}", i) : -1;
    const inner = close === -1 ? "" : entry.slice(i + 1, close);
    if (close !== -1 && inner.includes(",") && !inner.includes("{")) {
      const parts = inner.split(",");
      if (alternatives.length * parts.length > MAX_BRACE_ALTERNATIVES) return [entry];
      alternatives = alternatives.flatMap((prefix) => parts.map((part) => prefix + part));
      expanded = true;
      i = close + 1;
    } else {
      alternatives = alternatives.map((prefix) => prefix + ch);
      i++;
    }
  }
  return expanded ? alternatives : [entry];
}

function normalizePath(text: string): string {
  let out = text;
  while (out.startsWith("./")) out = out.slice(2);
  while (out.length > 1 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Whether the glob `wide` matches the text `narrow` as a path. A `**` in the text is only matched by a `**`. */
function globCovers(wide: string, narrow: string): boolean {
  if (wide === narrow) return true;
  if (narrow.includes("**") && !wide.includes("**")) return false;
  return compileGlob(wide)(narrow);
}

/** Whether every alternative of `narrow` is equal to, or matched by, an alternative of `wide`. */
function stringCovers(wide: string, narrow: string, mode: ListMode): boolean {
  if (mode === "regex") return wide === narrow;
  const wideAlternatives = expandBraces(normalizePath(wide));
  return expandBraces(normalizePath(narrow)).every((n) =>
    wideAlternatives.some((w) => globCovers(w, n) || (mode === "testpaths" && (w === "." || globCovers(`${w}/**`, n)))),
  );
}

/** Whether the static entry `wide` covers the static entry `narrow`. A literal that is not a string covers only itself. */
function covers(wide: ListEntry, narrow: ListEntry, mode: ListMode): boolean {
  if (wide.opaque || narrow.opaque) return false;
  if (!wide.isString || !narrow.isString) return wide.text === narrow.text;
  return stringCovers(wide.text, narrow.text, mode);
}

const opaqueTexts = (entries: readonly ListEntry[]) =>
  new Set(entries.filter((entry) => entry.opaque).map((entry) => entry.text));

/** Whether `head` has an opaque entry that `base` does not have. */
function gainsOpaque(base: readonly ListEntry[], head: readonly ListEntry[]): boolean {
  const known = opaqueTexts(base);
  return head.some((entry) => entry.opaque && !known.has(entry.text));
}

/**
 * Whether a list, set at both sides, covers less at head: `narrowed` when a static base entry is covered by no static
 * head entry, `cannot` when an opaque entry makes that undecidable (a base opaque entry missing at head, or an opaque
 * entry gained while an entry is uncovered), else null.
 */
export function narrowedList(
  base: readonly ListEntry[],
  head: readonly ListEntry[],
  mode: ListMode,
): "narrowed" | "cannot" | null {
  const headOpaque = opaqueTexts(head);
  if (base.some((entry) => entry.opaque && !headOpaque.has(entry.text))) return "cannot";
  const uncovered = base.some((entry) => !entry.opaque && !head.some((other) => covers(other, entry, mode)));
  if (!uncovered) return null;
  return gainsOpaque(base, head) ? "cannot" : "narrowed";
}

/**
 * Whether a list covers more at head: `widened` when a static head entry is covered by no static base entry and is not
 * a build or dependency entry, `cannot` when only an opaque entry is gained, else null. An unset base is an empty list.
 */
export function widenedList(
  base: readonly ListEntry[],
  head: readonly ListEntry[],
  mode: ListMode,
): "widened" | "cannot" | null {
  const gained = head.some(
    (entry) =>
      !entry.opaque &&
      !base.some((other) => covers(other, entry, mode)) &&
      !(entry.isString && isBuildOrDependencyEntry(entry.text)),
  );
  if (gained) return "widened";
  return gainsOpaque(base, head) ? "cannot" : null;
}
