import { BINARY_CHANGES_DETAIL } from "../binaryDetails.js";
import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { deletedTestFiles, isTestFile } from "../testFiles.js";
import type { TestSourceSide, TestSources } from "../testSources.js";
import { byCodeUnit } from "../text.js";
import { type PackageScripts, readPackageScripts } from "./packageScripts.js";
import { isPackageJsonFile } from "./signalFiles.js";

/** The most TI10 signals one file gives; the rest are dropped, keeping the lowest line numbers. */
const MAX_PER_FILE = 20;

/** The ways the value of a test script can be weakened, plus the removal of a script that runs with the tests. */
type Kind =
  | "or-true"
  | "echo"
  | "exit-0"
  | "pass-with-no-tests"
  | "path-filter"
  | "name-filter"
  | "status-lost"
  | "ignore-filter"
  | "hook-removed";

/** One fixed sentence per kind. No script key, value or flag from the diff reaches a detail. */
const DETAILS: Readonly<Record<Kind, string>> = {
  "or-true": "A test script now ignores the exit status of a command, so it passes even when the tests fail.",
  echo: "A test script now prints a message in place of running the tests, or after a failing run, so it can pass without the tests passing.",
  "exit-0": "A test script now forces a successful exit status, so it passes whatever the tests do.",
  "pass-with-no-tests": "A test script now lets a run that finds no tests pass.",
  "path-filter":
    "A test script now limits the run to the test files matching a path pattern, so the other test files do not run.",
  "name-filter":
    "A test script now limits the run to the tests whose names match a pattern, so the other tests do not run.",
  "status-lost":
    "A test script now pipes a command's output or runs a command in the background, so its exit status is no longer the test run's.",
  "ignore-filter": "A test script now makes the run skip the test files matching a pattern, so those tests do not run.",
  "hook-removed": "A script that ran before or after the tests was removed, so its checks no longer run with them.",
};

export interface TI10Options {
  /** Repo-relative tracked paths (`git ls-files`); empty means unknown. */
  repoFiles: readonly string[];
  mode: "block" | "warn";
  /**
   * The test sources. When both the base and the head text of a modified or renamed `package.json` are in them and parse
   * as JSON, the `scripts` objects are compared instead of the diff lines.
   */
  sources?: TestSources;
}

const isBlank = (c: string | undefined) => c === " " || c === "\t";

/** Reads a JSON string that starts at `start` (a double quote). Honours `\"` and `\\`. Null when it does not close. */
function readString(text: string, start: number): { value: string; end: number } | null {
  let value = "";
  let i = start + 1;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"') return { value, end: i + 1 };
    if (c === "\\") {
      const next = text.charAt(i + 1);
      if (next === "") return null;
      value += next === '"' || next === "\\" || next === "/" ? next : c + next;
      i += 2;
    } else {
      value += c;
      i += 1;
    }
  }
  return null;
}

/**
 * One `"key": "value"` pair on a line, any indentation, optional spaces around the colon, an optional trailing comma
 * and nothing else. Any other shape (a one-line object, a value continued on the next line) is not a script line.
 */
export function parseScriptLine(text: string): { key: string; value: string } | null {
  let i = 0;
  const skip = () => {
    while (isBlank(text[i])) i++;
  };
  skip();
  if (text[i] !== '"') return null;
  const key = readString(text, i);
  if (key === null) return null;
  i = key.end;
  skip();
  if (text[i] !== ":") return null;
  i++;
  skip();
  if (text[i] !== '"') return null;
  const value = readString(text, i);
  if (value === null) return null;
  i = value.end;
  skip();
  if (text[i] === ",") i++;
  skip();
  return i === text.length ? { key: key.value, value: value.value } : null;
}

/** The flags that make a run skip the test files matching a pattern, as written before any `=`. */
const IGNORE_FLAGS: ReadonlySet<string> = new Set(["--exclude", "--testPathIgnorePatterns"]);

