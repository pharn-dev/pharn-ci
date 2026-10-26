import type { DiffFile, DiffLineText } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isTestFile } from "../testFiles.js";
import { isPackageJsonFile, isWorkflowFile } from "./signalFiles.js";
import { parseScriptLine } from "./ti10.js";
import { flowItems, indentOf, keyValue, stripComment, unquote } from "./yamlLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Workspace flags a package manager takes before the script name: `-r`, `-w`, `--filter core`, `-C pkg`, ... */
const PM_FLAGS = String.raw`(?:\s+(?:-r|--recursive|-w|--workspace-root|-ws|--workspaces|--if-present|(?:--filter|-F|-C|--dir|--prefix|--workspace|--cwd)(?:=|\s+)\S+))*`;
/** A runner a package manager or a launcher starts: `pnpm vitest`, `pnpm exec jest`, `npx mocha`, `bun x vitest`. */
const JS_LAUNCHER = String.raw`(?:(?:npx|bunx|yarn|pnpm${PM_FLAGS}(?:\s+(?:exec|dlx))?|bun\s+x|npm\s+exec)\s+)?`;
/** A Python environment wrapper: `uv run`, `poetry run`, `pipenv run`, `pdm run`, `hatch run`, `rye run`. */
const PY_WRAPPER = String.raw`(?:(?:uv|poetry|pipenv|pdm|hatch|rye)\s+run\s+)?`;

/**
 * A command that runs tests: a package-manager test script (`npm t`, `pnpm -r test`, `pnpm --filter core test`), a JS
 * runner (`vitest`, `jest`, `mocha`, directly or through a launcher), `node --test`, `bun test`, `deno test`, `pytest`,
 * `python -m unittest`, `tox` or `nox` (directly or through an environment wrapper), `go test`, Playwright.
 */
const TEST_COMMAND_PARTS: readonly string[] = [
  String.raw`(?:npm|pnpm|yarn|bun)${PM_FLAGS}\s+(?:run\s+)?(?:test|t)(?::[\w:-]+)?(?:\s|$)`,
  String.raw`${JS_LAUNCHER}(?:vitest|jest|mocha)(?:\s|$)`,
  String.raw`node\s+(?:\S+\s+)*?--test(?:\s|=|$)`,
  String.raw`(?:bun|deno)\s+test(?:\s|$)`,
  String.raw`${PY_WRAPPER}(?:python3?\s+-m\s+)?pytest(?:\s|$)`,
  String.raw`${PY_WRAPPER}python3?\s+-m\s+unittest(?:\s|$)`,
  String.raw`${PY_WRAPPER}(?:tox|nox)(?:\s|$)`,
  String.raw`go\s+test(?:\s|$)`,
  String.raw`${JS_LAUNCHER}playwright\s+test(?:\s|$)`,
];
const TEST_COMMAND = new RegExp(`^(?:${TEST_COMMAND_PARTS.map((part) => `(?:${part})`).join("|")})`);

/** A key that filters when a workflow runs, not a list of combinations to test. */
const NOT_A_MATRIX_KEY: ReadonlySet<string> = new Set([
  "on",
  "branches",
  "branches-ignore",
  "tags",
  "tags-ignore",
  "paths",
  "paths-ignore",
  "types",
  "runs-on",
  "needs",
  "labels",
]);

const PULL_REQUEST_TOKEN = /(?<![\w-])pull_request(?:_target)?(?![\w-])/;

/** A line after its comment, a leading `- ` and a `run:` key are removed, with white space collapsed. */
function commandText(line: string): string {
  const text = stripComment(line)
    .replace(/^-\s+/, "")
    .replace(/^run\s*:\s*/, "");
  return text.replace(/\s+/g, " ").trim();
}

/** Workspace flags that take no value, as tokens (the value flags of `PM_FLAGS` are read beside them). */
const PM_PLAIN_FLAGS: ReadonlySet<string> = new Set([
  "-r",
  "--recursive",
  "-w",
  "--workspace-root",
  "-ws",
  "--workspaces",
  "--if-present",
]);
const PM_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--filter",
  "-F",
  "-C",
  "--dir",
  "--prefix",
  "--workspace",
  "--cwd",
]);
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun"]);
const RUNNERS: ReadonlySet<string> = new Set(["vitest", "jest", "mocha"]);

/** The comparison key of one test part, and the package.json script it runs when it is a package-manager script run. */
interface TestPart {
  key: string;
  script: string | null;
}

