import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI07 and
// fixtures/test-integrity/TI07/ exist, so nothing that depends on them may run while the file loads. Each case first
// checks that its fixture holds what the AC describes, so a quiet report is quiet about that case and not about an
// empty or unrelated fixture.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const MAX_TEST_BODY_CHARS = 4000;

interface SourceFile {
  path: string;
  text: string;
}
interface Case {
  diff: string;
  base: SourceFile[];
  head: SourceFile[];
}
interface Block {
  kind: string;
  path: string[];
  line: number;
  body: string;
  assertionCount: number;
}
interface Report {
  testIntegrity: { signals: { id: string }[] };
  messages: { code: string }[];
}
interface FileDiff {
  path: string;
  status: "added" | "deleted" | "modified";
  removed: string[];
  added: string[];
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

function loadCase(name: string): Case {
  const root = `${FIXTURES}test-integrity/TI07/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

function parseDiff(text: string): FileDiff[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
      if (match === null) throw new Error(`unreadable file header: ${line}`);
      current = { path: match[2] as string, status: "modified", removed: [], added: [] };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (current === undefined) throw new Error(`a line before the first file header: ${line}`);
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (line.startsWith("new file mode")) current.status = "added";
      if (line.startsWith("deleted file mode")) current.status = "deleted";
      continue;
    }
    if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files;
}

async function runBlock(c: Case): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

async function testsOf(c: Case, side: "base" | "head"): Promise<Block[]> {
  const file = c[side].find((f) => f.path === PATH);
  if (file === undefined) throw new Error(`the fixture has no ${side} text for ${PATH}`);
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

const fullName = (b: Block) => b.path.join(" › ");

/** The tests that keep their full name and change their body, as { was, now } pairs. */
async function editedPairs(c: Case): Promise<Array<{ was: Block; now: Block }>> {
  const base = await testsOf(c, "base");
  const head = await testsOf(c, "head");
  return head.flatMap((now) => {
    const same = base.filter((was) => fullName(was) === fullName(now));
    return same.length === 1 && (same[0] as Block).body !== now.body ? [{ was: same[0] as Block, now }] : [];
  });
}

const isConfig = (path: string) => /(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$/.test(path);

/** The diff's files other than the test file, and whether a JS/TS source file (not a test or config) is modified. */
async function otherFiles(
  c: Case,
): Promise<{ test: FileDiff | undefined; others: FileDiff[]; sourceModified: boolean }> {
  const { isTestFile } = await import("../src/testFiles.js");
  const files = parseDiff(c.diff);
  const others = files.filter((f) => f.path !== PATH);
  const sourceModified = others.some(
    (f) => f.status === "modified" && /\.(ts|tsx|js|mjs)$/.test(f.path) && !isTestFile(f.path) && !isConfig(f.path),
  );
  return { test: files.find((f) => f.path === PATH), others, sourceModified };
}

/** Each case's own fixture check: what the AC says the case is. */
const CHECKS: Record<string, (c: Case) => Promise<void>> = {
  "pass-subject-changed": async (c) => {
    const { test, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    const before = (line: string) => line.slice(0, line.lastIndexOf(".to"));
    expect(test?.removed.length).toBeGreaterThan(0);
    expect(test?.removed.map(before), "the subject or input changes with the expected value").not.toEqual(
      test?.added.map(before),
    );
  },
  "pass-assertion-added": async (c) => {
    const { sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    const pairs = await editedPairs(c);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0] as { was: Block; now: Block };
    expect(pair.now.assertionCount, "a new assertion is added").toBe(pair.was.assertionCount + 1);
  },
  "pass-no-source-change": async (c) => {
    const files = parseDiff(c.diff);
    expect(
      files.map((f) => f.path),
      "only the test file is in the diff",
    ).toEqual([PATH]);
    expect(await editedPairs(c)).toHaveLength(1);
  },
  "pass-source-deleted": async (c) => {
    const { others, sourceModified } = await otherFiles(c);
    expect(sourceModified, "no source file is modified").toBe(false);
    expect(others.length, "a source file is deleted").toBeGreaterThan(0);
    for (const f of others) expect(f.status, f.path).toBe("deleted");
    expect(await editedPairs(c)).toHaveLength(1);
  },
  "pass-test-config-only": async (c) => {
    const { others, sourceModified } = await otherFiles(c);
    expect(sourceModified, "no source file is modified").toBe(false);
    expect(others.length).toBeGreaterThan(0);
    for (const f of others) expect(isConfig(f.path), `${f.path} is a test-config file`).toBe(true);
    expect(others.some((f) => /(^|\/)vitest\.config\.[cm]?[jt]s$/.test(f.path))).toBe(true);
    expect(await editedPairs(c)).toHaveLength(1);
  },
  "pass-inline-snapshot": async (c) => {
    const { test, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    expect(test?.removed.length).toBeGreaterThan(0);
    for (const line of [...(test?.removed ?? []), ...(test?.added ?? [])]) {
      expect(line).toContain("toMatchInlineSnapshot(");
    }
  },
  "pass-snapshot-hint": async (c) => {
    const { test, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    expect(test?.removed.length).toBeGreaterThan(0);
    for (const line of [...(test?.removed ?? []), ...(test?.added ?? [])]) expect(line).toContain("toMatchSnapshot(");
  },
  "pass-snap-file": async (c) => {
    const { test, others, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    expect(test, "the test file itself is not in the diff").toBeUndefined();
    expect(others.some((f) => f.path.endsWith(".snap"))).toBe(true);
    const text = (side: SourceFile[]) => side.find((f) => f.path === PATH)?.text;
    expect(text(c.base), "the test text is there").toBeDefined();
    expect(text(c.head), "and the same at base and head").toBe(text(c.base));
  },
  "pass-literal-outside-assertion": async (c) => {
    const { test, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    expect(test?.removed.length).toBeGreaterThan(0);
    for (const line of [...(test?.removed ?? []), ...(test?.added ?? [])]) {
      expect(line, "the changed line is outside any assertion").not.toMatch(/expect\(|assert/);
    }
  },
  "pass-quote-style": async (c) => {
    const { test, sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    const removed = test?.removed ?? [];
    const added = test?.added ?? [];
    expect(removed.length).toBeGreaterThan(0);
    expect(removed, "the lines differ").not.toEqual(added);
    const quotes = (line: string) => line.replace(/'/g, '"');
    expect(removed.map(quotes), "only in quote style").toEqual(added.map(quotes));
  },
  "pass-body-at-cut": async (c) => {
    const { sourceModified } = await otherFiles(c);
    expect(sourceModified, "a source file is modified").toBe(true);
    const pairs = await editedPairs(c);
    expect(pairs).toHaveLength(1);
    const pair = pairs[0] as { was: Block; now: Block };
    const atCut = [pair.was, pair.now].filter((b) => b.body.length >= MAX_TEST_BODY_CHARS);
    expect(atCut, "the body is at the 4000-character cut on exactly one side").toHaveLength(1);
  },
};

describe("TI07: no signal where the expected value is not all that changed, or no source changed", () => {
  for (const name of Object.keys(CHECKS)) {
    it(`AC-3: ${name} in mode block gives no TI07 signal and no TEST_INTEGRITY_TI07 message`, async () => {
      const present = readdirSync(`${FIXTURES}test-integrity/TI07`).filter((n) => n.startsWith("pass-"));
      expect(present, "the case is one of the pass-* fixtures").toContain(name);
      const c = loadCase(name);
      await (CHECKS[name] as (c: Case) => Promise<void>)(c);

      const report = await runBlock(c);
      expect(report.testIntegrity.signals.filter((s) => String(s.id) === "TI07")).toEqual([]);
      expect(report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07")).toEqual([]);
    });
  }

  it("AC-3: every pass-* fixture under fixtures/test-integrity/TI07/ gives no TI07 signal and no TEST_INTEGRITY_TI07 message", async () => {
    const present = readdirSync(`${FIXTURES}test-integrity/TI07`)
      .filter((n) => n.startsWith("pass-"))
      .sort();
    for (const name of Object.keys(CHECKS)) expect(present, name).toContain(name);
    for (const name of present) {
      const report = await runBlock(loadCase(name));
      expect(
        report.testIntegrity.signals.filter((s) => String(s.id) === "TI07"),
        name,
      ).toEqual([]);
      expect(
        report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07"),
        name,
      ).toEqual([]);
    }
  });
});
