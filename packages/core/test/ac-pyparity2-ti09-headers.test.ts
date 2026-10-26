import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 reads the native [tool.pytest] table, so
// nothing the build adds may run while the file loads. The new case directories are written by the build, so the test
// first checks that each holds the headers and the change AC-15 names; the expected line of each TI09 is found here in
// the head text. The [tool.pytest.ini_options] case is the existing one, and what it gives today is written below.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09/`;
const PATH = "pyproject.toml";
const NATIVE = /^\s*\[tool\.pytest\]\s*(?:#.*)?$/;
const INI = /^\s*\[tool\.pytest\.ini_options\]\s*(?:#.*)?$/;

/** What check() gives at the base commit for the existing block-pyproject-testpaths-narrowed case. */
const INI_OPTIONS_TODAY = [
  {
    id: "TI09",
    severity: "block",
    path: "pyproject.toml",
    line: 5,
    detail: 'testpaths narrowed: ["tests"] → ["tests/unit"].',
    base: '["tests"]',
    head: '["tests/unit"]',
  },
];

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
}
interface Report {
  testIntegrity: { signals: Signal[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  return names
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

function loadCase(name: string): Case {
  const root = `${TI09}${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

const textAt = (files: SourceFile[], path: string) => {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  return file.text;
};
const linesOf = (text: string) => text.split("\n").map((line) => line.replace(/\r$/, ""));

/** The `key = value` line of `key` in the table whose header matches `header`: its 1-based line and value, or null. */
function entry(text: string, header: RegExp, key: string): { line: number; value: string } | null {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => header.test(l));
  if (start < 0) return null;
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i] as string); i++) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(lines[i] as string);
    if (m !== null) return { line: i + 1, value: (m[1] as string).trim() };
  }
  return null;
}

async function run(c: Case): Promise<Signal[]> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

const NARROWED = { base: '["tests"]', head: '["tests/unit"]' };

describe("TI09 tells [tool.pytest] from [tool.pytest.ini_options] and from look-alike headers, and merges both tables", () => {
  it("AC-15: the ini_options change gives what it gives today, the native change its TI09 at the native line, the look-alikes none, and with both tables the native value wins while an ini_options-only key is still read", async () => {
    // 1. Only [tool.pytest.ini_options]: as today.
    {
      const c = loadCase("block-pyproject-testpaths-narrowed");
      expect(await run(c), "block-pyproject-testpaths-narrowed: as at the base commit").toEqual(INI_OPTIONS_TODAY);
    }

    // 2. Only [tool.pytest]: its TI09 at the native key's line.
    {
      const c = loadCase("block-pytest-native-testpaths-narrowed");
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(entry(base, INI, "testpaths"), "no ini_options testpaths").toBeNull();
      expect(entry(base, NATIVE, "testpaths")?.value).toBe(NARROWED.base);
      const native = entry(head, NATIVE, "testpaths");
      expect(native?.value).toBe(NARROWED.head);
      const signals = await run(c);
      expect(signals.map((s) => ({ severity: s.severity, path: s.path, line: s.line }))).toContainEqual({
        severity: "block",
        path: PATH,
        line: native?.line,
      });
    }

    // 3. The look-alikes: testpaths narrowed under a header that is not a pytest table, and no pytest table at all.
    for (const [name, header] of [
      ["pass-pytest-lookalike-pytestx", /^\s*\[tool\.pytestx\]\s*$/],
      ["pass-pytest-lookalike-subtable", /^\s*\[tool\.pytest\.foo\]\s*$/],
      ["pass-pytest-lookalike-array-table", /^\s*\[\[tool\.pytest\]\]\s*$/],
    ] as const) {
      const c = loadCase(name);
      for (const side of ["base", "head"] as const) {
        const text = textAt(c[side], PATH);
        expect(text, `${name} ${side}: no [tool.pytest] table`).not.toMatch(/^\s*\[tool\.pytest\]\s*(?:#.*)?$/m);
        expect(text, `${name} ${side}: no [tool.pytest.ini_options] table`).not.toMatch(
          /^\s*\[tool\.pytest\.ini_options\]/m,
        );
      }
      expect(entry(textAt(c.base, PATH), header, "testpaths")?.value, `${name}: base testpaths`).toBe(NARROWED.base);
      expect(entry(textAt(c.head, PATH), header, "testpaths")?.value, `${name}: head testpaths narrowed`).toBe(
        NARROWED.head,
      );
      expect(await run(c), `${name}: no TI09`).toEqual([]);
    }

    // 4. Both tables hold testpaths; only the native value narrows: a block TI09 at the native line.
    {
      const c = loadCase("block-pytest-both-native-narrowed");
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(entry(base, NATIVE, "testpaths")?.value).toBe(NARROWED.base);
      const native = entry(head, NATIVE, "testpaths");
      expect(native?.value).toBe(NARROWED.head);
      const ini = entry(head, INI, "testpaths");
      expect(ini, "ini_options holds testpaths too").not.toBeNull();
      expect(entry(base, INI, "testpaths")?.value, "the ini_options value is unchanged").toBe(ini?.value);
      const signals = await run(c);
      expect(signals.map((s) => ({ severity: s.severity, path: s.path, line: s.line }))).toContainEqual({
        severity: "block",
        path: PATH,
        line: native?.line,
      });
      expect(
        signals.filter((s) => s.line === ini?.line),
        "nothing at the ini_options line",
      ).toEqual([]);
    }

    // 5. Both tables hold testpaths; only the ini_options value narrows: the native value wins, no TI09.
    {
      const c = loadCase("pass-pytest-both-ini-options-narrowed");
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(entry(base, INI, "testpaths")?.value).toBe(NARROWED.base);
      expect(entry(head, INI, "testpaths")?.value).toBe(NARROWED.head);
      const native = entry(head, NATIVE, "testpaths");
      expect(native, "the native table holds testpaths").not.toBeNull();
      expect(entry(base, NATIVE, "testpaths")?.value, "the native value is unchanged").toBe(native?.value);
      expect(await run(c), "pass-pytest-both-ini-options-narrowed: no TI09").toEqual([]);
    }

    // 6. The native table holds testpaths only; addopts only under ini_options gains -k: a block TI09 at its line.
    {
      const c = loadCase("block-pytest-both-ini-options-addopts");
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(entry(head, NATIVE, "testpaths"), "the native table holds testpaths").not.toBeNull();
      expect(entry(head, NATIVE, "addopts"), "the native table holds no addopts").toBeNull();
      expect(entry(base, INI, "addopts")?.value ?? "", "base addopts has no -k").not.toContain("-k");
      const addopts = entry(head, INI, "addopts");
      expect(addopts?.value ?? "", "head addopts gains -k").toContain("-k");
      const signals = await run(c);
      expect(signals.map((s) => ({ severity: s.severity, path: s.path, line: s.line }))).toContainEqual({
        severity: "block",
        path: PATH,
        line: addopts?.line,
      });
    }
  });
});
