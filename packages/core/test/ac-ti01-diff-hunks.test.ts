import { describe, expect, it } from "vitest";

// parseUnifiedDiff() and createUnifiedDiffReader() are loaded inside each test body, so a build that changes their
// signature cannot break the file at load time.

const DIFF = [
  "diff --git a/src/m.ts b/src/m.ts",
  "index 1111111..2222222 100644",
  "--- a/src/m.ts",
  "+++ b/src/m.ts",
  "@@ -1,2 +1,2 @@",
  " export const a = 1;",
  "-export const b = 2;",
  "+export const b = 3;",
  "diff --git a/tests/d.test.ts b/tests/d.test.ts",
  "deleted file mode 100644",
  "index 3333333..0000000",
  "--- a/tests/d.test.ts",
  "+++ /dev/null",
  "@@ -1,2 +0,0 @@",
  '-import { it } from "vitest";',
  '-it("d", () => {});',
  "diff --git a/tests/n.test.ts b/tests/n.test.ts",
  "new file mode 100644",
  "index 0000000..4444444",
  "--- /dev/null",
  "+++ b/tests/n.test.ts",
  "@@ -0,0 +1,2 @@",
  '+import { it } from "vitest";',
  '+it("n", () => {});',
  "diff --git a/tests/__init__.py b/tests/__init__.py",
  "deleted file mode 100644",
  "index 5555555..0000000",
  "",
].join("\n");

const keepText = (file: { path: string; oldPath: string }) => file.path.startsWith("tests/");

type Hunk = {
  added: Array<{ line: number; text: string }>;
  removed: Array<{ line: number; text: string }>;
};
type WithHunks = { path: string; addedLines: number[]; hunks?: Hunk[] };

type Options = { keepText: typeof keepText };
type ParseFn = (text: string, options?: Options) => WithHunks[];
type ReaderFn = (options?: Options) => { push(line: string): void; finish(): WithHunks[] };

async function parse(options?: Options) {
  const { parseUnifiedDiff } = await import("../src/diff/unified.js");
  return (parseUnifiedDiff as unknown as ParseFn)(DIFF, options);
}

function expectKept(files: WithHunks[], label: string) {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const deleted = byPath.get("tests/d.test.ts");
  expect(deleted?.hunks, label).toHaveLength(1);
  expect(deleted?.hunks?.[0]?.removed, label).toEqual([
    { line: 1, text: 'import { it } from "vitest";' },
    { line: 2, text: 'it("d", () => {});' },
  ]);
  expect(deleted?.hunks?.[0]?.added, label).toEqual([]);

  const added = byPath.get("tests/n.test.ts");
  expect(added?.hunks?.[0]?.added, label).toEqual([
    { line: 1, text: 'import { it } from "vitest";' },
    { line: 2, text: 'it("n", () => {});' },
  ]);

  const modified = byPath.get("src/m.ts");
  expect(modified, label).toBeDefined();
  expect(modified && "hunks" in modified, label).toBe(false);

  // A selected file with no hunk at all (an empty file deleted) says so with an empty list.
  expect(byPath.get("tests/__init__.py")?.hunks, label).toEqual([]);
}

describe("unified diff parser: line text per hunk", () => {
  it("AC-2: parseUnifiedDiff keeps added and removed text with line numbers for the selected files only", async () => {
    const files = await parse({ keepText });
    expectKept(files, "parseUnifiedDiff");
  });

  it("AC-2: addedLines of every file equal what a parse without the option returns", async () => {
    const plain = await parse();
    const withText = await parse({ keepText });
    expect(
      withText.some((f) => "hunks" in f),
      "the option keeps text",
    ).toBe(true);
    expect(withText.map((f) => [f.path, f.addedLines])).toEqual(plain.map((f) => [f.path, f.addedLines]));
    for (const file of plain) expect("hunks" in file, file.path).toBe(false);
  });

  it("AC-2: the line-by-line reader gives the same result", async () => {
    const { createUnifiedDiffReader } = await import("../src/diff/unified.js");
    const reader = (createUnifiedDiffReader as unknown as ReaderFn)({ keepText });
    for (const line of DIFF.split("\n")) reader.push(line);
    expectKept(reader.finish(), "createUnifiedDiffReader");
  });
});
