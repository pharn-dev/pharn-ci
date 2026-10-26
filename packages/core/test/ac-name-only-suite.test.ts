import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// git, check() and the fixtures run inside the test body: the AC test is written before the build changes TI01's
// same-stem rule and TI02's phase-2 leaf pick. git reads this increment's own change: from the base commit 8302706 to
// the working tree while this file is not committed, then the commit that added this file (CI checks out the full
// history). The base side of every comparison is check() as the start of that range had it: its packages/core/src is
// extracted with `git archive` into a temp directory (its node_modules linked to this one's, for the TypeScript parser)
// and run on the same inputs. The head side is this working tree's check() while the file is not committed, else the
// adding commit's, extracted the same way, so a later change on main does not move what this test compares.
//
// What must change, and only that (SPEC D6): TI01/info-migration-ts.diff and info-migration-mjs.diff (diff-only) go
// from TI01 info to block with the not-available detail; TI02/pass-moved-to-other-file goes from no TI02 to one TI02
// block at src/a.test.ts, the base line of "totals the cart", with matchTests(...).moved empty; and TI06/pass-cross-file
// goes from no signal to one TI02 block at src/a.test.ts line 5, the line of "adds the prices", still with no TI06.
// Every other existing case under fixtures/test-integrity/, fixtures/test-integrity-precision/, fixtures/skylos-nine/
// and fixtures/skylos-nine-pytest/ (at the start of the range) gives the very report it gave there, Python cases indexed
// by the real interpreter on both sides; the goldens give their committed report.json on both sides. What must hold
// besides: no existing fixture is edited or deleted; the existing test files changed are exactly the re-pins of SPEC
// D7, each with a comment naming this change; schema/, the message codes and the signal ids are unchanged; and the
// Skylos benchmark still reads 7 of 9, with deleted-test (TI01) and replaced-test (TI02) still blocking, for vitest and
// for pytest.

const BASE = "8302706940805000e8a206c6668ec3340b8d88e9";
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const SELF = "packages/core/test/ac-name-only-suite.test.ts";
const NOT_AVAILABLE =
  "Test file deleted; a test file of the same name was added, but the text to compare their tests was not available.";
const MIGRATIONS = ["test-integrity/TI01/info-migration-mjs.diff", "test-integrity/TI01/info-migration-ts.diff"];
const MOVED_CASE = "test-integrity/TI02/pass-moved-to-other-file";
const CROSS_CASE = "test-integrity/TI06/pass-cross-file";
const CHANGED = [...MIGRATIONS, MOVED_CASE, CROSS_CASE];
/** The existing test files SPEC D7 re-pins, and only these. */
const REPINNED = [
  "packages/action/test/ac-accept-signoff-regression.test.ts",
  "packages/action/test/ac-pyparity2-unchanged.test.ts",
  "packages/core/test/ac-ti01-exemptions.test.ts",
  "packages/core/test/ac-ti0102-regression.test.ts",
  "packages/core/test/ac-ti02-cross-file.test.ts",
  "packages/core/test/ac-ti0205-regression.test.ts",
  "packages/core/test/ac-ti0304-regression.test.ts",
  "packages/core/test/ac-ti06-ti12-unchanged.test.ts",
  "packages/core/test/ac-ti09y-regression.test.ts",
  "packages/core/test/ac-ti1013-regression.test.ts",
  "packages/core/test/ac-ti1411-regression.test.ts",
  "packages/node-io/test/ac-ti07-moved.test.ts",
];

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** From the base commit to the working tree while this file is not committed, else the commit that added it. */
function changeRange(): { from: string; to: string | null } {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", SELF).trim();
  return added === "" ? { from: BASE, to: null } : { from: `${added}^`, to: added };
}

function changed(range: { from: string; to: string | null }, ...paths: string[]) {
  const revs = range.to === null ? [range.from] : [range.from, range.to];
  return git("diff", "--name-status", "--no-renames", ...revs, "--", ...paths)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return { status: (status ?? "").charAt(0), path: rest.at(-1) ?? "" };
    });
}

