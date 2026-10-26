import type { DiffFile, DiffLineText } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isWorkflowFile } from "./signalFiles.js";
import { flowItems, keyValue, stripComment, unquote } from "./yamlLines.js";

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
function keyOf(part: string): string {
  const tokens = part.split(" ");
  const runner = runnerStart(tokens);
  if (runner >= 0) return tokens.slice(runner).join(" ");

  const manager = tokens[0] as string;
  if (!PACKAGE_MANAGERS.has(manager)) return part;
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
  if (script === undefined || !/^(?:test|t)(?::[\w:-]+)?$/.test(script)) return part;
  // `bun test` starts bun's own runner, not a package script.
  if (manager === "bun" && !ran) return part;
  if (!ran && script === "t") script = "test";
  i += 1;
  if (tokens[i] === "--") i += 1;
  return ["run", ...flags, script, ...tokens.slice(i)].join(" ");
}

/** The keys of the test parts of a line that runs tests (a `&&` or `;` chain counts part by part), empty when none does. */
function testKeysOf(line: string): string[] {
  const text = commandText(line);
  if (text === "") return [];
  return text
    .split(/\s*(?:&&|;)\s*/)
    .filter((part) => TEST_COMMAND.test(part))
    .map(keyOf);
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

/**
 * TI11, CI stopped running tests, from the added and removed lines of workflow files (`.github/workflows/*.yml|yaml`).
 * Block rules take the effective mode: a removed test command that no workflow line of the diff adds again, and a
 * removed `pull_request` or `pull_request_target` trigger that the same file does not carry again. A test command is
 * compared by a key per test part of a `&&` or `;` chain: a package-manager script run keys on the script with its
 * workspace flags and arguments, a runner on its command without the launcher, so `npm run test` and `pnpm test` are
 * one command. A test job removed from a workflow is a removal even when the change moves its tests elsewhere: the diff
 * cannot show that another workflow runs them, and nothing the pull request carries may loosen this block. The warn
 * rules (a flow-list matrix that shrinks, an added `continue-on-error: true`, an added `if:` that is a literal false or
 * an event-name test leaving pull requests out, an added `timeout-minutes` of 0 or 1) stay `warn` in every mode, because
 * without context lines the line cannot be tied to a test step. One signal per rule per file, on its first matching
 * line; the detail is a fixed sentence.
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
        for (const key of testKeysOf(entry.text)) addedKeys.add(key);
      }
    }
  }

  const signals: TestIntegritySignal[] = [];
  for (const file of files) {
    const path = file.path;
    const added: DiffLineText[] = (file.hunks ?? []).flatMap((hunk) => hunk.added);
    const removed: DiffLineText[] = (file.hunks ?? []).flatMap((hunk) => hunk.removed);
    const emit = (severity: "block" | "warn" | "info", line: number, detail: string) =>
      signals.push({ id: "TI11", severity, path, line, detail });

    const lostCommand = removed.find((entry) => testKeysOf(entry.text).some((key) => !addedKeys.has(key)));
    if (lostCommand !== undefined) emit(mode, lostCommand.line, SENTENCES.testStep);

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