/** The index in `tokens` where a runner command starts after a launcher, or -1 when the part is not a launcher form. */
function runnerStart(tokens: readonly string[]): number {
  const first = tokens[0] as string;
  let start = -1;
  if (first === "npx" || first === "bunx") start = 1;
  else if (first === "bun" || first === "npm") start = tokens[1] === (first === "bun" ? "x" : "exec") ? 2 : -1;
  else if (first === "pnpm") start = tokens[1] === "exec" || tokens[1] === "dlx" ? 2 : 1;
  else if (first === "yarn") start = 1;
  else start = 0;
  if (start < 0) return -1;
  const runner = tokens[start];
  if (runner === undefined) return -1;
  if (RUNNERS.has(runner) || (runner === "playwright" && tokens[start + 1] === "test")) return start;
  return -1;
}

/** The key of a test part: the runner command without its launcher, the script run with its flags, else the text. */
function partOf(part: string): TestPart {
  const tokens = part.split(" ");
  const runner = runnerStart(tokens);
  if (runner >= 0) return { key: tokens.slice(runner).join(" "), script: null };

  const manager = tokens[0] as string;
  if (!PACKAGE_MANAGERS.has(manager)) return { key: part, script: null };
  let i = 1;
  const flags: string[] = [];
  for (;;) {
    const token = tokens[i];
    if (token === undefined) break;
    if (PM_PLAIN_FLAGS.has(token)) {
      flags.push(token);
      i += 1;
    } else if (PM_VALUE_FLAGS.has(token) && tokens[i + 1] !== undefined) {
      flags.push(token, tokens[i + 1] as string);
      i += 2;
    } else if (/^(?:--filter|-F|-C|--dir|--prefix|--workspace|--cwd)=\S+$/.test(token)) {
      flags.push(token);
      i += 1;
    } else {
      break;
    }
  }
  let ran = false;
  if (tokens[i] === "run" || (manager === "npm" && tokens[i] === "run-script")) {
    ran = true;
    i += 1;
  }
  let script = tokens[i];
  if (script === undefined || !/^(?:test|t)(?::[\w:-]+)?$/.test(script)) return { key: part, script: null };
  // `bun test` starts bun's own runner, not a package script.
  if (manager === "bun" && !ran) return { key: part, script: null };
  if (!ran && script === "t") script = "test";
  i += 1;
  if (tokens[i] === "--") i += 1;
  return { key: ["run", ...flags, script, ...tokens.slice(i)].join(" "), script };
}

/** The test parts of a line that runs tests (a `&&` or `;` chain counts part by part), empty when none does. */
function testPartsOf(line: string): TestPart[] {
  const text = commandText(line);
  if (text === "") return [];
  return text
    .split(/\s*(?:&&|;)\s*/)
    .filter((part) => TEST_COMMAND.test(part))
    .map(partOf);
}

