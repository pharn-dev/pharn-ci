import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI03 reads aliases, so nothing the build adds
// may run while the file loads. It reuses the AC-1 case directories (written by the build) and runs each three more
// ways: with no testSources, with testSources that hold another file only (one that binds `pt` itself, so an alias
// taken from the wrong file shows), and with only the head side holding the file. Only the last resolves the alias.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI03 = `${FIXTURES}test-integrity/TI03/`;
const PATH = "py/test_cart.py";
const OTHER = {
  path: "py/test_other.py",
  text: "import pytest as pt\nfrom pytest import mark\nfrom pytest import mark as m\n",
};

interface SourceFile {
  path: string;
  text: string;
}
interface Side {
  files: SourceFile[];
  dropped: { path: string; reason: string }[];
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

async function run(
  diff: string,
  testSources: { base: Side; head: Side } | undefined,
  paths: string[],
): Promise<Signal[]> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...paths, "src/cart.ts"])].sort(),
    testIntegrityMode: { input: "block" },
    ...(testSources === undefined ? {} : { testSources }),
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals
    .filter((s) => String(s.id) === "TI03")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line, detail: s.detail }));
}

/** The AC-1 cases: directory, alias prefix of the decorator it adds, and the severity it gives on an existing test. */
const CASES: { name: string; prefix: string; severity: "block" | "warn" }[] = [
  { name: "block-pytest-alias-pt-skip", prefix: "@pt.mark.skip", severity: "block" },
  { name: "warn-pytest-alias-pt-skipif", prefix: "@pt.mark.skipif(", severity: "warn" },
  { name: "warn-pytest-alias-mark-skipif", prefix: "@mark.skipif(", severity: "warn" },
  { name: "warn-pytest-alias-m-xfail", prefix: "@m.xfail(", severity: "warn" },
  { name: "block-pytest-alias-group-skip", prefix: "@m.skip", severity: "block" },
];

const side = (files: SourceFile[]): Side => ({ files, dropped: [] });

describe("TI03 with no text, the wrong text, or one side's text of the test file", () => {
  it("AC-6: without the file's text on either side an aliased decorator gives no TI03 and each literal twin gives what it gives with its text; with only the head text the head's aliases are used and the aliased case gives its twin's TI03", async () => {
    for (const spec of CASES) {
      const alias = loadCase(spec.name);
      const literal = loadCase(`${spec.name}-literal`);
      const lines = added(alias.diff);
      expect(lines, `${spec.name}: one line added`).toHaveLength(1);
      expect((lines[0] as { text: string }).text.startsWith(spec.prefix), `${spec.name}: adds ${spec.prefix}`).toBe(
        true,
      );
      const paths = [PATH];
      const line = (lines[0] as { line: number }).line;

      // The literal twin with its own text: today's single TI03, the reference for every literal run below.
      const twin = await run(literal.diff, { base: side(literal.base), head: side(literal.head) }, paths);
      expect(
        twin.map(({ detail: _, ...rest }) => rest),
        `${spec.name}-literal: one ${spec.severity} TI03`,
      ).toEqual([{ id: "TI03", severity: spec.severity, path: PATH, line }]);

      // 1. No testSources at all.
      expect(await run(alias.diff, undefined, paths), `${spec.name}, no testSources: no TI03`).toEqual([]);
      expect(await run(literal.diff, undefined, paths), `${spec.name}-literal, no testSources: as today`).toEqual(twin);

      // 2. testSources whose sides hold only another file, one that binds pt, mark and m itself.
      const elsewhere = { base: side([OTHER]), head: side([OTHER]) };
      expect(
        await run(alias.diff, elsewhere, [...paths, OTHER.path]),
        `${spec.name}, the file on neither side: no TI03`,
      ).toEqual([]);
      expect(
        await run(literal.diff, elsewhere, [...paths, OTHER.path]),
        `${spec.name}-literal, the file on neither side: as today`,
      ).toEqual(twin);

      // 3. Only the head side holds the file: the head's aliases serve the added line.
      expect(
        await run(alias.diff, { base: side([]), head: side(alias.head) }, paths),
        `${spec.name}, only the head text: the TI03 of its literal twin`,
      ).toEqual(twin);
      expect(
        await run(literal.diff, { base: side([]), head: side(literal.head) }, paths),
        `${spec.name}-literal, only the head text: as today`,
      ).toEqual(twin);
    }
  });
});