/** Test runners by program name, for a single `&`: backgrounding one of these loses the run's status. */
const TEST_RUNNERS: ReadonlySet<string> = new Set([
  "vitest",
  "jest",
  "mocha",
  "ava",
  "tap",
  "uvu",
  "jasmine",
  "karma",
  "playwright",
  "cypress",
  "pytest",
]);

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);

/**
 * Whether the words of a command run tests: a word that names a runner above (by its last path segment, so
 * `./node_modules/.bin/vitest` counts), `node --test`, or a package manager running a script named `test` or
 * `test:<name>` (`npm test`, `pnpm run test:unit`).
 */
function runsTests(words: readonly string[]): boolean {
  const first = words[0] ?? "";
  return words.some(
    (word) =>
      TEST_RUNNERS.has(word.slice(word.lastIndexOf("/") + 1)) ||
      (first === "node" && word === "--test") ||
      (PACKAGE_MANAGERS.has(first) && /^test(?::\S+)?$/.test(word)),
  );
}

/** Whether a script runs mocha, where `-t` is `--timeout`, not a name filter. */
const RUNS_MOCHA = /(?:^|[\s/])mocha(?:\s|$)/;

/** Whether a script value runs mocha (TI08 reads it too: there `-u` is `--ui`, not a snapshot flag). */
export function runsMocha(value: string): boolean {
  return RUNS_MOCHA.test(value);
}

/**
 * The weakening kinds in the value of a test script. The value is read left to right: white space, `(` and `)` end a
 * word, and the shell operators `;`, `|`, `||`, `&` and `&&` end a command. A line feed (a decoded `\n` of a JSON
 * string) ends a command like `;` when the command has a word, and is a line break read as white space when it has none
 * (after `&&`, `|`, `;` or at the start). A command position is the start of the value, the text after `||` or `;`, and
 * the text after a line feed (not after `&&`, which keeps the runner's status). A single `|` loses the runner's status,
 * because npm scripts run without `pipefail`. A single `|` is `status-lost`. A single `&` is `status-lost` when the
 * command before it runs tests (`vitest run & wait`) or when it ends the script (`vitest run &`); a server started in
 * the background before the run (`start-server & vitest run`) keeps the run's status and gives nothing. An `&` right
 * after `>` or `<` (`2>&1`, `>&2`) is a redirection; an `&` before `>` (`&>log`) is a single `&`, which `sh` reads as a
 * background run. An `echo`
 * counts only when the script's exit status can be its own: it is not followed by `&&`, `|`, `&` or `;` (so
 * `echo start && vitest run` is a banner, not a weakening). `true` or `:` after `||` or `;` ignores the status before
 * it; at the start, with nothing after it or only `||`, it is the whole status (`"test": "true"`), read as `exit 0`.
 * `-t` is a name filter except in a script that runs mocha. `--exclude` and `--testPathIgnorePatterns` (alone or with
 * `=`) are `ignore-filter`. The scan is one pass, linear in the value.
 */
