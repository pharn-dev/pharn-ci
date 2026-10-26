import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";
import { fixture } from "./helpers.js";

// check() is loaded inside the test body (through runDiff): the AC test is written before TI11 compares test commands
// by key, and the fixtures it reads are written by the build, so nothing the build adds may run while the file loads.

const CI = ".github/workflows/ci.yml";
const TEST_STEP = "A step that runs tests was removed from a workflow.";
const TRIGGER = "The pull_request trigger was removed from a workflow, so it no longer runs on pull requests.";
const CONTINUE = "continue-on-error: true was added in a workflow, so a failing step no longer fails the job.";
const IF = "An if: condition was added in a workflow that disables a step or job, or skips pull requests.";
const MATRIX = "A matrix list in a workflow was reduced, so CI covers fewer combinations.";
const TIMEOUT = "A timeout of 0 or 1 minutes was added in a workflow, so a test run may be cut off.";

/**
 * The TI11 signals (severity, path, line, detail) every `.diff` of fixtures/test-integrity/TI11/ gave at the base
 * commit 5860ba4, through check() in mode block with the test-files-deleted repo files (as runDiff runs it).
 */
const EARLIER: ReadonlyArray<[string, ReadonlyArray<[string, string, number, string]>]> = [
  ["block-pnpm-vitest-removed.diff", [["block", CI, 24, TEST_STEP]]],
  ["block-test-step-removed.diff", [["block", CI, 35, TEST_STEP]]],
  ["block-trigger-flow.diff", [["block", CI, 3, TRIGGER]]],
  ["block-trigger-quoted-on.diff", [["block", CI, 3, TRIGGER]]],
  ["block-trigger-removed.diff", [["block", CI, 17, TRIGGER]]],
  ["block-uv-pytest-removed.diff", [["block", CI, 31, TEST_STEP]]],
  [
    "block-workflow-deleted.diff",
    [
      ["block", ".github/workflows/test.yml", 3, TRIGGER],
      ["block", ".github/workflows/test.yml", 11, TEST_STEP],
    ],
  ],
  ["pass-action-bump.diff", []],
  ["pass-comment-removed.diff", []],
  ["pass-continue-expression.diff", []],
  ["pass-if-always.diff", []],
  ["pass-matrix-grown.diff", []],
  ["pass-non-workflow.diff", []],
  ["pass-on-key-quoted.diff", []],
  ["pass-pure-rename.diff", []],
  ["pass-step-moved.diff", []],
  ["pass-step-reflowed.diff", []],
  ["pass-timeout-fifteen.diff", []],
  ["pass-trigger-kept.diff", []],
  ["pass-uv-pytest-moved.diff", []],
  ["warn-continue-on-error.diff", [["warn", CI, 41, CONTINUE]]],
  ["warn-if-event.diff", [["warn", CI, 41, IF]]],
  ["warn-if-false.diff", [["warn", CI, 41, IF]]],
  ["warn-matrix-reduced.diff", [["warn", CI, 22, MATRIX]]],
  ["warn-timeout-one.diff", [["warn", CI, 27, TIMEOUT]]],
];

