import type { DiffFile } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { deletedTestFiles, isTestFile } from "../testFiles.js";
import { isPackageJsonFile } from "./signalFiles.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The most TI10 signals one file gives; the rest are dropped, keeping the lowest line numbers. */
const MAX_PER_FILE = 20;

/** The ways the value of a test script can be weakened, plus the removal of a script that runs with the tests. */
type Kind = "or-true" | "echo" | "exit-0" | "pass-with-no-tests" | "path-filter" | "name-filter" | "hook-removed";

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
  "hook-removed": "A script that ran before or after the tests was removed, so its checks no longer run with them.",
};

export interface TI10Options {
  /** Repo-relative tracked paths (`git ls-files`); empty means unknown. */
  repoFiles: readonly string[];
  mode: "block" | "warn";
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
function parseScriptLine(text: string): { key: string; value: string } | null {
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

/** Whether a script runs mocha, where `-t` is `--timeout`, not a name filter. */
const RUNS_MOCHA = /(?:^|[\s/])mocha(?:\s|$)/;

/**
 * The weakening kinds in the value of a test script. The value is read left to right: white space ends a word, and the
 * shell operators `;`, `|`, `||`, `&` and `&&` end a command. A command position is the start of the value or the text
 * after `||` or `;` (not after `&&` or a single `|`, because the script still fails when the runner fails). An `echo`
 * counts only when the script's exit status can be its own: it is not followed by `&&`, `|`, `&` or `;` (so
 * `echo start && vitest run` is a banner, not a weakening). `true` or `:` after `||` or `;` ignores the status before
 * it. `-t` is a name filter except in a script that runs mocha.
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
    if ((operator === "||" || operator === ";") && words.length === 1 && (words[0] === "true" || words[0] === ":")) {
      found.add("or-true");
    }
    for (const token of words) {
      if (token === "--passWithNoTests" || token.startsWith("--passWithNoTests=")) found.add("pass-with-no-tests");
      if (token.startsWith("--testPathPattern")) found.add("path-filter");
      if ((token === "-t" && !mocha) || token.startsWith("--testNamePattern")) found.add("name-filter");
    }
    words = [];
  };

  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    if (c === ";" || c === "|" || c === "&") {
      let op = c;
      if ((c === "|" || c === "&") && value.charAt(i + 1) === c) {
        op = c + c;
        i++;
      }
      endCommand(op);
      operator = op;
    } else if (isBlank(c)) {
      endWord();
    } else {
      word += c;
    }
  }
  endCommand("");
  return found;
}

/**
 * TI10, a test script in `package.json` weakened. In a modified or renamed `package.json` (root or nested), a script
 * line is one `"key": "value"` pair; a test script is one whose key starts with `test`. An added test script line gives
 * one signal per weakening kind in its value, at its line in the new file, unless a removed line of the same key already
 * had that kind: `||` before `true`, `echo` or `exit 0` as a command (at the start, after `||` or after `;`),
 * `--passWithNoTests`, `--testPathPattern` and `-t` or `--testNamePattern`. A removed `pretest` or `posttest` script
 * that no added line of the file has again is a signal at its old line. `--passWithNoTests` gives nothing when the
 * tracked files hold no test file and the diff deletes none. The severity is the mode; at most 20 per file, on the
 * lowest line numbers. No script key or value reaches a signal: every detail is one fixed sentence.
 */
export function detectTI10(diff: readonly DiffFile[], options: TI10Options): TestIntegritySignal[] {
  const noTestFiles =
    options.repoFiles.length > 0 &&
    !options.repoFiles.some((path) => isTestFile(path)) &&
    deletedTestFiles(diff).length === 0;

  const signals: TestIntegritySignal[] = [];
  for (const file of diff) {
    if (file.hunks === undefined || file.binary === true || !isPackageJsonFile(file.path)) continue;
    if (file.status !== "modified" && file.status !== "renamed") continue;

    const removedKinds = new Map<string, Set<Kind>>();
    const removedHooks: Array<{ key: string; line: number }> = [];
    const addedKeys = new Set<string>();
    const found: Array<{ line: number; kind: Kind }> = [];

    for (const hunk of file.hunks) {
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
    for (const hunk of file.hunks) {
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

    found.sort((a, b) => a.line - b.line || byCodeUnit(DETAILS[a.kind], DETAILS[b.kind]));
    for (const { line, kind } of found.slice(0, MAX_PER_FILE)) {
      signals.push({ id: "TI10", severity: options.mode, path: file.path, line, detail: DETAILS[kind] });
    }
  }
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}