function scanKinds(value: string): Set<Kind> {
  const found = new Set<Kind>();
  const mocha = RUNS_MOCHA.test(value);
  let operator = "";
  let words: string[] = [];
  let word = "";

  const endWord = () => {
    if (word !== "") words.push(word);
    word = "";
  };
  const endCommand = (next: string) => {
    endWord();
    const atCommandPosition = operator === "" || operator === "||" || operator === ";";
    if (atCommandPosition && words[0] === "echo" && (next === "" || next === "||")) found.add("echo");
    if (atCommandPosition && words[0] === "exit" && words[1] === "0") found.add("exit-0");
    // A lone `true` or `:` as the whole script, or before `||`, is the script's status: nothing runs the tests.
    const noop = words.length === 1 && (words[0] === "true" || words[0] === ":");
    if (operator === "" && noop && (next === "" || next === "||")) found.add("exit-0");
    if ((operator === "||" || operator === ";") && words.length === 1 && (words[0] === "true" || words[0] === ":")) {
      found.add("or-true");
    }
    for (const token of words) {
      if (token === "--passWithNoTests" || token.startsWith("--passWithNoTests=")) found.add("pass-with-no-tests");
      if (token.startsWith("--testPathPattern")) found.add("path-filter");
      if ((token === "-t" && !mocha) || token.startsWith("--testNamePattern")) found.add("name-filter");
      if (IGNORE_FLAGS.has(token.split("=", 1)[0] as string)) found.add("ignore-filter");
    }
    // A single `&` after the test run backgrounds it: the script's status is then the next command's, not the run's.
    // A server or other helper started in the background before the run keeps the run's status.
    if (next === "&" && runsTests(words)) found.add("status-lost");
    words = [];
  };

  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    const redirection = c === "&" && (value.charAt(i - 1) === ">" || value.charAt(i - 1) === "<");
    if (c === ";" || c === "|" || (c === "&" && !redirection)) {
      let op = c;
      if ((c === "|" || c === "&") && value.charAt(i + 1) === c) {
        op = c + c;
        i++;
      } else if (c === "|") {
        found.add("status-lost");
      }
      endCommand(op);
      operator = op;
    } else if (c === "\n") {
      // A line feed ends a command that has a word, like `;`; after an operator or at the start it is a line break.
      if (word !== "" || words.length > 0) {
        endCommand(";");
        operator = ";";
      }
    } else if (isBlank(c) || c === "(" || c === ")") {
      endWord();
    } else {
      word += c;
    }
  }
  // A script that ends with a single `&` backgrounds its last command and exits 0 at once, whatever that command is.
  if (operator === "&" && word === "" && words.length === 0) found.add("status-lost");
  endCommand("");
  return found;
}

/**
 * TI10, a test script in `package.json` weakened. In a modified or renamed `package.json` (root or nested), a test
 * script is one whose key starts with `test`. A test script gives one signal per weakening kind in its value, at its
 * line in the new file, unless the same key already had that kind at base: `||` before `true`, `echo` or `exit 0` as a
 * command (at the start, after `||`, after `;` or after a line feed), `--passWithNoTests`, `--testPathPattern`, `-t` or
 * `--testNamePattern`, a single `|`, a single `&` after the test run or at the end (the exit status is no longer the
 * runner's), and `--exclude` or
 * `--testPathIgnorePatterns`. A `pretest` or `posttest` script removed is a signal at its old line.
 *
 * When `options.sources` holds both the base text and the head text of the file and both parse as JSON, the `scripts`
 * objects are compared, so the layout of the file does not matter. Otherwise (no sources, a side unavailable, a text
 * dropped, or not JSON) the added and removed diff lines are read, where a script line is one `"key": "value"` pair
 * and the diff needs its kept hunks. `--passWithNoTests` gives nothing when the tracked files hold no test file and the
 * diff deletes none. The severity is the mode; at most 20 per file, on the lowest line numbers. No script key or value
 * reaches a signal: every detail is one fixed sentence.
 *
 * A `package.json` that git shows as binary (a `-diff` or `binary` attribute, or non-text content; CORE-50) has no diff
 * line to read. It is judged from the sources when both texts read as JSON, exactly as a text diff is; otherwise it is
 * one signal at the mode's severity, with line null and a fixed sentence. Equal `scripts` objects give nothing.
 */
export function detectTI10(diff: readonly DiffFile[], options: TI10Options): TestIntegritySignal[] {
  const noTestFiles =
    options.repoFiles.length > 0 &&
    !options.repoFiles.some((path) => isTestFile(path)) &&
    deletedTestFiles(diff).length === 0;

  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (!isPackageJsonFile(file.path)) continue;
    if (file.status !== "modified" && file.status !== "renamed") continue;

    const found: Array<{ line: number | null; kind: Kind }> = [];
    const scripts = options.sources === undefined ? null : scriptsOf(options.sources, file);
    if (scripts !== null) {
      found.push(...scriptsObjectFindings(scripts.base, scripts.head, noTestFiles));
    } else if (file.binary === true) {
      // Git shows the file as binary, so the diff has no line to read: one fixed finding (CORE-50).
      signals.push({ id: "TI10", severity: options.mode, path: file.path, line: null, detail: BINARY_CHANGES_DETAIL });
      continue;
    } else if (file.hunks !== undefined) {
      found.push(...diffLineFindings(file.hunks, noTestFiles));
    } else {
      continue;
    }

    found.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(DETAILS[a.kind], DETAILS[b.kind]));
    for (const { line, kind } of found.slice(0, MAX_PER_FILE)) {
      signals.push({ id: "TI10", severity: options.mode, path: file.path, line, detail: DETAILS[kind] });
    }
  }
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}

