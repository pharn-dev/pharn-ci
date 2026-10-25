import { describe, expect, it } from "vitest";

// The parser is loaded inside each test body, so a build that changes its signature cannot break the file at load time.

type Hunk = {
  added: Array<{ line: number; text: string }>;
  removed: Array<{ line: number; text: string }>;
};
type Parsed = { path: string; hunks?: Hunk[]; textTruncated?: boolean };

/** A diff that deletes `tests/big.test.ts` with `lines` removed lines; line 3 is 5000 characters long. */
function deletionOf(lines: number): string[] {
  const out = [
    "diff --git a/tests/big.test.ts b/tests/big.test.ts",
    "deleted file mode 100644",
    "index 3333333..0000000",
    "--- a/tests/big.test.ts",
    "+++ /dev/null",
    `@@ -1,${lines} +0,0 @@`,
  ];
  for (let i = 1; i <= lines; i++)
    out.push(i === 3 ? `-it("${"x".repeat(4990)}", () => {});` : `-it("t${i}", () => {});`);
  return out;
}

type Options = { keepText: (file: { path: string; oldPath: string }) => boolean };
type ParseFn = (text: string, options?: Options) => Parsed[];
type ReaderFn = (options?: Options) => { push(line: string): void; finish(): Parsed[] };

const keepText = (file: { path: string; oldPath: string }) => file.path.startsWith("tests/");

const keptLines = (file: Parsed) =>
  (file.hunks ?? []).reduce((sum, hunk) => sum + hunk.added.length + hunk.removed.length, 0);
const longest = (file: Parsed) =>
  Math.max(0, ...(file.hunks ?? []).flatMap((hunk) => [...hunk.added, ...hunk.removed].map((l) => l.text.length)));

describe("unified diff parser: bounds on the kept text", () => {
  it("AC-3: 6000 removed lines keep at most 5000, each at most 400 characters, and mark the file truncated", async () => {
    const { parseUnifiedDiff, createUnifiedDiffReader } = await import("../src/diff/unified.js");
    const lines = deletionOf(6000);
    const started = performance.now();
    const viaText = (parseUnifiedDiff as unknown as ParseFn)(lines.join("\n"), { keepText });
    const reader = (createUnifiedDiffReader as unknown as ReaderFn)({ keepText });
    for (const line of lines) reader.push(line);
    const viaReader = reader.finish();
    const elapsed = performance.now() - started;

    for (const files of [viaText, viaReader]) {
      const file = files.find((f) => f.path === "tests/big.test.ts");
      expect(file).toBeDefined();
      if (file === undefined) continue;
      expect(keptLines(file)).toBeLessThanOrEqual(5000);
      expect(keptLines(file)).toBeGreaterThan(0);
      expect(longest(file)).toBeLessThanOrEqual(400);
      expect(file.textTruncated).toBe(true);
    }
    // Both parses of the 6000-line diff together stay well inside the budget of one second.
    expect(elapsed).toBeLessThan(1000);
  });

  it("AC-3: a 100-line deletion of the same shape is kept whole and is not marked truncated", async () => {
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    const files = (parseUnifiedDiff as unknown as ParseFn)(deletionOf(100).join("\n"), { keepText });
    const file = files.find((f) => f.path === "tests/big.test.ts");
    expect(file).toBeDefined();
    if (file === undefined) return;
    expect(keptLines(file)).toBe(100);
    expect(longest(file)).toBeLessThanOrEqual(400);
    expect("textTruncated" in file).toBe(false);
  });
});
