import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads @unittest.expectedFailure and
// pytest.xfail(, so nothing the build adds may run while the file loads. The case directories are written by the
// build, so the test first checks that each holds the form AC-3 names. The detail each form must carry is the one
// today's form of the same category gives (@unittest.skip, pytest.skip), observed on the same diff with only that
// line respelled.

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

/** The case with every added line that holds `from` holding `to` instead, in the diff and the head text. */
function respell(c: Case, from: string, to: string): Case {
  const swap = (text: string) =>
    linesOf(text)
      .map((line) => (line.includes(from) ? line.split(from).join(to) : line))
      .join("\n");
  return {
    diff: linesOf(c.diff)
      .map((line) => (line.startsWith("+") && !line.startsWith("+++") ? swap(line) : line))
      .join("\n"),
    base: c.base,
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

/** The innermost `def test_` above line `line` (1-based) of `lines`, by indentation. */
function enclosingTest(lines: string[], line: number): string | undefined {
  const indent = (lines[line - 1] ?? "").length - (lines[line - 1] ?? "").trimStart().length;
  for (let i = line - 2; i >= 0; i--) {
    const l = lines[i] as string;
    if (l.trim() === "") continue;
    const own = l.length - l.trimStart().length;
    if (own < indent && /^\s*def test_\w*\(/.test(l)) return l;
    if (own === 0 && !/^\s*def /.test(l)) return undefined;
  }
  return undefined;
}

describe("TI03: @unittest.expectedFailure and pytest.xfail( are read, literal and aliased", () => {
  it('AC-3: @unittest.expectedFailure gives a block TI03 on an existing test and a warn one on a new test, as @unittest.skip does; pytest.xfail("r"), sk("r") and xfail("r") in an existing test\'s body each give one warn TI03 with pytest.skip\'s in-body detail', async () => {
    // 1. @unittest.expectedFailure above a test that exists at base: block, with @unittest.skip's detail.
    {
      const c = loadCase("block-unittest-expected-failure");
      const { added, removed } = changes(c.diff);
      expect(removed).toEqual([]);
      expect(added.map((a) => a.text.trim())).toEqual(["@unittest.expectedFailure"]);
      const head = linesOf(textAt(c.head, PATH));
      const def = head[(added[0] as { line: number }).line] ?? "";
      expect(def, "a test under the decorator").toMatch(/^\s*def test_\w*\(/);
      expect(linesOf(textAt(c.base, PATH)), "the test exists at base").toContain(def);

      const asSkip = await run(respell(c, "@unittest.expectedFailure", '@unittest.skip("r")'));
      expect(asSkip, "@unittest.skip on the same line: one block TI03").toHaveLength(1);
      expect(asSkip[0]?.severity).toBe("block");
      const signals = await run(c);
      expect(signals, "one block TI03 with @unittest.skip's detail").toEqual(asSkip);
      expect(signals[0]).toMatchObject({ path: PATH, line: (added[0] as { line: number }).line, severity: "block" });
    }

    // 2. The same decorator directly above a def test_ added at head: warn, with @unittest.skip's detail.
    {
      const c = loadCase("warn-unittest-expected-failure-new-test");
      const { added } = changes(c.diff);
      const at = added.findIndex((a) => a.text.trim() === "@unittest.expectedFailure");
      expect(at, "adds @unittest.expectedFailure").toBeGreaterThanOrEqual(0);
      const def = added[at + 1];
      expect(def?.text ?? "", "directly above an added def test_").toMatch(/^\s*def test_\w*\(/);
      expect(linesOf(textAt(c.base, PATH)), "the test is new at head").not.toContain(def?.text);

      const asSkip = await run(respell(c, "@unittest.expectedFailure", '@unittest.skip("r")'));
      expect(asSkip, "@unittest.skip on the same line: one warn TI03").toHaveLength(1);
      expect(asSkip[0]?.severity).toBe("warn");
      const signals = await run(c);
      expect(signals, "one warn TI03 with @unittest.skip's detail").toEqual(asSkip);
      expect(signals[0]).toMatchObject({ path: PATH, line: (added[at] as { line: number }).line, severity: "warn" });
    }

    // 3. pytest.xfail("r") added in an existing test's body: warn, with pytest.skip's in-body detail.
    {
      const c = loadCase("warn-pytest-xfail-call");
      const { added, removed } = changes(c.diff);
      expect(removed).toEqual([]);
      expect(added.map((a) => a.text.trim())).toEqual(['pytest.xfail("r")']);
      const head = linesOf(textAt(c.head, PATH));
      const test = enclosingTest(head, (added[0] as { line: number }).line);
      expect(test, "inside a def test_").toBeDefined();
      expect(linesOf(textAt(c.base, PATH)), "the test exists at base").toContain(test);

      const asSkip = await run(respell(c, "pytest.xfail(", "pytest.skip("));
      expect(asSkip, "pytest.skip on the same line: one warn TI03").toHaveLength(1);
      expect(asSkip[0]?.severity).toBe("warn");
      expect(await run(c), "one warn TI03 with pytest.skip's in-body detail").toEqual(asSkip);
    }

    // 4. With `from pytest import skip as sk, xfail`: sk("r") and xfail("r"), each in a different existing test.
    {
      const c = loadCase("warn-pytest-alias-skip-xfail-calls");
      const head = linesOf(textAt(c.head, PATH));
      expect(head, "the column-0 import").toContain("from pytest import skip as sk, xfail");
      const { added, removed } = changes(c.diff);
      expect(removed).toEqual([]);
      expect(added.map((a) => a.text.trim())).toEqual(['sk("r")', 'xfail("r")']);
      const tests = added.map((a) => enclosingTest(head, a.line));
      expect(tests[0], "sk inside a def test_").toBeDefined();
      expect(tests[1], "xfail inside a def test_").toBeDefined();
      expect(tests[0], "in different tests").not.toBe(tests[1]);
      for (const test of tests) expect(linesOf(textAt(c.base, PATH)), "the test exists at base").toContain(test);

      const literal = respell(respell(c, 'sk("r")', 'pytest.skip("r")'), 'xfail("r")', 'pytest.skip("r")');
      const asSkip = await run(literal);
      expect(asSkip, "pytest.skip on both lines: two warn TI03").toHaveLength(2);
      for (const s of asSkip) expect(s.severity).toBe("warn");
      const signals = await run(c);
      expect(signals, "two warn TI03 with pytest.skip's in-body detail").toEqual(asSkip);
      expect(signals.map((s) => s.line)).toEqual(added.map((a) => a.line));
    }
  });
});
