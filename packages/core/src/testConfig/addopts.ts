import { type ConfigValue, printValue } from "./value.js";

/**
 * One option of a pytest command line that narrows the run: the flag as one canonical spelling and its value, or null.
 * `deselect` is a deselection option; `narrow` is `-o python_functions=<patterns>`, which changes which tests are collected.
 */
export interface AddoptsPair {
  flag: string;
  value: string | null;
  kind: "deselect" | "narrow";
}

/** The short flags that take a value (`-ra` is `-r a`). A flag that takes a value ends a cluster. */
const VALUE_TAKING_SHORT: ReadonlySet<string> = new Set(["k", "m", "p", "r", "c", "o", "W", "n"]);
/** The long options that deselect tests by a value. */
const LONG_WITH_VALUE: ReadonlySet<string> = new Set(["--deselect", "--ignore", "--ignore-glob", "--maxfail"]);
/**
 * The other long options that take a value, so that a spaced value (`--tb short`) is not read as a positional path. The
 * pytest core, then the common plugins. An option that pytest declares with an optional value (`--cov`, `--debug`,
 * `--cache-show`, `--benchmark-compare`, `--benchmark-histogram`) is here too: it consumes a following token that does not
 * start with `-`, as argparse does. An option missing from this list, written with a spaced value, reads its value as a path.
 */
const LONG_TAKING_VALUE: ReadonlySet<string> = new Set([
  // pytest core
  "--assert",
  "--basetemp",
  "--cache-show",
  "--capture",
  "--code-highlight",
  "--color",
  "--confcutdir",
  "--config-file",
  "--debug",
  "--deselect",
  "--doctest-glob",
  "--doctest-report",
  "--durations",
  "--durations-min",
  "--ignore",
  "--ignore-glob",
  "--import-mode",
  "--junit-prefix",
  "--junit-xml",
  "--junitxml",
  "--last-failed-no-failures",
  "--lfnf",
  "--log-auto-indent",
  "--log-cli-date-format",
  "--log-cli-format",
  "--log-cli-level",
  "--log-date-format",
  "--log-disable",
  "--log-file",
  "--log-file-date-format",
  "--log-file-format",
  "--log-file-level",
  "--log-file-mode",
  "--log-format",
  "--log-level",
  "--maxfail",
  "--override-ini",
  "--pastebin",
  "--pdbcls",
  "--pythonwarnings",
  "--rootdir",
  "--show-capture",
  "--tb",
  "--verbosity",
  // pytest-cov
  "--cov",
  "--cov-config",
  "--cov-context",
  "--cov-fail-under",
  "--cov-report",
  // pytest-xdist
  "--dist",
  "--max-worker-restart",
  "--maxprocesses",
  "--maxschedchunk",
  "--numprocesses",
  "--rsyncdir",
  "--rsyncignore",
  "--tx",
  // pytest-timeout
  "--session-timeout",
  "--timeout",
  "--timeout-method",
  "--timeout_method",
  // pytest-rerunfailures
  "--only-rerun",
  "--rerun-except",
  "--reruns",
  "--reruns-delay",
  // pytest-html
  "--css",
  "--html",
  // allure-pytest
  "--allure-epics",
  "--allure-features",
  "--allure-ids",
  "--allure-label",
  "--allure-link-pattern",
  "--allure-severities",
  "--allure-stories",
  "--alluredir",
  // pytest-json-report
  "--json-report-file",
  "--json-report-indent",
  "--json-report-omit",
  // hypothesis
  "--hypothesis-profile",
  "--hypothesis-seed",
  "--hypothesis-verbosity",
  // pytest-asyncio, pytest-django, pytest-randomly, pytest-random-order, pytest-repeat, pytest-split, pytest-reportlog
  "--asyncio-mode",
  "--dc",
  "--ds",
  "--liveserver",
  "--randomly-seed",
  "--random-order-bucket",
  "--random-order-seed",
  "--count",
  "--repeat-scope",
  "--durations-path",
  "--group",
  "--splits",
  "--splitting-algorithm",
  "--report-log",
  // pytest-benchmark
  "--benchmark-calibration-precision",
  "--benchmark-columns",
  "--benchmark-compare",
  "--benchmark-compare-fail",
  "--benchmark-cprofile",
  "--benchmark-group-by",
  "--benchmark-histogram",
  "--benchmark-json",
  "--benchmark-max-time",
  "--benchmark-min-rounds",
  "--benchmark-min-time",
  "--benchmark-name",
  "--benchmark-save",
  "--benchmark-sort",
  "--benchmark-storage",
  "--benchmark-timer",
  "--benchmark-warmup",
  "--benchmark-warmup-iterations",
  // pytest-playwright
  "--base-url",
  "--browser",
  "--browser-channel",
  "--device",
  "--output",
  "--screenshot",
  "--slowmo",
  "--tracing",
  "--video",
]);
/** The ini key whose `-o` override narrows the collected tests by name. */
const NARROWING_OVERRIDE = "python_functions=";
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

