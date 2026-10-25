import { type ConfigValue, printValue } from "./value.js";

/** One deselection option of a pytest command line: the flag as one canonical spelling and its value, or null. */
export interface AddoptsPair {
  flag: string;
  value: string | null;
}

/** The short flags that take a value (`-ra` is `-r a`). A flag that takes a value ends a cluster. */
const VALUE_TAKING_SHORT: ReadonlySet<string> = new Set(["k", "m", "p", "r", "c", "o", "W", "n"]);
/** The long options that deselect tests by a value. */
const LONG_WITH_VALUE: ReadonlySet<string> = new Set(["--deselect", "--ignore", "--ignore-glob", "--maxfail"]);
/** The long options that narrow the run without a value, as the canonical spelling each one is counted under. */
const LONG_FLAGS: ReadonlyMap<string, string> = new Map([
  ["--co", "--co"],
  ["--collect-only", "--co"],
  ["--exitfirst", "-x"],
  ["--lf", "--lf"],
  ["--last-failed", "--lf"],
  ["--sw", "--sw"],
  ["--stepwise", "--sw"],
]);

/** Splits a command line like a shell: whitespace separates, quotes group, a backslash escapes outside single quotes. */
function shellSplit(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (ch === "\\") {
      i++;
      if (i < text.length) current += text[i] as string;
      inToken = true;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = "";
      inToken = false;
    } else {
      current += ch;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

/** The command line tokens of an `addopts` value: an array is the token list itself, a string is split like a shell. */
export function splitAddopts(value: ConfigValue): string[] {
  if (value.type === "array") {
    return value.items
      .filter((item) => item.type !== "opaque")
      .map((item) => (item.type === "string" ? item.value : printValue(item)));
  }
  return value.type === "string" ? shellSplit(value.value) : [];
}

/**
 * The deselection options of a token list: `-k`, `-m`, `--deselect`, `--ignore`, `--ignore-glob`, `-p no:<x>` with
 * `<x>` other than `cacheprovider`, `--co`/`--collect-only`, `-x`/`--exitfirst`, `--maxfail`, `--lf`/`--last-failed` and
 * `--sw`/`--stepwise`. Joined (`-knot`), spaced (`-k x`) and `=` (`--maxfail=1`) forms are read; a short cluster such as
 * `-xvs` is read flag by flag until a flag that takes a value. `--maxfail 0` does not stop the run. Nothing after `--`.
 */
export function deselectionPairs(tokens: readonly string[]): AddoptsPair[] {
  const pairs: AddoptsPair[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === "--") break;
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      const name = equals === -1 ? token : token.slice(0, equals);
      if (LONG_WITH_VALUE.has(name)) {
        const value = equals === -1 ? (tokens[++i] ?? "") : token.slice(equals + 1);
        if (name === "--maxfail" && /^0*$/.test(value)) continue;
        pairs.push({ flag: name, value });
      } else {
        const flag = LONG_FLAGS.get(name);
        if (flag !== undefined) pairs.push({ flag, value: null });
      }
    } else if (token.length > 1 && token.startsWith("-")) {
      const cluster = token.slice(1);
      for (let j = 0; j < cluster.length; j++) {
        const letter = cluster[j] as string;
        if (VALUE_TAKING_SHORT.has(letter)) {
          const rest = cluster.slice(j + 1);
          const value = rest === "" ? (tokens[++i] ?? "") : rest;
          if (letter === "k" || letter === "m") pairs.push({ flag: `-${letter}`, value });
          else if (letter === "p" && value.startsWith("no:") && value !== "no:cacheprovider")
            pairs.push({ flag: "-p", value });
          break;
        }
        if (letter === "x") pairs.push({ flag: "-x", value: null });
      }
    }
  }
  return pairs;
}

const pairKey = (pair: AddoptsPair) => `${pair.flag}\0${pair.value ?? "\0"}`;

/** The pairs at head beyond their count at base, as a multiset of flag and value; each is one gained pair. */
export function gainedPairs(base: readonly AddoptsPair[], head: readonly AddoptsPair[]): AddoptsPair[] {
  const available = new Map<string, number>();
  for (const pair of base) available.set(pairKey(pair), (available.get(pairKey(pair)) ?? 0) + 1);
  const gained: AddoptsPair[] = [];
  for (const pair of head) {
    const left = available.get(pairKey(pair)) ?? 0;
    if (left > 0) available.set(pairKey(pair), left - 1);
    else gained.push(pair);
  }
  return gained;
}

/** A pair as the command line spelling: the flag, then the value, in double quotes when it holds whitespace or a quote. */
export function pairText(pair: AddoptsPair): string {
  const flag = pair.flag === "-x" ? "-x (--exitfirst)" : pair.flag;
  if (pair.value === null) return flag;
  const quoted =
    pair.value === "" || /[\s"']/.test(pair.value) ? `"${pair.value.replace(/(["\\])/g, "\\$1")}"` : pair.value;
  return `${flag} ${quoted}`;
}