interface SourceFile {
  path: string;
  text: string;
}
interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Message {
  level: string;
  code: string;
  text: string;
}
interface Report {
  verdict: string;
  messages: Message[];
  testIntegrity?: { verdict?: string; signals: Signal[]; changes?: unknown };
}
interface Block {
  kind: string;
  path: string[];
  line: number;
}
interface Code {
  check(input: unknown): Report;
  parseUnifiedDiff(text: string): unknown[];
  indexTouchedTestFiles(diff: unknown[], sources: unknown, pyIndex: unknown): unknown;
  matchTests(touched: unknown): { moved?: unknown[] };
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

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

/** packages/core/src at `rev`, extracted into `dir`, with its node_modules linked to this checkout's. */
function extract(rev: string, dir: string): string {
  const tar = execFileSync("git", ["archive", "--format=tar", rev, "packages/core/src"], {
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  symlinkSync(join(ROOT, "packages/core/node_modules"), join(dir, "packages/core/node_modules"), "dir");
  return join(dir, "packages/core/src");
}

/** check() and the test-match entry points of a packages/core/src: an extracted one, or this checkout's. */
async function load(src: string | null): Promise<Code> {
  const at = (file: string) => pathToFileURL(join(src as string, file)).href;
  const [checkModule, diffModule, pairsModule, matchModule] =
    src === null
      ? await Promise.all([
          import("../src/check.js"),
          import("../src/diff/unified.js"),
          import("../src/signals/testPairs.js"),
          import("../src/signals/testMatch.js"),
        ])
      : await Promise.all([
          import(/* @vite-ignore */ at("check.ts")),
          import(/* @vite-ignore */ at("diff/unified.ts")),
          import(/* @vite-ignore */ at("signals/testPairs.ts")),
          import(/* @vite-ignore */ at("signals/testMatch.ts")),
        ]);
  return {
    check: (checkModule as unknown as { check(input: unknown): Report }).check,
    parseUnifiedDiff: (diffModule as unknown as { parseUnifiedDiff(text: string): unknown[] }).parseUnifiedDiff,
    indexTouchedTestFiles: (pairsModule as unknown as Pick<Code, "indexTouchedTestFiles">).indexTouchedTestFiles,
    matchTests: (matchModule as unknown as Pick<Code, "matchTests">).matchTests,
  };
}

interface Case {
  name: string;
  input: Record<string, unknown>;
  sources?: unknown;
  pyIndex?: unknown;
}

type PyIndexer = (sources: unknown) => Promise<unknown>;

async function pyIndexer(): Promise<PyIndexer> {
  const io = (await import("../../node-io/src/index.js")) as unknown as {
    indexPythonTestSources(sources: unknown): Promise<unknown>;
  };
  return (sources) => io.indexPythonTestSources(sources);
}

/** A case's inputs: its diff, the base and head sources under `root` (indexed by the real Python index) and repo files. */
async function dirCase(
  name: string,
  root: string,
  diff: string,
  index: PyIndexer,
  repoFiles: (head: SourceFile[]) => string[],
): Promise<Case> {
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const sources = { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } };
  const pyIndex = await index(sources);
  return {
    name,
    sources,
    pyIndex,
    input: {
      diff: { text: diff },
      repoFiles: repoFiles(head),
      testSources: sources,
      ...(pyIndex === undefined ? {} : { pythonTestIndex: pyIndex }),
    },
  };
}

/** Every case of fixtures/test-integrity/ and fixtures/test-integrity-precision/ at `rev`: a `.diff`, or a case directory. */
async function casesAt(rev: string, index: PyIndexer): Promise<Case[]> {
  const paths = git(
    "ls-tree",
    "-r",
    "--name-only",
    rev,
    "--",
    "fixtures/test-integrity",
    "fixtures/test-integrity-precision",
  )
    .split("\n")
    .filter((p) => p !== "")
    .sort(byName);
  const out: Case[] = [];
  for (const path of paths) {
    const diffFile = /^fixtures\/(test-integrity(?:-precision)?\/TI\d\d\/[^/]+\.diff)$/.exec(path);
    if (diffFile !== null) {
      const name = diffFile[1] as string;
      out.push({
        name,
        input: {
          diff: { text: fixture(name) },
          repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
        },
      });
      continue;
    }
    const dir = /^fixtures\/(test-integrity(?:-precision)?\/TI\d\d\/[^/]+)\/change\.diff$/.exec(path);
    if (dir === null) continue;
    const name = dir[1] as string;
    out.push(
      await dirCase(name, `${FIXTURES}${name}/`, fixture(`${name}/change.diff`), index, (head) =>
        [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      ),
    );
  }
  return out;
}

/** Every Skylos case at `rev`: fixtures/skylos-nine/<name> (with fixtures/skylos-nine-sources/<name> when it exists) and fixtures/skylos-nine-pytest/<name>. */
async function skylosAt(rev: string, index: PyIndexer): Promise<Case[]> {
  const dirs = git("ls-tree", "-r", "--name-only", rev, "--", "fixtures/skylos-nine", "fixtures/skylos-nine-pytest")
    .split("\n")
    .map((p) => /^fixtures\/(skylos-nine(?:-pytest)?\/[^/]+)\/change\.diff$/.exec(p)?.[1])
    .filter((p): p is string => p !== undefined)
    .sort(byName);
  const out: Case[] = [];
  for (const name of dirs) {
    const files = () => fixture(`${name}/files.txt`).trim().split("\n");
    const diff = fixture(`${name}/change.diff`);
    if (name.startsWith("skylos-nine-pytest/")) {
      out.push(await dirCase(name, `${FIXTURES}${name}/`, diff, index, files));
      continue;
    }
    const sourcesDir = `${FIXTURES}skylos-nine-sources/${name.slice("skylos-nine/".length)}/`;
    if (existsSync(sourcesDir)) out.push(await dirCase(name, sourcesDir, diff, index, files));
    else out.push({ name, input: { diff: { text: diff }, repoFiles: files() } });
  }
  return out;
}

const COMMON = {
  version: "0.1.0",
  coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
  repoRoot: REPO_ROOT,
  threshold: 80,
  testIntegrityMode: { input: "block" },
};

const signalsOf = (r: Report, id: string) => (r.testIntegrity?.signals ?? []).filter((s) => String(s.id) === id);
const otherSignals = (r: Report, id: string) => (r.testIntegrity?.signals ?? []).filter((s) => String(s.id) !== id);

/** The report without the parts a changed TI01 or TI02 severity moves: verdicts, signals, changes and that signal's message. */
function rest(r: Report, code: string): unknown {
  const { verdict: _verdict, messages, testIntegrity, ...others } = r;
  const { verdict: _tiVerdict, signals: _signals, changes: _changes, ...tiOthers } = testIntegrity ?? { signals: [] };
  return { ...others, messages: messages.filter((m) => String(m.code) !== code), testIntegrity: tiOthers };
}

/** The upper-case string literals (message codes, signal ids) of a text. */
const codes = (text: string) =>
  [...new Set([...text.matchAll(/"((?:TI\d\d)|(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+))"/g)].map((m) => m[1] as string))].sort();

/** The base line of the test whose leaf name is `leaf` in the base text of `path` of a case. */
async function baseLine(c: Case, path: string, leaf: string): Promise<number> {
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const file = (c.sources as { base: { files: SourceFile[] } }).base.files.find((f) => f.path === path);
  expect(file, `${c.name}: the case has the base text of ${path}`).toBeDefined();
  const found = (core.indexTestFile(path, (file as SourceFile).text).tests ?? []).find(
    (b) => b.kind === "test" && b.path[b.path.length - 1] === leaf,
  );
  expect(found, `${c.name}: "${leaf}" is a base test of ${path}`).toBeDefined();
  return (found as Block).line;
}

describe("name-only moves change exactly four existing results", () => {
  it("AC-9: every existing test-integrity, precision, Skylos and golden fixture gives its base result except the two migration diffs (TI01 info to block), TI02/pass-moved-to-other-file (one TI02 block, nothing moved) and TI06/pass-cross-file (one TI02 block at line 5, no TI06), the re-pinned tests are exactly D7's with a comment each, schema, codes and ids are unchanged, and the Skylos table still reads 7 of 9", async () => {
    const range = changeRange();
    const temps: string[] = [];
    const temp = () => {
      const dir = mkdtempSync(join(tmpdir(), "pharn-ci-name-only-suite-"));
      temps.push(dir);
      return dir;
    };
    try {
      // The existing test files changed are exactly the re-pins of D7, each edited (never deleted or renamed) and each
      // carrying an added comment that names this change.
      const tests = changed(range, "packages").filter(
        (c) => /^packages\/[^/]+\/test\//.test(c.path) && c.status !== "A",
      );
      expect(
        tests.filter((c) => c.status !== "M"),
        "no existing test file is deleted or renamed",
      ).toEqual([]);
      expect(tests.map((c) => c.path).sort(byName), "the existing test files changed are D7's re-pins").toEqual(
        [...REPINNED].sort(byName),
      );
      const revs = range.to === null ? [range.from] : [range.from, range.to];
      for (const path of REPINNED) {
        const added = git("diff", ...revs, "--", path)
          .split("\n")
          .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
        expect(
          added.some((line) => /\/\/|\/\*|^\+\s*\*/.test(line) && /name[- ]only/i.test(line)),
          `${path} carries an added comment naming this change (name-only moves)`,
        ).toBe(true);
      }

      // No fixture that existed at the start of the range is edited or deleted.
      expect(
        changed(range, "fixtures").filter((c) => c.status !== "A"),
        "no existing fixture is modified or deleted",
      ).toEqual([]);

      // schema/, the message codes and the signal ids are unchanged.
      expect(changed(range, "schema"), "schema/ is unchanged").toEqual([]);
      const reportTs = "packages/core/src/report.ts";
      const headReportTs =
        range.to === null ? readFileSync(`${ROOT}${reportTs}`, "utf8") : git("show", `${range.to}:${reportTs}`);
      expect(codes(headReportTs), "report.ts codes and ids").toEqual(codes(git("show", `${range.from}:${reportTs}`)));

      const base = await load(extract(range.from, temp()));
      const head = await load(range.to === null ? null : extract(range.to, temp()));
      const runBoth = (input: Record<string, unknown>) => {
        const full = { ...COMMON, ...input };
        const after = head.check(full);
        expectValidReport(after);
        return { before: base.check(full), after };
      };

      // Every existing case: the same report on both sides, except exactly the four.
      const index = await pyIndexer();
      const cases = await casesAt(range.from, index);
      expect(cases.length, "the existing test-integrity and precision cases").toBeGreaterThan(300);
      for (const name of CHANGED) expect(cases.map((c) => c.name)).toContain(name);
      const skylos = await skylosAt(range.from, index);
      expect(skylos.filter((c) => c.name.startsWith("skylos-nine/")).length, "the nine vitest Skylos cases").toBe(9);
      expect(
        skylos.filter((c) => c.name.startsWith("skylos-nine-pytest/")).length,
        "the pytest Skylos cases",
      ).toBeGreaterThanOrEqual(11);
      const differing: string[] = [];
      const results = new Map<string, { before: Report; after: Report }>();
      for (const c of [...cases, ...skylos]) {
        const result = runBoth(c.input);
        results.set(c.name, result);
        if (JSON.stringify(result.before) !== JSON.stringify(result.after)) differing.push(c.name);
      }
      expect(differing.sort(byName), "the cases whose report changes").toEqual([...CHANGED].sort(byName));

      // The migration diffs: TI01 info becomes block with the not-available detail; nothing else moves.
      for (const name of MIGRATIONS) {
        const { before, after } = results.get(name) as { before: Report; after: Report };
        const was = signalsOf(before, "TI01");
        expect(was, `${name}: one info TI01 at the base`).toEqual([
          expect.objectContaining({ id: "TI01", severity: "info", path: "lib/x.test.js" }),
        ]);
        expect(signalsOf(after, "TI01"), `${name}: one TI01 block with the not-available detail`).toEqual([
          { ...(was[0] as Signal), severity: "block", detail: NOT_AVAILABLE },
        ]);
        expect(otherSignals(after, "TI01"), `${name}: the other signals`).toEqual(otherSignals(before, "TI01"));
        expect(
          after.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI01").map((m) => m.level),
          `${name}: the TI01 message is an error`,
        ).toEqual(["error"]);
        expect(rest(after, "TEST_INTEGRITY_TI01"), `${name}: the rest of the report`).toEqual(
          rest(before, "TEST_INTEGRITY_TI01"),
        );
      }

      // TI02/pass-moved-to-other-file: one TI02 block at the base line of "totals the cart", nothing moved.
      {
        const c = cases.find((x) => x.name === MOVED_CASE) as Case;
        const { before, after } = results.get(MOVED_CASE) as { before: Report; after: Report };
        const line = await baseLine(c, "src/a.test.ts", "totals the cart");
        expect(signalsOf(before, "TI02"), "no TI02 at the base").toEqual([]);
        const ti02 = signalsOf(after, "TI02");
        expect(ti02, "one TI02").toHaveLength(1);
        expect(ti02[0]?.path).toBe("src/a.test.ts");
        expect(ti02[0]?.line).toBe(line);
        expect(ti02[0]?.severity).toBe("block");
        expect(otherSignals(after, "TI02"), "the other signals").toEqual(otherSignals(before, "TI02"));
        expect(rest(after, "TEST_INTEGRITY_TI02"), "the rest of the report").toEqual(
          rest(before, "TEST_INTEGRITY_TI02"),
        );
        const diff = (c.input.diff as { text: string }).text;
        const moved = (code: Code) =>
          code.matchTests(code.indexTouchedTestFiles(code.parseUnifiedDiff(diff), c.sources, c.pyIndex)).moved;
        expect(moved(base), "one cross-file match at the base").toHaveLength(1);
        expect(moved(head), "and none now").toEqual([]);
      }

      // TI06/pass-cross-file: no signal at the base; now one TI02 block at src/a.test.ts line 5 ("adds the prices"),
      // and still no TI06.
      {
        const c = cases.find((x) => x.name === CROSS_CASE) as Case;
        const { before, after } = results.get(CROSS_CASE) as { before: Report; after: Report };
        expect(await baseLine(c, "src/a.test.ts", "adds the prices"), '"adds the prices" sits on line 5').toBe(5);
        expect(before.testIntegrity?.signals ?? [], "no signal at the base").toEqual([]);
        const signals = after.testIntegrity?.signals ?? [];
        expect(
          signals.map((s) => `${s.id} ${s.severity} ${s.path}:${s.line}`),
          "one TI02 block at src/a.test.ts line 5 and nothing else",
        ).toEqual(["TI02 block src/a.test.ts:5"]);
        expect(signalsOf(after, "TI06"), "still no TI06").toEqual([]);
        expect(rest(after, "TEST_INTEGRITY_TI02"), "the rest of the report").toEqual(
          rest(before, "TEST_INTEGRITY_TI02"),
        );
      }

      // The goldens: the committed report.json on both sides, built as the test that owns each builds it.
      expect(
        changed(range, "fixtures").filter((c) => c.path.startsWith("fixtures/golden")),
        "no golden fixture changes",
      ).toEqual([]);
      const { parseConfig } = (await import("../src/config.js")) as unknown as {
        parseConfig(text: string): { coverage?: { exclude?: string[]; threshold?: number } };
      };
      const exclusions = parseConfig(fixture("golden-exclusions/ci.yml"));
      const lines = (path: string) => fixture(path).trim().split("\n");
      const golden = (dir: string) => ({
        version: "0.1.0",
        diff: { text: fixture(`${dir}/pr.diff`) },
        repoRoot: REPO_ROOT,
        threshold: 80,
        repoFiles: lines(`${dir}/files.txt`),
      });
      const goldens: Array<[string, Record<string, unknown>]> = [
        ["golden", { ...golden("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
        [
          "golden-cobertura",
          {
            ...golden("golden-cobertura"),
            coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" },
          },
        ],
        [
          "golden-exclusions",
          {
            ...golden("golden-exclusions"),
            coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
            threshold: exclusions.coverage?.threshold ?? null,
            exclude: exclusions.coverage?.exclude ?? [],
          },
        ],
        [
          "golden-multi",
          {
            ...golden("golden-multi"),
            coverage: {
              files: [
                { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
                { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
              ],
              format: "auto",
            },
          },
        ],
      ];
      for (const [dir, input] of goldens) {
        const committed = fixture(`${dir}/report.json`);
        const before = base.check(input);
        const after = head.check(input);
        expectValidReport(after);
        expect(`${JSON.stringify(after, null, 2)}\n`, `${dir}: the committed report.json`).toBe(committed);
        expect(`${JSON.stringify(before, null, 2)}\n`, `${dir}: as at the base`).toBe(committed);
      }

      // The Skylos benchmark: still 7 of 9, with deleted-test (TI01) and replaced-test (TI02) still blocking, for
      // vitest and for pytest.
      expect(readFileSync(`${ROOT}docs/LIMITS.md`, "utf8"), "docs/LIMITS.md still says 7 of 9").toContain(
        "catch **7 of 9**",
      );
      expect(
        readFileSync(`${ROOT}packages/core/test/ac-skylos-nine-table.test.ts`, "utf8"),
        "the Skylos table test reads 7/9",
      ).toContain('"7/9"');
      for (const [name, id] of [
        ["skylos-nine/deleted-test", "TI01"],
        ["skylos-nine/replaced-test", "TI02"],
        ["skylos-nine-pytest/deleted-test", "TI01"],
        ["skylos-nine-pytest/replaced-test", "TI02"],
      ] as const) {
        const result = results.get(name);
        expect(result, `the Skylos case ${name} ran`).toBeDefined();
        const found = signalsOf((result as { after: Report }).after, id);
        expect(found.length, `Skylos ${name} is still caught by ${id}`).toBeGreaterThan(0);
        expect(
          found.every((s) => s.severity === "block"),
          `Skylos ${name}: a block`,
        ).toBe(true);
      }
    } finally {
      for (const dir of temps) rmSync(dir, { recursive: true, force: true });
    }
  }, 480_000);
});