/** What one token walk of an `addopts` value reads: the options that narrow the run, and the positional paths. */
export interface AddoptsReading {
  pairs: AddoptsPair[];
  paths: string[];
}

/**
 * The narrowing options and the positional paths of a token list, in one walk.
 *
 * `pairs`: the deselection options `-k`, `-m`, `--deselect`, `--ignore`, `--ignore-glob`, `-p no:<x>` with `<x>` other
 * than `cacheprovider`, `--co`/`--collect-only`, `-x`/`--exitfirst`, `--maxfail`, `--lf`/`--last-failed` and
 * `--sw`/`--stepwise` (kind `deselect`), and `-o python_functions=<patterns>` (kind `narrow`; spaced `-o x`, joined
 * `-ox`, inside a short cluster, `--override-ini x` and `--override-ini=x`). Joined (`-knot`), spaced (`-k x`) and `=`
 * (`--maxfail=1`) forms are read; a short cluster such as `-xvs` is read flag by flag until a flag that takes a value.
 * `--maxfail 0` does not stop the run. Nothing after `--`.
 *
 * `paths`: a token that does not start with `-`, is not the value of an option that takes one, and comes before `--`.
 * A long option in `LONG_TAKING_VALUE` consumes a spaced value that does not start with `-`.
 */
export function readAddopts(tokens: readonly string[]): AddoptsReading {
  const pairs: AddoptsPair[] = [];
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (token === "--") break;
    if (token.startsWith("--")) {
      const equals = token.indexOf("=");
      const name = equals === -1 ? token : token.slice(0, equals);
      if (name === "--override-ini") {
        const value = equals === -1 ? (tokens[++i] ?? "") : token.slice(equals + 1);
        if (value.startsWith(NARROWING_OVERRIDE)) pairs.push({ flag: "-o", value, kind: "narrow" });
      } else if (LONG_WITH_VALUE.has(name)) {
        const value = equals === -1 ? (tokens[++i] ?? "") : token.slice(equals + 1);
        if (name === "--maxfail" && /^0*$/.test(value)) continue;
        pairs.push({ flag: name, value, kind: "deselect" });
      } else {
        const flag = LONG_FLAGS.get(name);
        if (flag !== undefined) pairs.push({ flag, value: null, kind: "deselect" });
        else if (equals === -1 && LONG_TAKING_VALUE.has(name) && !(tokens[i + 1] ?? "-").startsWith("-")) i++;
      }
    } else if (token.length > 1 && token.startsWith("-")) {
      const cluster = token.slice(1);
      for (let j = 0; j < cluster.length; j++) {
        const letter = cluster[j] as string;
        if (VALUE_TAKING_SHORT.has(letter)) {
          const rest = cluster.slice(j + 1);
          const value = rest === "" ? (tokens[++i] ?? "") : rest;
          if (letter === "k" || letter === "m") pairs.push({ flag: `-${letter}`, value, kind: "deselect" });
          else if (letter === "p" && value.startsWith("no:") && value !== "no:cacheprovider")
            pairs.push({ flag: "-p", value, kind: "deselect" });
          else if (letter === "o" && value.startsWith(NARROWING_OVERRIDE))
            pairs.push({ flag: "-o", value, kind: "narrow" });
          break;
        }
        if (letter === "x") pairs.push({ flag: "-x", value: null, kind: "deselect" });
      }
    } else if (token !== "-") {
      paths.push(token);
    }
  }
  return { pairs, paths };
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

/** A value as the command line spelling: in double quotes when it is empty or holds whitespace or a quote. */
const quotedValue = (value: string): string =>
  value === "" || /[\s"']/.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;

/** A pair as the command line spelling: the flag, then the value, in double quotes when it holds whitespace or a quote. */
export function pairText(pair: AddoptsPair): string {
  const flag = pair.flag === "-x" ? "-x (--exitfirst)" : pair.flag;
  return pair.value === null ? flag : `${flag} ${quotedValue(pair.value)}`;
}

/** The positional paths of an `addopts` value, space-separated and quoted like a pair's value; `(none)` for no path. */
export function pathsText(paths: readonly string[]): string {
  return paths.length === 0 ? "(none)" : paths.map(quotedValue).join(" ");
}
