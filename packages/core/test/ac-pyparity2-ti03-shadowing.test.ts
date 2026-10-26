import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads aliases, so nothing the build adds
// may run while the file loads. The case directories are written by the build, so the test first checks that each
// holds the binding AC-4 names. A binding that hides nothing must leave the literal match alone; the same case with
// the binding respelled to one that resolves to pytest must match too, which only the build makes true.

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

/** The added lines of a `--unified=0` diff, each with its new line number. */
function added(diff: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let newLine = 0;
  for (const line of linesOf(diff)) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+++") || newLine === 0) continue;
    if (line.startsWith("+")) out.push({ line: newLine++, text: line.slice(1) });
    else if (line.startsWith(" ")) newLine++;
  }
  return out;
}

/** The case with each whole line equal to a key replaced by its value, in the diff's added lines and both texts. */
function replaceLines(c: Case, map: Record<string, string>): Case {
  const swap = (text: string) =>
    linesOf(text)
      .map((line) => map[line] ?? line)
      .join("\n");
  return {
    diff: linesOf(c.diff)
      .map((line) =>
        line.startsWith("+") && !line.startsWith("+++") ? `+${map[line.slice(1)] ?? line.slice(1)}` : line,
      )
      .join("\n"),
    base: c.base.map((f) => ({ path: f.path, text: swap(f.text) })),
    head: c.head.map((f) => ({ path: f.path, text: swap(f.text) })),
  };
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

/** Each AC-4 case: its binding that hides nothing, and a respelling of binding and decorator that resolves to pytest. */
const CASES: { name: string; binding: string; resolving: string; decorator: string }[] = [
  {
    name: "block-pytest-shadow-module",
    binding: "import foo as pytest",
    resolving: "import pytest as pt",
    decorator: "@pt.mark.skip",
  },
  {
    name: "block-pytest-shadow-mark",
    binding: "from foo import mark",
    resolving: "from pytest import mark as mk",
    decorator: "@mk.skip",
  },
];

describe("TI03: a binding that hides nothing never removes a literal match", () => {
  it("AC-4: an added @pytest.mark.skip under `import foo as pytest` or `from foo import mark` gives the one block TI03 the same diff gives with no import at all", async () => {
    for (const spec of CASES) {
      const c = loadCase(spec.name);
      expect(c.diff, spec.name).toContain(`+++ b/${PATH}`);
      for (const side of ["base", "head"] as const) {
        expect(linesOf(textAt(c[side], PATH)), `${spec.name} ${side}: the column-0 binding`).toContain(spec.binding);
      }
      const lines = added(c.diff);
      expect(
        lines.map((a) => a.text),
        `${spec.name}: adds @pytest.mark.skip`,
      ).toEqual(["@pytest.mark.skip"]);
      const head = linesOf(textAt(c.head, PATH));
      const line = (lines[0] as { line: number }).line;
      expect(head[line] ?? "", `${spec.name}: above a def test_`).toMatch(/^def test_\w*\(/);
      expect(linesOf(textAt(c.base, PATH)), `${spec.name}: the test exists at base`).toContain(head[line]);

      const expected = [{ id: "TI03", severity: "block", path: PATH, line }];
      const withBinding = await run(c);
      expect(
        withBinding.map(({ detail: _, ...rest }) => rest),
        `${spec.name}: one block TI03`,
      ).toEqual(expected);
      const blanked = await run(replaceLines(c, { [spec.binding]: "" }));
      expect(withBinding, `${spec.name}: the TI03 of the same diff with the import line blanked`).toEqual(blanked);

      // The same case with a binding that does resolve to pytest and the decorator spelled through it.
      const resolving = await run(
        replaceLines(c, { [spec.binding]: spec.resolving, "@pytest.mark.skip": spec.decorator }),
      );
      expect(resolving, `${spec.name}: ${spec.resolving} and ${spec.decorator} give the same block TI03`).toEqual(
        withBinding,
      );
    }
  });
});
