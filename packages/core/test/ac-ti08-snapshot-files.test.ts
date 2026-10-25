import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside each test body (through runDiff): the AC tests are written before TI08 exists, so nothing
// the build adds may run while the file loads.

/** The signal id, built from parts so this file holds no literal a new source condition could compare against. */
const ID = ["TI", "08"].join("");

/** One hunk of a `--unified=0` diff: the first old and new line of the change, the removed and the added lines. */
type Hunk = [oldStart: number, newStart: number, removed: string[], added: string[]];

function hunk([oldStart, newStart, removed, added]: Hunk): string[] {
  const oldPart = removed.length === 0 ? `${oldStart - 1},0` : `${oldStart},${removed.length}`;
  const newPart = added.length === 0 ? `${newStart - 1},0` : `${newStart},${added.length}`;
  return [`@@ -${oldPart} +${newPart} @@`, ...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)];
}

/** A modified file. */
function edit(path: string, ...hunks: Hunk[]): string {
  const head = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

/** A file the diff adds. */
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

/** A file the diff deletes. */
function removeFile(path: string, lines: string[]): string {
  const head = [`diff --git a/${path} b/${path}`, "deleted file mode 100644", "index 1111111..0000000"];
  const body = [`--- a/${path}`, "+++ /dev/null", `@@ -1,${lines.length} +0,0 @@`, ...lines.map((l) => `-${l}`)];
  return `${[...head, ...body].join("\n")}\n`;
}

/** A renamed file; with no hunks it is a pure rename (similarity 100%). */
function renameFile(from: string, to: string, ...hunks: Hunk[]): string {
  if (hunks.length === 0) {
    return `${[`diff --git a/${from} b/${to}`, "similarity index 100%", `rename from ${from}`, `rename to ${to}`].join("\n")}\n`;
  }
  const head = [
    `diff --git a/${from} b/${to}`,
    "similarity index 90%",
    `rename from ${from}`,
    `rename to ${to}`,
    "index 1111111..2222222 100644",
    `--- a/${from}`,
    `+++ b/${to}`,
  ];
  return `${[...head, ...hunks.flatMap((h) => hunk(h))].join("\n")}\n`;
}

const OLD = 'exports[`view renders 1`] = `"old"`;';
const NEW = 'exports[`view renders 1`] = `"new"`;';
const modify = (path: string) => edit(path, [3, 3, [OLD], [NEW]]);
const pad = (i: number) => String(i).padStart(2, "0");
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Snapshot paths with a `__snapshots__` segment; listed in the diff in reverse, so diff order is not sorted order. */
const snap = (i: number) => `src/__snapshots__/view-${pad(i)}.ts.snap`;

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Case = { label: string; diff: string; counted: string[] };

const MIXED = [
  ...range(1, 5).map((i) => `src/snaps/panel-${pad(i)}.snap`),
  ...range(1, 5).map((i) => `py/tests/test_api-${pad(i)}.ambr`),
  "src/__snapshots__/x.json",
];

const TRIGGERS: Case[] = [
  {
    label: "11 modified snapshot files under __snapshots__",
    diff: range(1, 11)
      .reverse()
      .map((i) => modify(snap(i)))
      .join(""),
    counted: range(1, 11).map(snap),
  },
  {
    label: "11 changed files mixing .snap, .ambr and __snapshots__/x.json",
    diff: [...MIXED].reverse().map(modify).join(""),
    counted: MIXED,
  },
  {
    label: "11 deleted snapshot files",
    diff: range(1, 11)
      .reverse()
      .map((i) => removeFile(snap(i), [OLD, NEW]))
      .join(""),
    counted: range(1, 11).map(snap),
  },
  {
    label: "10 modified snapshot files and one renamed with added lines",
    diff:
      range(1, 10)
        .reverse()
        .map((i) => modify(snap(i)))
        .join("") + renameFile("src/__snapshots__/aaa-old.ts.snap", snap(11), [3, 4, [], [NEW]]),
    counted: range(1, 11).map(snap),
  },
];

const CONTROLS: Array<[label: string, diff: string]> = [
  [
    "10 modified snapshot files",
    range(1, 10)
      .map((i) => modify(snap(i)))
      .join(""),
  ],
  [
    "11 added snapshot files and 1 modified",
    range(1, 11)
      .map((i) => addFile(snap(i), [NEW]))
      .join("") + modify(snap(12)),
  ],
  [
    "11 snapshot files renamed with no content change",
    range(1, 11)
      .map((i) => renameFile(`src/__snapshots__/old-${pad(i)}.ts.snap`, snap(i)))
      .join(""),
  ],
  [
    "11 snapshot files renamed whose hunks only remove lines",
    range(1, 11)
      .map((i) => renameFile(`src/__snapshots__/old-${pad(i)}.ts.snap`, snap(i), [3, 3, [OLD], []]))
      .join(""),
  ],
];

describe("TI08 (a): many snapshot files changed in one change", () => {
  it("AC-1: more than 10 modified, deleted or renamed-with-added-lines snapshot files give one warn signal with line null at the first counted path; the controls give none, in block and warn", async () => {
    for (const mode of ["block", "warn"] as const) {
      for (const c of TRIGGERS) {
        const report = await runDiff(c.diff, mode);
        const signals = signalsOf(report, ID);
        expect(signals, `${mode}: ${c.label}`).toHaveLength(1);
        const [signal] = signals;
        const first = [...c.counted].sort(byCodeUnit)[0];
        expect(signal?.severity, `${mode}: ${c.label}`).toBe("warn");
        expect(signal?.line, `${mode}: ${c.label}`).toBeNull();
        expect(signal?.path, `${mode}: ${c.label}`).toBe(first);
        const detail = signal?.detail ?? "";
        expect(detail.length, `${mode}: ${c.label}`).toBeGreaterThan(0);
        expect(detail.length, `${mode}: ${c.label}`).toBeLessThanOrEqual(300);
        expect(detail, `${mode}: ${c.label}`).toMatch(new RegExp(`\\b${c.counted.length}\\b`));
      }
      for (const [label, diff] of CONTROLS) {
        const report = await runDiff(diff, mode);
        expect(signalsOf(report, ID), `${mode}: ${label}`).toEqual([]);
      }
    }
  });
});
