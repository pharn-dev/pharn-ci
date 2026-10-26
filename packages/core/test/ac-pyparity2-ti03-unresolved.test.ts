import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads aliases, so nothing the build adds
// may run while the file loads. The case directories are written by the build, so the test first checks that each
// holds the binding form AC-5 names, from its own text. The case where the later binding is pytest's must give a block
// TI03, which only the build makes true.

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

/** The column-0 lines of `lines` that bind `pt` by an import statement. */
const columnZeroPtImports = (lines: string[]) =>
  lines.filter((l) => /^(?:import|from)\s/.test(l) && /\bas\s+pt\b|\bimport\s+pt\b/.test(l));

/** The 0-based index of the first line equal to `line`, or -1. */
const at = (lines: string[], line: string) => lines.indexOf(line);

/** Each must-not-trigger case and the check, on its head text, that it holds the form AC-5 names. */
const UNRESOLVED: { name: string; form: (head: string[]) => void }[] = [
  {
    name: "pass-pytest-alias-in-if",
    form: (head) => {
      const i = head.findIndex((l) => /^\s+import pytest as pt$/.test(l));
      expect(i, "an indented import pytest as pt").toBeGreaterThan(0);
      expect(
        head
          .slice(0, i)
          .reverse()
          .find((l) => /^\S/.test(l)) ?? "",
        "inside an if",
      ).toMatch(/^if\b.*:$/);
      expect(columnZeroPtImports(head), "no column-0 binding of pt").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-in-try",
    form: (head) => {
      const i = head.findIndex((l) => /^\s+import pytest as pt$/.test(l));
      expect(i, "an indented import pytest as pt").toBeGreaterThan(0);
      expect(
        head
          .slice(0, i)
          .reverse()
          .find((l) => /^\S/.test(l)) ?? "",
        "inside a try",
      ).toBe("try:");
      expect(columnZeroPtImports(head), "no column-0 binding of pt").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-in-function",
    form: (head) => {
      const i = head.findIndex((l) => /^\s+import pytest as pt$/.test(l));
      expect(i, "an indented import pytest as pt").toBeGreaterThan(0);
      expect(
        head
          .slice(0, i)
          .reverse()
          .find((l) => /^\S/.test(l)) ?? "",
        "inside a function",
      ).toMatch(/^def \w+\(/);
      expect(columnZeroPtImports(head), "no column-0 binding of pt").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-star",
    form: (head) => {
      expect(head, "from pytest import *").toContain("from pytest import *");
      expect(columnZeroPtImports(head), "no column-0 binding of pt").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-assignment",
    form: (head) => {
      expect(head, "import pytest").toContain("import pytest");
      expect(head, "pt = pytest").toContain("pt = pytest");
      expect(columnZeroPtImports(head), "no import binds pt").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-other-module",
    form: (head) => {
      expect(columnZeroPtImports(head), "only import foo as pt binds pt").toEqual(["import foo as pt"]);
    },
  },
  {
    name: "pass-pytest-alias-docstring",
    form: (head) => {
      expect(head[0] ?? "", "a module docstring opens the file").toMatch(/^"""/);
      const close = head.findIndex((l, i) => i > 0 && l.includes('"""'));
      const i = at(head, "import pytest as pt");
      expect(i, "a column-0 import pytest as pt").toBeGreaterThan(0);
      expect(close, "inside the docstring").toBeGreaterThan(i);
      expect(columnZeroPtImports(head.slice(close + 1)), "no binding of pt after the docstring").toEqual([]);
    },
  },
  {
    name: "pass-pytest-alias-replaced",
    form: (head) => {
      expect(columnZeroPtImports(head), "import pytest as pt, then import os as pt").toEqual([
        "import pytest as pt",
        "import os as pt",
      ]);
    },
  },
];

describe("TI03: aliases it does not resolve, a respelling, and the last binding winning", () => {
  it("AC-5: a respelled skip, an alias bound only inside if/try/a function, by import *, by assignment, by another module or in a docstring, and one a later import replaces give no TI03; the reverse order gives one block TI03", async () => {
    // A respelling: the removed @pytest.mark.skip accounts for the added @pt.mark.skip.
    {
      const c = loadCase("pass-pytest-alias-respelled");
      const base = linesOf(textAt(c.base, PATH));
      const head = linesOf(textAt(c.head, PATH));
      expect(base, "base: import pytest").toContain("import pytest");
      expect(head, "head: import pytest as pt").toContain("import pytest as pt");
      const { added, removed } = changes(c.diff);
      expect(removed.map((r) => r.text)).toContain("@pytest.mark.skip");
      expect(added.map((a) => a.text)).toContain("@pt.mark.skip");
      expect(
        removed.filter((r) => r.text.startsWith("@")).map((r) => r.text),
        "one decorator removed",
      ).toEqual(["@pytest.mark.skip"]);
      expect(
        added.filter((a) => a.text.startsWith("@")).map((a) => a.text),
        "one decorator added",
      ).toEqual(["@pt.mark.skip"]);
      expect(await run(c), "pass-pytest-alias-respelled: no TI03").toEqual([]);
    }

    // The unresolved forms: each adds @pt.mark.skip above an existing test and gives no TI03.
    for (const spec of UNRESOLVED) {
      const c = loadCase(spec.name);
      expect(c.diff, spec.name).toContain(`+++ b/${PATH}`);
      const head = linesOf(textAt(c.head, PATH));
      spec.form(head);
      const { added, removed } = changes(c.diff);
      expect(removed, `${spec.name}: nothing removed`).toEqual([]);
      expect(
        added.map((a) => a.text),
        `${spec.name}: adds @pt.mark.skip`,
      ).toEqual(["@pt.mark.skip"]);
      const def = head[(added[0] as { line: number }).line] ?? "";
      expect(def, `${spec.name}: above a def test_`).toMatch(/^def test_\w*\(/);
      expect(linesOf(textAt(c.base, PATH)), `${spec.name}: the test exists at base`).toContain(def);
      expect(await run(c), `${spec.name}: no TI03`).toEqual([]);
    }

    // The reverse order: import os as pt, then import pytest as pt — the later binding is pytest's.
    {
      const c = loadCase("block-pytest-alias-rebound");
      const head = linesOf(textAt(c.head, PATH));
      expect(columnZeroPtImports(head), "import os as pt, then import pytest as pt").toEqual([
        "import os as pt",
        "import pytest as pt",
      ]);
      const { added } = changes(c.diff);
      expect(added.map((a) => a.text)).toEqual(["@pt.mark.skip"]);
      const line = (added[0] as { line: number }).line;
      expect(head[line] ?? "", "above a def test_").toMatch(/^def test_\w*\(/);
      const signals = await run(c);
      expect(
        signals.map(({ detail: _, ...rest }) => rest),
        "block-pytest-alias-rebound: one block TI03",
      ).toEqual([{ id: "TI03", severity: "block", path: PATH, line }]);
    }
  });
});