const textOf = (side: TestSourceSide, path: string): string | null =>
  "unavailable" in side ? null : (side.files.find((entry) => entry.path === path)?.text ?? null);

/** The `scripts` of the base and the head text of a diff entry, or null when either is not in the sources or not JSON. */
function scriptsOf(sources: TestSources, file: DiffFile): { base: PackageScripts; head: PackageScripts } | null {
  const baseText = textOf(sources.base, file.oldPath);
  const headText = textOf(sources.head, file.path);
  if (baseText === null || headText === null) return null;
  const base = readPackageScripts(baseText);
  const head = readPackageScripts(headText);
  return base === null || head === null ? null : { base, head };
}

/** The signals of two `scripts` objects: the kinds a head test script has beyond its base value, and a removed hook. */
function scriptsObjectFindings(
  base: PackageScripts,
  head: PackageScripts,
  noTestFiles: boolean,
): Array<{ line: number | null; kind: Kind }> {
  const found = new Map<string, { line: number | null; kind: Kind }>();
  const add = (line: number | null, kind: Kind) => found.set(`${line}\0${kind}`, { line, kind });
  for (const [key, value] of head.values) {
    if (!key.startsWith("test")) continue;
    const baseValue = base.values.get(key);
    const before = baseValue === undefined ? new Set<Kind>() : scanKinds(baseValue);
    for (const kind of scanKinds(value)) {
      if (before.has(kind)) continue;
      if (kind === "pass-with-no-tests" && noTestFiles) continue;
      add(head.lines.get(key) ?? null, kind);
    }
  }
  for (const key of ["pretest", "posttest"]) {
    if (base.values.has(key) && !head.lines.has(key)) add(base.lines.get(key) ?? null, "hook-removed");
  }
  return [...found.values()];
}

/** The signals of the added and removed lines of a diff entry: the script lines that are one `"key": "value"` pair. */
function diffLineFindings(
  hunks: NonNullable<DiffFile["hunks"]>,
  noTestFiles: boolean,
): Array<{ line: number | null; kind: Kind }> {
  const removedKinds = new Map<string, Set<Kind>>();
  const removedHooks: Array<{ key: string; line: number }> = [];
  const addedKeys = new Set<string>();
  const found: Array<{ line: number; kind: Kind }> = [];

  for (const hunk of hunks) {
    for (const entry of hunk.removed) {
      const script = parseScriptLine(entry.text);
      if (script === null) continue;
      if (script.key.startsWith("test")) {
        const kinds = removedKinds.get(script.key) ?? new Set<Kind>();
        for (const kind of scanKinds(script.value)) kinds.add(kind);
        removedKinds.set(script.key, kinds);
      } else if (script.key === "pretest" || script.key === "posttest") {
        removedHooks.push({ key: script.key, line: entry.line });
      }
    }
  }
  for (const hunk of hunks) {
    for (const entry of hunk.added) {
      const script = parseScriptLine(entry.text);
      if (script === null) continue;
      addedKeys.add(script.key);
      if (!script.key.startsWith("test")) continue;
      const before = removedKinds.get(script.key);
      for (const kind of scanKinds(script.value)) {
        if (before?.has(kind)) continue;
        if (kind === "pass-with-no-tests" && noTestFiles) continue;
        found.push({ line: entry.line, kind });
      }
    }
  }
  for (const hook of removedHooks) {
    if (!addedKeys.has(hook.key)) found.push({ line: hook.line, kind: "hook-removed" });
  }
  return found;
}
