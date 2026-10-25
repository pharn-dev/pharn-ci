import type { DiffFile, DiffLineText } from "../diff/unified.js";
import type { TestIntegritySignal } from "../report.js";
import { isWorkflowFile } from "./signalFiles.js";
import { flowItems, keyValue, stripComment, unquote } from "./yamlLines.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A command that runs tests: a package-manager test script, a JS or Python test runner, `go test`, Playwright. */
const TEST_COMMAND =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?(?:\s|$)|(?:npx\s+|pnpm\s+exec\s+|yarn\s+|bunx\s+)?(?:vitest|jest|mocha)(?:\s|$)|(?:python3?\s+-m\s+)?pytest(?:\s|$)|python3?\s+-m\s+unittest(?:\s|$)|go\s+test(?:\s|$)|(?:npx\s+)?playwright\s+test(?:\s|$))/;

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

/** The normalized command of a line that runs tests, else null. A `&&` or `;` chain counts when any part does. */
function testCommandOf(line: string): string | null {
  const text = commandText(line);
  if (text === "") return null;
  return text.split(/\s*(?:&&|;)\s*/).some((part) => TEST_COMMAND.test(part)) ? text : null;
}

/** Whether a line names a pull request event as a key, a list item or in the value of `on:`. */
function carriesPullRequestTrigger(line: string): boolean {
  const text = stripComment(line);
  if (/^['"]?pull_request(?:_target)?['"]?\s*:/.test(text)) return true;
  if (/^-\s+['"]?pull_request(?:_target)?['"]?$/.test(text)) return true;
  const on = /^on\s*:\s*(.+)$/.exec(text);
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
 * removed `pull_request` or `pull_request_target` trigger that the same file does not carry again. The warn rules (a
 * flow-list matrix that shrinks, an added `continue-on-error: true`, an added `if:` that is a literal false or an
 * event-name test leaving pull requests out, an added `timeout-minutes` of 0 or 1) stay `warn` in every mode, because
 * without context lines the line cannot be tied to a test step. One signal per rule per file, on its first matching
 * line; the detail is a fixed sentence.
 */
export function detectTI11(diff: readonly DiffFile[], mode: "block" | "warn"): TestIntegritySignal[] {
  const files = diff.filter(
    (file) =>
      (isWorkflowFile(file.path) || isWorkflowFile(file.oldPath)) && file.hunks !== undefined && file.binary !== true,
  );
  const addedCommands = new Set<string>();
  for (const file of files) {
    for (const hunk of file.hunks ?? []) {
      for (const entry of hunk.added) {
        const command = testCommandOf(entry.text);
        if (command !== null) addedCommands.add(command);
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

    const lostCommand = removed.find((entry) => {
      const command = testCommandOf(entry.text);
      return command !== null && !addedCommands.has(command);
    });
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
