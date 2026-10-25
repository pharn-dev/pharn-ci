import { describe, expect, it } from "vitest";
import { runDiff, signalsOf } from "./ac-e1-fix-shared.js";

// check() is loaded inside the test body (through runDiff): the AC tests are written before TI08 exists, so nothing
// the build adds may run while the file loads.

/** The signal id and the pytest flag, built from parts so this file holds neither as written. */
const ID = ["TI", "08"].join("");
const FLAG = ["--snapshot", "-update"].join("");
const LINE = `addopts = -ra ${FLAG}`;

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

/** The line added at line 4 of `path`. */
const addLine = (path: string, line = LINE) => edit(path, [4, 4, [], [line]]);

const TRIGGERS = ["pyproject.toml", "pytest.ini", "setup.cfg", "tox.ini", "pkg/pyproject.toml"];

const CONTROLS: Array<[label: string, diff: string]> = [
  ["the line added to docs/pytest.md", addLine("docs/pytest.md")],
  ["the line added to config.toml", addLine("config.toml")],
  ["the line moved within pyproject.toml", edit("pyproject.toml", [3, 3, [LINE], []], [9, 8, [], [LINE]])],
  ["--snapshot-updates added to pyproject.toml", addLine("pyproject.toml", `addopts = -ra ${FLAG}s`)],
];

describe("TI08 (c): --snapshot-update added to a pytest config file", () => {
  it("AC-5: the flag added to pyproject.toml, pytest.ini, setup.cfg, tox.ini or a nested pyproject.toml gives one warn signal at the added line; the controls give none", async () => {
    for (const path of TRIGGERS) {
      const signals = signalsOf(await runDiff(addLine(path)), ID);
      expect(
        signals.map((s) => ({ path: s.path, line: s.line, severity: s.severity })),
        path,
      ).toEqual([{ path, line: 4, severity: "warn" }]);
      expect((signals[0]?.detail ?? "").length, path).toBeLessThanOrEqual(300);
    }
    for (const [label, diff] of CONTROLS) {
      expect(signalsOf(await runDiff(diff), ID), label).toEqual([]);
    }
  });
});