/** Whether a line names a pull request event as a key, a list item or in the value of `on:`. */
function carriesPullRequestTrigger(line: string): boolean {
  const text = stripComment(line);
  if (/^['"]?pull_request(?:_target)?['"]?\s*:/.test(text)) return true;
  if (/^-\s+['"]?pull_request(?:_target)?['"]?$/.test(text)) return true;
  const on = /^(?:on|"on"|'on')\s*:\s*(.+)$/.exec(text);
  return on !== null && PULL_REQUEST_TOKEN.test(on[1] as string);
}

/** The `if:` expression of a line: unquoted, with a `${{ }}` wrapper removed. */
function ifExpression(value: string): string {
  const inner = /^\$\{\{\s*(.*?)\s*\}\}$/.exec(unquote(value));
  return unquote(inner === null ? value : (inner[1] as string));
}

const DISABLING_IF =
  /^(?:false|github\.event_name\s*(?:!=\s*['"]pull_request['"]|==\s*['"](?:push|schedule|workflow_dispatch)['"]))$/i;

const SENTENCES = {
  testStep: "A step that runs tests was removed from a workflow.",
  retiredJob:
    "A job that ran tests was removed from a workflow together with the script it ran, while this change moves test files; check that another workflow runs them.",
  trigger: "The pull_request trigger was removed from a workflow, so it no longer runs on pull requests.",
  matrix: "A matrix list in a workflow was reduced, so CI covers fewer combinations.",
  continueOnError: "continue-on-error: true was added in a workflow, so a failing step no longer fails the job.",
  condition: "An if: condition was added in a workflow that disables a step or job, or skips pull requests.",
  timeout: "A timeout of 0 or 1 minutes was added in a workflow, so a test run may be cut off.",
} as const;

/** A `key: value` pair of a line as one comparable string, or null when the line is not one. */
function pairOf(line: string): string | null {
  const kv = keyValue(line);
  return kv === null ? null : `${kv.key}:${kv.value}`;
}

function flowOf(line: string): { key: string; items: Set<string> } | null {
  const kv = keyValue(line);
  if (kv === null || NOT_A_MATRIX_KEY.has(kv.key)) return null;
  const items = flowItems(kv.value);
  return items === null ? null : { key: kv.key, items: new Set(items) };
}

/** The keys that make a header a job: a job holds `runs-on`, `steps` or `uses` somewhere below its header. */
const JOB_MARKER_KEYS: ReadonlySet<string> = new Set(["runs-on", "steps", "uses"]);

/**
 * For each removed line of one hunk (in old-file order), whether a removed job covers it. A key line with an empty value
 * at an indent above 0 opens a header, a line at or below an open header's indent closes it, and a header that holds a
 * `runs-on`, `steps` or `uses` key (or has a marked header below it) is a job. A gap in old-file line numbers closes
 * every header; blank and comment-only lines are skipped. One walk with a stack and one prefix sum.
 */
function retiredJobLines(removed: readonly DiffLineText[]): boolean[] {
  const marks = new Array<number>(removed.length + 1).fill(0);
  const stack: Array<{ indent: number; index: number; marked: boolean }> = [];
  const close = (end: number) => {
    const header = stack.pop() as { indent: number; index: number; marked: boolean };
    if (!header.marked) return;
    marks[header.index] = (marks[header.index] as number) + 1;
    marks[end] = (marks[end] as number) - 1;
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.marked = true;
  };
  let previous: number | null = null;
  for (let index = 0; index < removed.length; index++) {
    const entry = removed[index] as DiffLineText;
    if (previous !== null && entry.line !== previous + 1) {
      while (stack.length > 0) close(index);
    }
    previous = entry.line;
    if (stripComment(entry.text) === "") continue;
    const kv = keyValue(entry.text);
    const indent = kv === null ? indentOf(entry.text) : kv.indent;
    while (stack.length > 0 && (stack[stack.length - 1] as { indent: number }).indent >= indent) close(index);
    if (kv === null) continue;
    const top = stack[stack.length - 1];
    if (top !== undefined && JOB_MARKER_KEYS.has(kv.key)) top.marked = true;
    if (kv.value === "" && indent > 0) stack.push({ indent, index, marked: false });
  }
  while (stack.length > 0) close(removed.length);
  const covered: boolean[] = [];
  let running = 0;
  for (let index = 0; index < removed.length; index++) {
    running += marks[index] as number;
    covered.push(running > 0);
  }
  return covered;
}

/** The script names (the keys of `"name": "command"` lines) of the added or removed lines of every package.json. */
function scriptNames(diff: readonly DiffFile[], side: "added" | "removed"): Set<string> {
  const names = new Set<string>();
  for (const file of diff) {
    if (!isPackageJsonFile(file.path) && !isPackageJsonFile(file.oldPath)) continue;
    for (const hunk of file.hunks ?? []) {
      for (const entry of hunk[side]) {
        const script = parseScriptLine(entry.text);
        if (script !== null) names.add(script.key);
      }
    }
  }
  return names;
}

/**
 * TI11, CI stopped running tests, from the added and removed lines of workflow files (`.github/workflows/*.yml|yaml`).
 * Block rules take the effective mode: a removed test command that no workflow line of the diff adds again, and a
 * removed `pull_request` or `pull_request_target` trigger that the same file does not carry again. A test command is
 * compared by a key per test part of a `&&` or `;` chain: a package-manager script run keys on the script with its
 * workspace flags and arguments, a runner on its command without the launcher, so `npm run test` and `pnpm test` are
 * one command. A file whose every lost command is a script run in a whole removed job, whose script the diff removes
 * from `package.json` without adding it back, while the diff renames a test file to another test file, gives a `warn`
 * instead. The other warn rules (a flow-list matrix that shrinks, an added `continue-on-error: true`, an added `if:`
 * that is a literal false or an event-name test leaving pull requests out, an added `timeout-minutes` of 0 or 1) stay
 * `warn` in every mode, because without context lines the line cannot be tied to a test step. One signal per rule per
 * file, on its first matching line; the detail is a fixed sentence.
 */
export function detectTI11(diff: readonly DiffFile[], mode: "block" | "warn"): TestIntegritySignal[] {
  const files = diff.filter(
    (file) =>
      (isWorkflowFile(file.path) || isWorkflowFile(file.oldPath)) && file.hunks !== undefined && file.binary !== true,
  );
  const addedKeys = new Set<string>();
  for (const file of files) {
    for (const hunk of file.hunks ?? []) {
      for (const entry of hunk.added) {
        for (const part of testPartsOf(entry.text)) addedKeys.add(part.key);
      }
    }
  }
  const removedScripts = scriptNames(diff, "removed");
  const addedScripts = scriptNames(diff, "added");
  const testRenamed = diff.some(
    (file) => file.status === "renamed" && isTestFile(file.oldPath) && isTestFile(file.path),
  );

  const signals: TestIntegritySignal[] = [];
  for (const file of files) {
    const path = file.path;
    const added: DiffLineText[] = (file.hunks ?? []).flatMap((hunk) => hunk.added);
    const removed: DiffLineText[] = (file.hunks ?? []).flatMap((hunk) => hunk.removed);
    const emit = (severity: "block" | "warn" | "info", line: number, detail: string) =>
      signals.push({ id: "TI11", severity, path, line, detail });

    const retiredLines = (file.hunks ?? []).flatMap((hunk) => retiredJobLines(hunk.removed));
    const lost: Array<{ entry: DiffLineText; retired: boolean }> = [];
    removed.forEach((entry, index) => {
      const parts = testPartsOf(entry.text);
      if (!parts.some((part) => !addedKeys.has(part.key))) return;
      const retired =
        testRenamed &&
        retiredLines[index] === true &&
        parts.every(
          (part) => part.script !== null && removedScripts.has(part.script) && !addedScripts.has(part.script),
        );
      lost.push({ entry, retired });
    });
    const firstLost = lost[0];
    if (firstLost !== undefined) {
      const open = lost.find((item) => !item.retired);
      if (open === undefined) emit("warn", firstLost.entry.line, SENTENCES.retiredJob);
      else emit(mode, open.entry.line, SENTENCES.testStep);
    }

    const lostTrigger = removed.find((entry) => carriesPullRequestTrigger(entry.text));
    if (lostTrigger !== undefined && !added.some((entry) => carriesPullRequestTrigger(entry.text))) {
      emit(mode, lostTrigger.line, SENTENCES.trigger);
    }

    const removedFlows = new Map<string, Set<string>>();
    for (const entry of removed) {
      const flow = flowOf(entry.text);
      if (flow !== null) removedFlows.set(flow.key, flow.items);
    }
    const shrunk = added.find((entry) => {
      const flow = flowOf(entry.text);
      const before = flow === null ? undefined : removedFlows.get(flow.key);
      return flow !== null && before !== undefined && flow.items.size < before.size;
    });
    if (shrunk !== undefined) emit("warn", shrunk.line, SENTENCES.matrix);

    const removedPairs = new Set(removed.map((entry) => pairOf(entry.text)));
    const newPair = (entry: DiffLineText, key: string): { value: string } | null => {
      const kv = keyValue(entry.text);
      if (kv === null || kv.key !== key || removedPairs.has(pairOf(entry.text))) return null;
      return { value: kv.value };
    };

    const lenient = added.find((entry) => newPair(entry, "continue-on-error")?.value === "true");
    if (lenient !== undefined) emit("warn", lenient.line, SENTENCES.continueOnError);

    const disabled = added.find((entry) => {
      const pair = newPair(entry, "if");
      return pair !== null && DISABLING_IF.test(ifExpression(pair.value));
    });
    if (disabled !== undefined) emit("warn", disabled.line, SENTENCES.condition);

    const rushed = added.find((entry) => {
      const pair = newPair(entry, "timeout-minutes");
      return pair !== null && /^\d+$/.test(pair.value) && Number(pair.value) <= 1;
    });
    if (rushed !== undefined) emit("warn", rushed.line, SENTENCES.timeout);
  }
  return signals.sort(
    (a, b) => byCodeUnit(a.path, b.path) || (a.line ?? 0) - (b.line ?? 0) || byCodeUnit(a.detail, b.detail),
  );
}
