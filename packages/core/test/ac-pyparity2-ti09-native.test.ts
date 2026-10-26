import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 reads the native [tool.pytest] table, so
// nothing the build adds may run while the file loads. The case directories are written by the build, so the test
// first checks that each holds the native table and the change AC-13 names. The expected line is the line of the
// changed key under [tool.pytest] in the head text, found here.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09/`;
const PATH = "pyproject.toml";

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

/** The lines of the `[tool.pytest]` table (1-based numbers), up to the next header; throws when there is none. */
function nativeTable(text: string): { line: number; text: string }[] {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^\s*\[tool\.pytest\]\s*(?:#.*)?$/.test(l));
  if (start < 0) throw new Error("no [tool.pytest] table");
  const out: { line: number; text: string }[] = [];
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i] as string); i++) {
    out.push({ line: i + 1, text: lines[i] as string });
  }
  return out;
}

/** The value text of `key` in the native table: its line and every line up to a balanced bracket. */
function nativeValue(text: string, key: string): { line: number; value: string } {
  const table = nativeTable(text);
  const at = table.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l.text));
  if (at < 0) throw new Error(`no ${key} in [tool.pytest]`);
  let value = (table[at] as { text: string }).text.replace(/^[^=]*=/, "");
  let depth = (value.match(/\[/g) ?? []).length - (value.match(/\]/g) ?? []).length;
  for (let i = at + 1; depth > 0 && i < table.length; i++) {
    const t = (table[i] as { text: string }).text;
    value += `\n${t}`;
    depth += (t.match(/\[/g) ?? []).length - (t.match(/\]/g) ?? []).length;
  }
  return { line: (table[at] as { line: number }).line, value: value.trim() };
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
  return (report as unknown as Report).testIntegrity.signals
    .filter((s) => String(s.id) === "TI09")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line }));
}

/** Each AC-13 case: the key it changes and what the base and head values of that key must be. */
const CASES: { name: string; key: string; base: (v: string) => boolean; head: (v: string) => boolean }[] = [
  {
    name: "block-pytest-native-addopts-k",
    key: "addopts",
    base: (v) => v.startsWith("[") && !v.includes('"-k"'),
    head: (v) => v.startsWith("[") && /"-k",\s*"not slow"/.test(v),
  },
  {
    name: "block-pytest-native-addopts-deselect",
    key: "addopts",
    base: (v) => v.startsWith("[") && !v.includes("--deselect"),
    head: (v) => v.startsWith("[") && v.includes('"--deselect=tests/test_a.py::test_x"'),
  },
  {
    name: "block-pytest-native-addopts-ignore",
    key: "addopts",
    base: (v) => /^"[^"]*"$/.test(v) && !v.includes("--ignore"),
    head: (v) => /^"[^"]*"$/.test(v) && v.includes("--ignore=tests/slow"),
  },
  {
    name: "block-pytest-native-testpaths-narrowed",
    key: "testpaths",
    base: (v) => v.replace(/\s/g, "") === '["tests"]',
    head: (v) => v.replace(/\s/g, "") === '["tests/unit"]',
  },
  {
    name: "block-pytest-native-norecursedirs-widened",
    key: "norecursedirs",
    base: (v) => v.startsWith("["),
    head: (v) => v.startsWith("[") && v.split(",").length > 1,
  },
];

describe("TI09 reads pytest 9's native [tool.pytest] table in pyproject.toml", () => {
  it("AC-13: a loosening addopts (array -k, array --deselect, string --ignore), a narrowed testpaths and a widened norecursedirs under [tool.pytest] each give a block TI09 for pyproject.toml at the changed key's head line", async () => {
    for (const spec of CASES) {
      const c = loadCase(spec.name);
      expect(c.diff, spec.name).toContain(`+++ b/${PATH}`);
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      for (const [side, text] of [
        ["base", base],
        ["head", head],
      ] as const) {
        expect(text, `${spec.name} ${side}: no [tool.pytest.ini_options] table`).not.toMatch(
          /^\s*\[tool\.pytest\.ini_options\]/m,
        );
      }
      const before = nativeValue(base, spec.key);
      const after = nativeValue(head, spec.key);
      expect(spec.base(before.value), `${spec.name}: the base ${spec.key} is ${before.value}`).toBe(true);
      expect(spec.head(after.value), `${spec.name}: the head ${spec.key} is ${after.value}`).toBe(true);

      const signals = await run(c);
      expect(signals, `${spec.name}: a block TI09 for ${PATH} at line ${after.line}`).toContainEqual({
        id: "TI09",
        severity: "block",
        path: PATH,
        line: after.line,
      });
    }
  });
});
