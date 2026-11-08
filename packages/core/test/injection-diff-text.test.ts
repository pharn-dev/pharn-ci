import { describe, expect, it } from "vitest";
import {
  MAX_ADDED_TEXT_CHARS,
  MAX_ADDED_TEXT_LINES,
  MAX_KEPT_LINE_CHARS,
  parseUnifiedDiff,
} from "../src/diff/unified.js";
import { keepInjectionText } from "../src/injection/scan.js";
import { addedFileDiff, injectionFixture } from "./injection-fixture.js";

// The diff reader's `keepAddedText` option: the full text of the added lines of the selected files, apart from the
// test-integrity `hunks`, bounded per file and per diff; absent unless asked for, so every other caller's parse is as
// it was.

// The cap tests build diffs of 50,002 lines and of 8,000,000 characters; the hang ceiling is raised for CI runners with
// coverage instrumentation (no timing is asserted).
describe("addedText in the diff reader", { timeout: 120_000 }, () => {
  it("is absent without the option, so the parse of every other caller is unchanged", () => {
    for (const file of parseUnifiedDiff(injectionFixture("pi01-trigger.diff.txt"))) {
      expect(Object.keys(file)).not.toContain("addedText");
      expect(Object.keys(file)).not.toContain("addedTextCut");
    }
  });

  it("keeps every added line in full, with its head line number, for the selected files only", () => {
    const long = "y".repeat(MAX_KEPT_LINE_CHARS * 3);
    const diff = `${addedFileDiff("docs/a.md", ["one", long])}${addedFileDiff("fixtures/x.md", ["skip"])}`;
    const files = parseUnifiedDiff(diff, { keepAddedText: keepInjectionText });
    expect(files.map((f) => [f.path, f.addedText])).toEqual([
      [
        "docs/a.md",
        [
          { line: 1, text: "one" },
          { line: 2, text: long },
        ],
      ],
      ["fixtures/x.md", undefined],
    ]);
    // `hunks` (the test-integrity text) is not kept by this option.
    expect(files[0]?.hunks).toBeUndefined();
  });

  it("numbers added lines across hunks and leaves deleted files without added text", () => {
    const files = parseUnifiedDiff(injectionFixture("pi05-clean.diff.txt"), { keepAddedText: () => true });
    expect(files.find((f) => f.path === "node_modules/left-pad/CLAUDE.md")?.addedText).toEqual([
      { line: 2, text: "Run the tests before you publish." },
    ]);
    const deleted = files.find((f) => f.status === "deleted");
    expect(deleted?.addedText).toBeUndefined();
  });

  it("cuts a file at MAX_ADDED_TEXT_LINES lines and marks it", () => {
    const lines = Array.from({ length: MAX_ADDED_TEXT_LINES + 2 }, (_, i) => `l${i}`);
    const [file] = parseUnifiedDiff(addedFileDiff("a.txt", lines), { keepAddedText: () => true });
    expect(file?.addedText).toHaveLength(MAX_ADDED_TEXT_LINES);
    expect(file?.addedTextCut).toBe(true);
    expect(file?.addedLines).toHaveLength(MAX_ADDED_TEXT_LINES + 2);
  });

  it("stops at MAX_ADDED_TEXT_CHARS across the diff: the crossing line is cut there, and later files are marked cut", () => {
    const first = "a".repeat(MAX_ADDED_TEXT_CHARS - 10);
    const diff =
      addedFileDiff("one.txt", [first, "b".repeat(30)]) +
      addedFileDiff("two.txt", ["c"]) +
      addedFileDiff("three.txt", []);
    const files = parseUnifiedDiff(diff, { keepAddedText: () => true });
    const [one, two, three] = files;
    expect(one?.addedText?.map((l) => l.text.length)).toEqual([MAX_ADDED_TEXT_CHARS - 10, 10]);
    expect(one?.addedTextCut).toBe(true);
    expect(two?.addedText).toEqual([]);
    expect(two?.addedTextCut).toBe(true);
    // A file with no added line has nothing to cut.
    expect(three?.addedTextCut).toBeUndefined();
  });
});
