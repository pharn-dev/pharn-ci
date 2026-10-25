import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidReport } from "../../core/test/schema.js";

// indexPythonTestSources and check() are loaded inside each test body: the AC tests are written before TI07 exists,
// so nothing the build adds may run while the file loads. The fixtures are written by the build, so each test first
// checks that its fixture text holds the case the AC describes, and derives the expected head line and full name from
// the fixture text. The real interpreter runs, and there is no skip: with no usable python3 the Python index reports
// itself unavailable and the test fails.

const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "tests/test_cart.py";
const SLOW = 60_000;

/** The Python must-trigger cases, the matcher each detail must name, and a text each edited line holds. */
const CASES: Array<{ name: string; matcher: string; holds: RegExp }> = [
  { name: "warn-pytest-eq", matcher: "assert ==", holds: /^\s*assert .+ == -?\d/ },
  { name: "warn-pytest-approx", matcher: "assert ==", holds: /^\s*assert .+ == pytest\.approx\(/ },
  { name: "warn-unittest-assertequal", matcher: "assertEqual", holds: /^\s*self\.assertEqual\(/ },
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
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[]; languages: string[] };
  messages: { code: string; level: string; text: string }[];
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
  const root = `${FIXTURES}test-integrity/TI07/${name}/`;
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

/** The paths the diff names at head (`+++ b/…`), and whether each is a new or deleted file. */
function diffFiles(text: string): Array<{ path: string; status: "added" | "deleted" | "modified" }> {
  const out: Array<{ path: string; status: "added" | "deleted" | "modified" }> = [];
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(\S+) b\/(\S+)$/m.exec(chunk);
    if (header === null) continue;
    const status = /^new file mode/m.test(chunk) ? "added" : /^deleted file mode/m.test(chunk) ? "deleted" : "modified";
    out.push({ path: header[2] as string, status });
  }
  return out;
}

/**
 * The one edited test of the case: the base and head text differ in exactly one line, that line matches `holds` on
 * both sides, and the test is the `def test…` at or above it (inside its class, when one encloses it).
 */
function editedTest(c: Case, holds: RegExp): { line: number; fullName: string } {
  const base = textAt(c.base, PATH).split("\n");
  const head = textAt(c.head, PATH).split("\n");
  expect(head.length, "the edit keeps the line count").toBe(base.length);
  const changed = head.flatMap((line, i) => (line !== base[i] ? [i] : []));
  expect(changed, "exactly one line differs").toHaveLength(1);
  const at = changed[0] as number;
  expect(base[at], "the base line is the assertion").toMatch(holds);
  expect(head[at], "the head line is the assertion").toMatch(holds);
  let def = at;
  while (def >= 0 && !/^\s*def test\w*\(/.test(head[def] ?? "")) def--;
  expect(def, "a test function encloses the edit").toBeGreaterThanOrEqual(0);
  const defLine = head[def] as string;
  const name = /def (test\w*)\(/.exec(defLine)?.[1] as string;
  let fullName = name;
  if (/^\s+/.test(defLine)) {
    let cls = def;
    while (cls >= 0 && !/^class \w+/.test(head[cls] ?? "")) cls--;
    expect(cls, "an indented test sits in a class").toBeGreaterThanOrEqual(0);
    fullName = `${/^class (\w+)/.exec(head[cls] as string)?.[1]} › ${name}`;
  }
  return { line: def + 1, fullName };
}

/** Index the case's Python sources with node-io, then run check() on them in mode block. */
async function runPython(c: Case): Promise<Report> {
  const io = (await import("../src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown, index?: unknown): Promise<{ available: boolean } | undefined>;
  };
  const sources = { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } };
  const pythonTestIndex = await io.indexPythonTestSources(sources);
  expect(pythonTestIndex?.available, "the Python index ran with the real interpreter").toBe(true);

  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: readFileSync(`${FIXTURES}test-files-deleted/coverage.info`, "utf8"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.py"])].sort(),
    testSources: sources,
    pythonTestIndex,
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("TI07 on Python test files, through the Python test index", () => {
  for (const { name, matcher, holds } of CASES) {
    it(
      `AC-2: ${name} in mode block gives one warn TI07 at the edited test's head line naming the ${matcher} matcher, and a warn TEST_INTEGRITY_TI07 message`,
      async () => {
        const c = loadCase(name);
        const files = diffFiles(c.diff);
        expect(files.some((f) => f.path === PATH && f.status === "modified")).toBe(true);
        expect(
          files.some(
            (f) =>
              f.status === "modified" &&
              f.path.endsWith(".py") &&
              f.path !== PATH &&
              !/(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f.path) &&
              !/(^|\/)conftest\.py$/.test(f.path),
          ),
          "a .py source file is modified too",
        ).toBe(true);
        const edited = editedTest(c, holds);

        const report = await runPython(c);
        const ti07 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI07");
        expect(ti07).toHaveLength(1);
        const signal = ti07[0] as Signal;
        expect(signal.severity).toBe("warn");
        expect(signal.path).toBe(PATH);
        expect(signal.line).toBe(edited.line);
        expect(signal.detail).toContain(`"${edited.fullName}"`);
        expect(signal.detail).toContain(`of its ${matcher} assertion`);

        const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07");
        expect(messages).toHaveLength(1);
        expect(messages[0]?.level).toBe("warn");
        expect(messages[0]?.text).toContain(`\`${PATH}\``);
      },
      SLOW,
    );
  }
});