function hunk(start: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${start - 1},0` : `${start},${removed.length}`;
  const newPart = added.length === 0 ? `${start - 1},0` : `${start},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

/** A modified file with these `[old start, removed lines, added lines]` hunks. */
function edit(path: string, hunks: Array<[number, string[], string[]]>): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap(([start, removed, added]) => hunk(start, removed, added))].join("\n")}\n`;
}

/** Every removed line of a unified diff, with its old-file path and old-file line number. */
function removedLines(diff: string): Array<{ path: string; line: number; text: string }> {
  const out: Array<{ path: string; line: number; text: string }> = [];
  let path = "";
  let old = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      path = "";
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("--- a/")) path = raw.slice("--- a/".length);
      const start = /^@@ -(\d+)/.exec(raw);
      if (start) {
        old = Number(start[1]);
        inHunk = true;
      }
      continue;
    }
    const start = /^@@ -(\d+)/.exec(raw);
    if (start) {
      old = Number(start[1]);
    } else if (raw.startsWith("-")) {
      out.push({ path, line: old, text: raw.slice(1) });
      old++;
    } else if (raw.startsWith(" ")) {
      old++;
    }
  }
  return out;
}

type Report = Awaited<ReturnType<typeof runDiff>>;
const ti11 = (report: Report) =>
  signalsOf(report, "TI11").map((s) => ({
    id: String(s.id),
    severity: s.severity,
    path: s.path,
    line: s.line,
    detail: s.detail,
  }));
const stepAt = (path: string, line: number) => [{ id: "TI11", severity: "block", path, line, detail: TEST_STEP }];

describe("TI11: test commands compared by key", () => {
  it("AC-1: equivalent package-manager and launcher forms give no TI11, a dropped or narrowed test run gives one block test-step signal at its removed line, and the earlier TI11 fixtures give their base-commit signals", async () => {
    // Each pair removes one command and adds an equivalent one.
    const equivalents: Array<[string, string]> = [
      ["npm run test", "pnpm test"],
      ["npm t", "yarn test"],
      ["yarn run test", "bun run test"],
      ["npm run-script test", "pnpm run test"],
      ["pnpm run test -- --coverage", "pnpm test --coverage"],
      ["npx vitest run", "pnpm exec vitest run"],
      ["bunx vitest run", "vitest run"],
      ["pnpm build && npm test", "pnpm build && pnpm test"],
    ];
    for (const [from, to] of equivalents) {
      const diff = edit(CI, [[14, [`      - run: ${from}`], [`      - run: ${to}`]]]);
      expect(ti11(await runDiff(diff, "block")), `${from} → ${to}`).toEqual([]);
    }

    // A narrowed run keeps its workspace flags and arguments in the key, so it is a removal.
    const narrowed: Array<[string, string]> = [
      ["pnpm test", "pnpm --filter core test"],
      ["pnpm -r test", "pnpm test"],
      ["pnpm test", "pnpm test src/a"],
    ];
    for (const [from, to] of narrowed) {
      const diff = edit(CI, [[14, [`      - run: ${from}`], [`      - run: ${to}`]]]);
      expect(ti11(await runDiff(diff, "block")), `${from} → ${to}`).toEqual(stepAt(CI, 14));
    }

    // hono 5433: bun run test and bun run test:bun swapped for pnpm.
    const swap = fixture("test-integrity/TI11/pass-package-manager-swap.diff");
    expect(swap, "the swap fixture removes bun run test").toMatch(/^-.*\bbun run test(?![:\w-])/m);
    expect(swap, "the swap fixture removes bun run test:bun").toMatch(/^-.*\bbun run test:bun\b/m);
    expect(swap, "the swap fixture adds pnpm").toMatch(/^\+.*\bpnpm\b/m);
    expect(ti11(await runDiff(swap, "block")), "pass-package-manager-swap.diff").toEqual([]);

    // bun run test → pnpm run lint drops the test run.
    const drop = fixture("test-integrity/TI11/block-swap-drops-test.diff");
    expect(drop, "the drop fixture adds pnpm run lint").toMatch(/^\+.*\bpnpm run lint\b/m);
    const removed = removedLines(drop).find((r) => /\bbun run test\b/.test(r.text));
    expect(removed, "the drop fixture removes bun run test").toBeDefined();
    const at = removed as { path: string; line: number };
    expect(ti11(await runDiff(drop, "block")), "block-swap-drops-test.diff").toEqual(stepAt(at.path, at.line));

    // Every TI11 fixture of the base commit gives what it gave there.
    for (const [name, expected] of EARLIER) {
      const signals = ti11(await runDiff(fixture(`test-integrity/TI11/${name}`), "block"));
      expect(signals, name).toEqual(
        expected.map(([severity, path, line, detail]) => ({ id: "TI11", severity, path, line, detail })),
      );
    }
  });
});
