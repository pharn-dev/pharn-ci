import { describe, expect, it } from "vitest";
import { createUnifiedDiffReader, parseUnifiedDiff, parseUnifiedDiffLinesAsync } from "../src/diff/unified.js";
import { fixture } from "./helpers.js";

// Policy rule P14 (agent PR size cap) counts removed lines, so the diff parser now records how many lines each entry
// removes (`removedCount`, present only when at least 1). The streaming readers the CLI and the Action use agree with
// the whole-text parser.

const NAMES = [
  "lines/at-cap.diff",
  "lines/over-cap.diff",
  "kinds/rename.diff",
  "kinds/binary.diff",
  "kinds/delete.diff",
  "generated/lockfile.diff",
];

describe("the diff parser counts removed lines", () => {
  it("removedCount is the number of `-` lines of an entry's hunks, absent when there are none", () => {
    const counts = (name: string) =>
      parseUnifiedDiff(fixture(`policy-rules/p14/${name}`)).map((f) => [f.path, f.removedCount]);
    expect(counts("lines/at-cap.diff")).toEqual([["src/a.ts", 4]]);
    expect(counts("kinds/rename.diff")).toEqual([
      ["lib/new.ts", 1],
      ["src/b.ts", undefined],
    ]);
    expect(counts("kinds/delete.diff")).toEqual([["src/legacy.ts", 5]]);
    expect(counts("kinds/binary.diff")).toEqual([
      ["assets/logo.png", undefined],
      ["assets/icon.png", undefined],
      ["src/a.ts", undefined],
    ]);
    // A `-` line of context-looking text inside a hunk counts; `--- ` headers and `\ No newline` markers do not.
    const tricky = parseUnifiedDiff(fixture("diff/tricky.diff"));
    expect(tricky.map((f) => f.removedCount)).toEqual([1, undefined, undefined, 1]);
    for (const file of tricky) expect(Object.hasOwn(file, "removedCount")).toBe(file.removedCount !== undefined);
  });

  it("the line reader and the async reader give the same entries as the whole-text parser", async () => {
    for (const name of NAMES) {
      const text = fixture(`policy-rules/p14/${name}`);
      const whole = parseUnifiedDiff(text);
      const reader = createUnifiedDiffReader();
      for (const line of text.split(/\r?\n/)) reader.push(line);
      expect(reader.finish(), name).toEqual(whole);
      async function* lines() {
        for (const line of text.split("\n")) yield line;
      }
      expect(await parseUnifiedDiffLinesAsync(lines()), name).toEqual(whole);
    }
  });
});
