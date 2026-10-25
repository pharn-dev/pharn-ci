import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI08 exists, so nothing
// the build adds may run while the file loads.

/** The signal id and the inline-snapshot call, built from parts so this file holds neither as written. */
const ID = ["TI", "08"].join("");
const INLINE = ["toMatchInline", "Snapshot("].join("");

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

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
/** One inline-snapshot assertion on one line, with the snapshot value `value`. */
const call = (i: number, value: string, indent = "  ") => `${indent}expect(view(${i})).${INLINE}\`"${value} ${i}"\`);`;

const TEST_FILE = "src/view.test.ts";
/** A first hunk adds an import at line 2, so the rewrite starts at new-file line 6, not at its old line 5. */
const IMPORT: Hunk = [2, 2, [], ['import { view } from "./view";']];

/** `removed` inline-snapshot lines replaced by `added` ones with another value, from old line 5 / new line 6. */
const rewrite = (path: string, removed: number, added: number) =>
  edit(path, IMPORT, [5, 6, range(removed).map((i) => call(i, "old")), range(added).map((i) => call(i, "new"))]);

const TRIGGERS: Array<[label: string, diff: string]> = [
  ["10 inline snapshots rewritten", rewrite(TEST_FILE, 10, 10)],
  ["12 removed inline snapshots, 10 added", rewrite(TEST_FILE, 12, 10)],
];

const CONTROLS: Array<[label: string, diff: string]> = [
  ["9 inline snapshots rewritten", rewrite(TEST_FILE, 9, 9)],
  [
    "10 inline snapshots added in new tests, none removed",
    edit(TEST_FILE, IMPORT, [5, 6, [], range(10).map((i) => call(i, "new"))]),
  ],
  [
    "10 inline snapshots moved with the same trimmed text",
    edit(
      TEST_FILE,
      [5, 5, range(10).map((i) => call(i, "same")), []],
      [30, 20, [], range(10).map((i) => call(i, "same", "    "))],
    ),
  ],
  [
    "only the template-literal body lines rewritten, the call lines unchanged",
    edit(TEST_FILE, [5, 5, range(10).map((i) => `    "old body ${i}"`), range(10).map((i) => `    "new body ${i}"`)]),
  ],
  ["the 10-line rewrite in the non-test source file src/view.ts", rewrite("src/view.ts", 10, 10)],
  ["the 10-line rewrite in the Python test file tests/test_view.py", rewrite("tests/test_view.py", 10, 10)],
];

describe("TI08 (b): inline snapshots rewritten en masse in a JS/TS test file", () => {
  it("AC-3: 10 rewritten and 12-for-10 rewritten inline snapshots give one warn signal at the first rewritten added line naming 10; the controls give none", async () => {
    for (const [label, diff] of TRIGGERS) {
      const signals = signalsOf(await runDiff(diff), ID);
      expect(signals, label).toHaveLength(1);
      const [signal] = signals;
      expect(signal?.severity, label).toBe("warn");
      expect(signal?.path, label).toBe(TEST_FILE);
      expect(signal?.line, label).toBe(6);
      expect(signal?.detail ?? "", label).toMatch(/\b10\b/);
      expect((signal?.detail ?? "").length, label).toBeLessThanOrEqual(300);
    }
    for (const [label, diff] of CONTROLS) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
