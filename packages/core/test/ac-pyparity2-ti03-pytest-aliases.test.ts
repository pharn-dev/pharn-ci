import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads aliases, so nothing the build adds
// may run while the file loads. The case directories are written by the build, so the test first checks that each
// one holds the import and the decorator AC-1 names, and that its literal twin differs only in the import and the
// decorator's spelling. The expected severity of each case is written here, not read from the fixture.

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

/** The diff with each hunk header cut to its ranges (the function context after the second `@@` may differ). */
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

/** Each AC-1 case: its directory, the import lines its head text holds, the alias prefix, the marker, the severity. */
const CASES: { name: string; imports: string[]; prefix: string; marker: string; severity: "block" | "warn" }[] = [
  {
    name: "block-pytest-alias-pt-skip",
    imports: ["import pytest as pt"],
    prefix: "@pt.mark.",
    marker: "skip",
    severity: "block",
  },
  {
    name: "warn-pytest-alias-pt-skipif",
    imports: ["import pytest as pt"],
    prefix: "@pt.mark.",
    marker: "skipif",
    severity: "warn",
  },
  {
    name: "warn-pytest-alias-mark-skipif",
    imports: ["from pytest import mark"],
    prefix: "@mark.",
    marker: "skipif",
    severity: "warn",
  },
  {
    name: "warn-pytest-alias-m-xfail",
    imports: ["from pytest import mark as m"],
    prefix: "@m.",
    marker: "xfail",
    severity: "warn",
  },
  {
    name: "block-pytest-alias-group-skip",
    imports: ["from pytest import (", "    mark as m,", "    skip,", ")"],
    prefix: "@m.",
    marker: "skip",
    severity: "block",
  },
];

/** Checks the case holds what AC-1 describes; returns the added decorator line and its new line number. */
function expectAliasCase(c: Case, spec: (typeof CASES)[number]): { line: number; text: string } {
  expect(c.diff, spec.name).toContain(`+++ b/${PATH}`);
  const head = linesOf(textAt(c.head, PATH));
  const base = linesOf(textAt(c.base, PATH));
  const at = head.indexOf(spec.imports[0] as string);
  expect(at, `${spec.name}: the head text holds the column-0 import ${spec.imports[0]}`).toBeGreaterThanOrEqual(0);
  expect(head.slice(at, at + spec.imports.length), `${spec.name}: the import lines`).toEqual(spec.imports);
  expect(base.slice(at, at + spec.imports.length), `${spec.name}: the base text holds the same import`).toEqual(
    spec.imports,
  );
  const { added, removed } = changes(c.diff);
  expect(removed, `${spec.name}: nothing removed`).toEqual([]);
  expect(added, `${spec.name}: one line added`).toHaveLength(1);
  const decorator = added[0] as { line: number; text: string };
  expect(
    decorator.text.startsWith(`${spec.prefix}${spec.marker}`),
    `${spec.name}: adds ${spec.prefix}${spec.marker}`,
  ).toBe(true);
  const rest = decorator.text.slice(`${spec.prefix}${spec.marker}`.length);
  expect(rest === "" || rest.startsWith("("), `${spec.name}: the marker is ${spec.marker} exactly`).toBe(true);
  if (spec.severity === "warn")
    expect(rest, `${spec.name}: a condition is passed`).toMatch(/^\([^"')][^)]*,\s*reason=/);
  expect(head[decorator.line - 1], `${spec.name}: the head text holds the decorator at its line`).toBe(decorator.text);
  const def = head[decorator.line] ?? "";
  expect(def, `${spec.name}: a def test_ under the decorator`).toMatch(/^def test_\w*\(/);
  expect(base, `${spec.name}: the def exists at base`).toContain(def);
  return decorator;
}

describe("TI03: pytest marker aliases from the test file's own top-level imports", () => {
  it("AC-1: each aliased pytest skip, skipif or xfail decorator above an existing test gives exactly the TI03 signals of its literal twin, block when unconditional and warn when conditional", async () => {
    for (const spec of CASES) {
      const alias = loadCase(spec.name);
      const literal = loadCase(`${spec.name}-literal`);
      const decorator = expectAliasCase(alias, spec);

      // The twin: `import pytest` (padded so every other line keeps its number) and `@pytest.mark.<marker>`.
      const twinDecorator = `@pytest.mark.${decorator.text.slice(spec.prefix.length)}`;
      expect(diffShape(literal.diff), `${spec.name}-literal: the same diff with the literal decorator`).toEqual(
        diffShape(alias.diff).map((line) => (line === `+${decorator.text}` ? `+${twinDecorator}` : line)),
      );
      for (const side of ["base", "head"] as const) {
        const a = linesOf(textAt(alias[side], PATH));
        const l = linesOf(textAt(literal[side], PATH));
        expect(l.length, `${spec.name}-literal ${side}: the same number of lines`).toBe(a.length);
        const at = a.indexOf(spec.imports[0] as string);
        expect(l[at], `${spec.name}-literal ${side}: import pytest where the alias import was`).toBe("import pytest");
        a.forEach((line, i) => {
          if (i >= at && i < at + spec.imports.length) {
            if (i > at) expect(l[i], `${spec.name}-literal ${side}: line ${i + 1} is padding`).toBe("");
          } else if (side === "head" && i === decorator.line - 1) {
            expect(l[i], `${spec.name}-literal head: the literal decorator`).toBe(twinDecorator);
          } else {
            expect(l[i], `${spec.name}-literal ${side}: line ${i + 1} as in the alias case`).toBe(line);
          }
        });
      }

      const expected = [{ id: "TI03", severity: spec.severity, path: PATH, line: decorator.line }];
      const twin = await run(literal);
      expect(
        twin.map(({ detail: _, ...rest }) => rest),
        `${spec.name}-literal: one ${spec.severity} TI03 at the decorator`,
      ).toEqual(expected);
      const aliased = await run(alias);
      expect(aliased, `${spec.name}: the TI03 signals of its literal twin`).toEqual(twin);
    }
  });
});
