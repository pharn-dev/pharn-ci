import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, unquote } from "../src/diff/unified.js";
import { fixture } from "./helpers.js";

describe("parseUnifiedDiff", () => {
  it("collects added lines across multiple hunks, ignoring removals", () => {
    expect(parseUnifiedDiff(fixture("diff/modified-multi-hunk.diff"))).toEqual([
      { path: "src/math.ts", oldPath: "src/math.ts", status: "modified", addedLines: [3, 4, 5, 10] },
    ]);
  });

  it("treats every line of a new file as added", () => {
    expect(parseUnifiedDiff(fixture("diff/new-file.diff"))).toEqual([
      { path: "src/new.ts", oldPath: "src/new.ts", status: "added", addedLines: [1, 2, 3, 4] },
    ]);
  });

  it("reports deleted files with no added lines", () => {
    expect(parseUnifiedDiff(fixture("diff/deleted-file.diff"))).toEqual([
      { path: "src/legacy.ts", oldPath: "src/legacy.ts", status: "deleted", addedLines: [] },
    ]);
  });

  it("uses the new path for renames, including pure renames", () => {
    expect(parseUnifiedDiff(fixture("diff/renamed.diff"))).toEqual([
      { path: "src/utils/new-name.ts", oldPath: "src/old-name.ts", status: "renamed", addedLines: [2] },
      { path: "docs/b.md", oldPath: "docs/a.md", status: "renamed", addedLines: [] },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff(fixture("diff/empty.diff"))).toEqual([]);
    expect(parseUnifiedDiff("\n")).toEqual([]);
  });

  it("handles header-like content lines, quoted paths, binary files and context lines", () => {
    expect(parseUnifiedDiff(fixture("diff/tricky.diff"))).toEqual([
      { path: "src/dashes.ts", oldPath: "src/dashes.ts", status: "modified", addedLines: [4, 5] },
      { path: "src/café file.ts", oldPath: "src/café file.ts", status: "modified", addedLines: [1] },
      { path: "assets/logo.png", oldPath: "assets/logo.png", status: "modified", addedLines: [], binary: true },
      { path: "src/context.ts", oldPath: "src/context.ts", status: "modified", addedLines: [11, 12] },
    ]);
  });

  it("parses plain unified diffs without git headers", () => {
    const text = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n-a\n+b\n+c\n--- a/y.ts\n+++ b/y.ts\n@@ -0,0 +5 @@\n+z\n";
    expect(parseUnifiedDiff(text).map((f) => [f.path, f.addedLines])).toEqual([
      ["x.ts", [1, 2]],
      ["y.ts", [5]],
    ]);
  });

  it("handles CRLF line endings", () => {
    const text = fixture("diff/new-file.diff").replace(/\n/g, "\r\n");
    expect(parseUnifiedDiff(text)[0]?.addedLines).toEqual([1, 2, 3, 4]);
  });
});

describe("unquote", () => {
  it("leaves unquoted paths alone", () => {
    expect(unquote("a/b c.ts")).toBe("a/b c.ts");
  });

  it("decodes C escapes and octal UTF-8", () => {
    expect(unquote('"a/tab\\there\\"q\\\\"')).toBe('a/tab\there"q\\');
    expect(unquote('"\\346\\227\\245.ts"')).toBe("日.ts");
  });
});
