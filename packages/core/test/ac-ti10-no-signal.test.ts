import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside each test body: the AC tests are written before TI10 exists, so nothing the build adds
// may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const REPO_FILES = ["package.json", "src/a.ts", "src/a.test.ts", "test/helpers.ts", "src/package.json.ts"];

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

/** A file the diff adds (status added). */
function addFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..2222222",
    "--- /dev/null",
    `+++ b/${path}`,
  ];
  return `${[...head, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n")}\n`;
}

/** A file the diff deletes (status deleted). */
function deleteFile(path: string, lines: string[]): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    "deleted file mode 100644",
    "index 1111111..0000000",
    `--- a/${path}`,
    "+++ /dev/null",
  ];
  return `${[...head, `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)].join("\n")}\n`;
}

async function run(diff: string) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: REPO_FILES,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

const ti10 = (report: Awaited<ReturnType<typeof run>>) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === "TI10");

const PACKAGE = (scripts: string[]) => [
  "{",
  '  "name": "demo",',
  '  "version": "1.0.0",',
  '  "scripts": {',
  ...scripts,
  "  }",
  "}",
];

const PJ = "package.json";

const CASES: Array<[label: string, diff: string]> = [
  [
    "an existing `|| true` kept while the script is edited",
    edit(PJ, [7, 7, ['    "test": "vitest run || true",'], ['    "test": "vitest run --reporter=dot || true",']]),
  ],
  [
    "the unchanged test line moved to another line",
    edit(PJ, [7, 7, ['    "test": "vitest run || true",'], []], [11, 10, [], ['    "test": "vitest run || true",']]),
  ],
  ["`echo` after `&&` in a build script", edit(PJ, [9, 9, [], ['    "build": "tsc && echo built",']])],
  [
    "a test script made stricter",
    edit(PJ, [7, 7, ['    "test": "vitest run",'], ['    "test": "vitest run --coverage",']]),
  ],
  [
    "an existing `|| true` removed",
    edit(PJ, [7, 7, ['    "test": "vitest run || true",'], ['    "test": "vitest run",']]),
  ],
  ["`echo` after `&&` in a test script", edit(PJ, [9, 9, [], ['    "test": "vitest run && echo done",']])],
  ["`-t` in a lint script", edit(PJ, [9, 9, [], ['    "lint": "eslint -t x",']])],
  [
    "`--test-reporter` is not a `-t` filter",
    edit(PJ, [7, 7, ['    "test": "node --test",'], ['    "test": "node --test --test-reporter=dot",']]),
  ],
  [
    "a pretest script edited, not removed",
    edit(PJ, [5, 5, ['    "pretest": "pnpm lint",'], ['    "pretest": "pnpm lint --fix",']]),
  ],
  ["a package.json the diff adds", addFile(PJ, PACKAGE(['    "test": "vitest run || true",', '    "build": "tsc"']))],
  [
    "a package.json the diff deletes",
    deleteFile(PJ, PACKAGE(['    "pretest": "pnpm lint",', '    "test": "vitest run"'])),
  ],
  ["a file that is not a package.json", edit("src/package.json.ts", [3, 3, [], ['    "test": "vitest run || true",']])],
];

describe("TI10: script edits that do not weaken a test script", () => {
  it("AC-3: pre-existing weakenings, unrelated scripts, stricter scripts, an edited pretest, added and deleted package.json files and a non-package.json give no TI10", async () => {
    // Control: the weakening these cases stay clear of gives a TI10 signal.
    const control = await run(edit(PJ, [7, 7, ['    "test": "vitest run",'], ['    "test": "vitest run || true",']]));
    expect(ti10(control).map((s) => `${s.path}:${s.line}`)).toEqual(["package.json:7"]);

    for (const [label, diff] of CASES) {
      const report = await run(diff);
      expect(ti10(report), label).toEqual([]);
    }
  });
});
