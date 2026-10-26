import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 reads the native [tool.pytest] table, so
// nothing the build adds may run while the file loads. The case directories are written by the build, so the test
// first checks that each holds the native table and the change AC-14 names. A pass case gives no TI09 today only
// because the table is not read, so each is run beside a control: the same table with a change that must trigger
// (the AC-13 case of the same key), which only the build makes true.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09/`;
const PATH = "pyproject.toml";
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}
interface Report {
  testIntegrity: { signals: { id: string; severity: string; path: string; line: number | null }[] };
  messages: { code: string; text: string }[];
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

/** The lines of the `[tool.pytest]` table, up to the next header; throws when there is none. */
function nativeTable(text: string): string[] {
  const lines = linesOf(text);
  const start = lines.findIndex((l) => /^\s*\[tool\.pytest\]\s*(?:#.*)?$/.test(l));
  if (start < 0) throw new Error("no [tool.pytest] table");
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i] as string); i++) out.push(lines[i] as string);
  return out;
}

/** The changed lines of a `--unified=0` diff, without their `+` / `-`. */
function changed(diff: string): { added: string[]; removed: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  let inHunk = false;
  for (const line of linesOf(diff)) {
    if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk || line.startsWith("+++") || line.startsWith("---")) continue;
    else if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

async function run(c: Case): Promise<Report> {
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
  return report as unknown as Report;
}

const ti09 = (r: Report) => r.testIntegrity.signals.filter((s) => String(s.id) === "TI09");
const unavailable = (r: Report) => r.messages.filter((m) => String(m.code) === UNAVAILABLE);

/** Each AC-14 case: what its change must be (on the native table's lines), and its control case. */
const CASES: {
  name: string;
  change: (base: string[], head: string[], diff: ReturnType<typeof changed>) => void;
  control: string;
}[] = [
  {
    name: "pass-pytest-native-testpaths-widened",
    change: (base, head) => {
      expect(base.join("\n").replace(/\s/g, "")).toContain('testpaths=["tests/unit"]');
      expect(head.join("\n").replace(/\s/g, "")).toContain('testpaths=["tests"]');
    },
    control: "block-pytest-native-testpaths-narrowed",
  },
  {
    name: "pass-pytest-native-cacheprovider",
    change: (base, head) => {
      expect(base.join("\n")).not.toContain("no:cacheprovider");
      expect(head.join("\n")).toMatch(/^\s*addopts\s*=\s*\[[^\]]*"-p",\s*"no:cacheprovider"/m);
    },
    control: "block-pytest-native-addopts-k",
  },
  {
    name: "pass-pytest-native-comment",
    change: (_base, _head, diff) => {
      expect(diff.added.length, "a line added").toBeGreaterThan(0);
      for (const line of [...diff.added, ...diff.removed]) expect(line, "only comment lines change").toMatch(/^\s*#/);
    },
    control: "block-pytest-native-addopts-k",
  },
  {
    name: "pass-pytest-native-reformatted",
    change: (base, head) => {
      const value = (lines: string[]) => {
        const text = lines.join("\n");
        const m = /^\s*testpaths\s*=\s*(\[[^\]]*\])/m.exec(text);
        expect(m, "a testpaths array").not.toBeNull();
        return (m as RegExpExecArray)[1] as string;
      };
      expect(value(base), "base: one line").not.toContain("\n");
      expect(value(head), "head: over several lines").toContain("\n");
      expect(value(head), "head: a trailing comma").toMatch(/,\s*\]$/);
      const items = (v: string) =>
        v
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
      expect(items(value(head)), "the same items").toEqual(items(value(base)));
    },
    control: "block-pytest-native-testpaths-narrowed",
  },
  {
    name: "pass-pytest-native-scalars",
    change: (base, head) => {
      expect(base).toContain("log_cli = false");
      expect(head).toContain("log_cli = true");
      expect(base).toContain("faulthandler_timeout = 10");
      expect(head).toContain("faulthandler_timeout = 20");
    },
    control: "block-pytest-native-addopts-k",
  },
];

describe("TI09 on the native [tool.pytest] table: changes that do not loosen", () => {
  it("AC-14: a widened testpaths, -p no:cacheprovider, a comment edit, a multi-line reformat with a trailing comma and changed native booleans and integers under [tool.pytest] give no TI09 and no TEST_INTEGRITY_INDEX_UNAVAILABLE, while the same table with a loosening change gives a block TI09", async () => {
    for (const spec of CASES) {
      const control = loadCase(spec.control);
      const controlReport = await run(control);
      expect(
        ti09(controlReport).some((s) => s.severity === "block" && s.path === PATH),
        `${spec.control}: the control gives a block TI09 (the native table is read)`,
      ).toBe(true);

      const c = loadCase(spec.name);
      expect(c.diff, spec.name).toContain(`+++ b/${PATH}`);
      const base = textAt(c.base, PATH);
      const head = textAt(c.head, PATH);
      expect(base, `${spec.name}: no [tool.pytest.ini_options] table`).not.toMatch(
        /^\s*\[tool\.pytest\.ini_options\]/m,
      );
      spec.change(nativeTable(base), nativeTable(head), changed(c.diff));

      const report = await run(c);
      expect(ti09(report), `${spec.name}: no TI09`).toEqual([]);
      expect(unavailable(report), `${spec.name}: no ${UNAVAILABLE}`).toEqual([]);
    }
  });
});
