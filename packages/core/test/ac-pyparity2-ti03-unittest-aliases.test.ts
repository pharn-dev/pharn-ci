import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads aliases, so nothing the build adds
// may run while the file loads. The case directories are written by the build, so the test first checks that each
// holds the imports and decorators AC-2 names and that its literal twin spells each decorator `@unittest.<name>`.
// The severity of each decorator is written here, not read from the fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI03 = `${FIXTURES}test-integrity/TI03/`;
const PATH = "py/test_cart.py";

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
  detail: string;
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
  const root = `${TI03}${name}/`;
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

/** The added and removed lines of a `--unified=0` diff, each with its new (added) or old (removed) line number. */
function changes(diff: string): { added: { line: number; text: string }[]; removed: { line: number; text: string }[] } {
  const added: { line: number; text: string }[] = [];
  const removed: { line: number; text: string }[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const line of linesOf(diff)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---") || oldLine === 0) continue;
    if (line.startsWith("+")) added.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith("-")) removed.push({ line: oldLine++, text: line.slice(1) });
    else if (line.startsWith(" ")) {
      oldLine++;
      newLine++;
    }
  }
  return { added, removed };
}

const diffShape = (diff: string) =>
  linesOf(diff).map((line) => (line.startsWith("@@") ? line.slice(0, line.indexOf("@@", 2) + 2) : line));

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
    .filter((s) => String(s.id) === "TI03")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line, detail: s.detail }));
}

/** Each aliased decorator AC-2 names: its spelling, its literal twin's spelling, and its severity on an existing test. */
const DECORATORS: { alias: string; literal: string; severity: "block" | "warn" }[] = [
  { alias: '@skip("r")', literal: '@unittest.skip("r")', severity: "block" },
  { alias: "@si(", literal: "@unittest.skipIf(", severity: "warn" },
  { alias: "@skipUnless(", literal: "@unittest.skipUnless(", severity: "warn" },
  { alias: "@ef", literal: "@unittest.expectedFailure", severity: "block" },
  { alias: "@ut.expectedFailure", literal: "@unittest.expectedFailure", severity: "block" },
];

const CASES: { name: string; imports: string[]; decorators: string[] }[] = [
  {
    name: "block-unittest-alias-from",
    imports: ["from unittest import skip, skipIf as si, skipUnless, expectedFailure as ef"],
    decorators: ['@skip("r")', "@si(", "@skipUnless(", "@ef"],
  },
  { name: "block-unittest-alias-module", imports: ["import unittest as ut"], decorators: ["@ut.expectedFailure"] },
];

/** The decorator spec an added line is, matched exactly on `@ef` / `@ut.expectedFailure`, by prefix otherwise. */
function decoratorOf(text: string) {
  const trimmed = text.trim();
  return DECORATORS.find((d) =>
    d.alias.endsWith("(") || d.alias.endsWith(")") ? trimmed.startsWith(d.alias) : trimmed === d.alias,
  );
}

describe("TI03: unittest skip and expectedFailure decorator aliases", () => {
  it("AC-2: each aliased unittest decorator above an existing test method gives the TI03 signals of its literal @unittest.<decorator> twin, block for skip and expectedFailure, warn for skipIf and skipUnless", async () => {
    for (const spec of CASES) {
      const alias = loadCase(spec.name);
      const literal = loadCase(`${spec.name}-literal`);
      expect(alias.diff, spec.name).toContain(`+++ b/${PATH}`);
      const head = linesOf(textAt(alias.head, PATH));
      const base = linesOf(textAt(alias.base, PATH));
      for (const line of spec.imports) {
        expect(head, `${spec.name}: the head text holds the column-0 import ${line}`).toContain(line);
        expect(base, `${spec.name}: the base text holds the column-0 import ${line}`).toContain(line);
      }

      const { added, removed } = changes(alias.diff);
      expect(removed, `${spec.name}: nothing removed`).toEqual([]);
      expect(
        added.map((a) => decoratorOf(a.text)?.alias),
        `${spec.name}: adds exactly the decorators AC-2 names, in order`,
      ).toEqual(spec.decorators);
      for (const a of added) {
        expect(head[a.line - 1], `${spec.name}: the head text holds ${a.text.trim()} at its line`).toBe(a.text);
        const def = head[a.line] ?? "";
        expect(def, `${spec.name}: a test method under ${a.text.trim()}`).toMatch(/^\s+def test_\w*\(self/);
        expect(base, `${spec.name}: the method exists at base`).toContain(def);
      }

      // The twin: the same diff with each decorator spelled @unittest.<decorator>.
      const twinOf = (text: string) => {
        const d = decoratorOf(text) as (typeof DECORATORS)[number];
        const indent = text.slice(0, text.length - text.trimStart().length);
        return `${indent}${d.literal}${text.trim().slice(d.alias.length)}`;
      };
      const addedTexts = new Map(added.map((a) => [`+${a.text}`, `+${twinOf(a.text)}`]));
      expect(diffShape(literal.diff), `${spec.name}-literal: the same diff with the literal decorators`).toEqual(
        diffShape(alias.diff).map((line) => addedTexts.get(line) ?? line),
      );
      const literalHead = linesOf(textAt(literal.head, PATH));
      expect(literalHead.length, `${spec.name}-literal: the same number of lines`).toBe(head.length);
      expect(literalHead, `${spec.name}-literal: imports unittest`).toContain("import unittest");

      const expected = added.map((a) => ({
        id: "TI03",
        severity: (decoratorOf(a.text) as (typeof DECORATORS)[number]).severity,
        path: PATH,
        line: a.line,
      }));
      const twin = await run(literal);
      expect(
        twin.map(({ detail: _, ...rest }) => rest),
        `${spec.name}-literal: one TI03 per decorator, of its severity`,
      ).toEqual(expected);
      expect(await run(alias), `${spec.name}: the TI03 signals of its literal twin`).toEqual(twin);
    }
  });
});
