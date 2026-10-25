import { describe, expect, it } from "vitest";

// The selector and the parser are loaded inside the test body: the AC tests are written before TI10 and TI13 exist,
// so nothing the build adds may run while the file loads.

type Line = { line: number; text: string };
type Parsed = { path: string; hunks?: Array<{ added: Line[]; removed: Line[] }>; textTruncated?: boolean };
type KeepText = (file: { path: string; oldPath: string }) => boolean;
type ParseFn = (text: string, options?: { keepText?: KeepText }) => Parsed[];
type SelectorFactory = (configPath?: string, repoRoot?: string) => KeepText;

/** A modified file whose one hunk removes `removed` at line `at` and adds `added` in its place. */
function edit(path: string, at: number, removed: string[], added: string[]): string[] {
  const oldPart = removed.length === 0 ? `${at - 1},0` : `${at},${removed.length}`;
  const newPart = added.length === 0 ? `${at - 1},0` : `${at},${added.length}`;
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldPart} +${newPart} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ];
}

/** The fourteen files of the criterion, each with one removed and one added line of its own. */
const FILES: Array<[path: string, removed: string, added: string]> = [
  ["package.json", '    "test": "vitest run",', '    "test": "vitest run || true",'],
  ["packages/api/package.json", '    "test:unit": "vitest run",', '    "test:unit": "vitest run -t adds",'],
  ["package-lock.json", '      "version": "1.0.0",', '      "version": "1.0.1",'],
  ["src/app.ts", "export const a = 1;", "export const a = 2;"],
  ["src/a.mts", "export const m = 1;", "export const m = 2;"],
  ["lib/b.cts", "module.exports = 1;", "module.exports = 2;"],
  ["src/c.jsx", "export const C = () => <p>one</p>;", "export const C = () => <p>two</p>;"],
  ["tools/run.py", "    return 1", "    return 2"],
  ["README.md", "Old readme line.", "New readme line."],
  ["docs/guide.md", "Old guide line.", "New guide line."],
  [".github/dependabot.yml", "    interval: weekly", "    interval: daily"],
  ["src/a.test.ts", "it('adds', () => {", "it('adds two', () => {"],
  [".pharn/ci.yml", "threshold: 80", "threshold: 85"],
  [".github/workflows/ci.yml", "      - run: pnpm test", "      - run: pnpm test --silent"],
];

const KEPT = [
  "package.json",
  "packages/api/package.json",
  "src/app.ts",
  "src/a.mts",
  "lib/b.cts",
  "src/c.jsx",
  "tools/run.py",
  "src/a.test.ts",
  ".pharn/ci.yml",
  ".github/workflows/ci.yml",
];
const NOT_KEPT = ["package-lock.json", "README.md", "docs/guide.md", ".github/dependabot.yml"];

const texts = (file: Parsed) => ({
  added: (file.hunks ?? []).flatMap((h) => h.added.map((l) => l.text)),
  removed: (file.hunks ?? []).flatMap((h) => h.removed.map((l) => l.text)),
});

describe("the diff reader keeps the text of package.json and source files", () => {
  it("AC-1: package.json files, JS/TS and Python sources keep their line text within the existing bounds; lockfile, Markdown and dependabot keep none", async () => {
    const core = (await import("@pharn-ci/core")) as unknown as Record<string, unknown>;
    const factory = core.keepSignalFileText as SelectorFactory;
    expect(typeof factory).toBe("function");
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    const parse = parseUnifiedDiff as unknown as ParseFn;
    const keepText = factory();

    const lines = FILES.flatMap(([path, removed, added]) => edit(path, 7, [removed], [added]));
    const files = parse(`${lines.join("\n")}\n`, { keepText });
    const byPath = new Map(files.map((f) => [f.path, f]));

    for (const path of KEPT) {
      const file = byPath.get(path);
      expect(file, path).toBeDefined();
      const [, removed, added] = FILES.find(([p]) => p === path) as [string, string, string];
      expect(texts(file as Parsed), path).toEqual({ added: [added], removed: [removed] });
      expect((file as Parsed).textTruncated, path).toBeUndefined();
    }
    for (const path of NOT_KEPT) {
      const file = byPath.get(path);
      expect(file, path).toBeDefined();
      expect(texts(file as Parsed), path).toEqual({ added: [], removed: [] });
    }

    // A selected source file with 5001 changed lines is cut and marked; a kept line of 500 characters is cut to 400.
    const big = Array.from({ length: 5001 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
    const long = `export const s = "${"x".repeat(500 - 'export const s = "";'.length)}";`;
    expect(long.length).toBe(500);
    const capped = parse(`${[...edit("src/big.ts", 1, [], big), ...edit("src/long.ts", 3, [], [long])].join("\n")}\n`, {
      keepText,
    });
    const bigFile = capped.find((f) => f.path === "src/big.ts") as Parsed;
    expect(bigFile).toBeDefined();
    expect(bigFile.textTruncated).toBe(true);
    const keptBig = texts(bigFile).added.length + texts(bigFile).removed.length;
    expect(keptBig).toBeGreaterThan(0);
    expect(keptBig).toBeLessThanOrEqual(5000);

    const longFile = capped.find((f) => f.path === "src/long.ts") as Parsed;
    expect(longFile).toBeDefined();
    const [keptLong] = texts(longFile).added;
    expect(keptLong).toBe(long.slice(0, 400));
  });
});
