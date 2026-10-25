import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI07 and
// fixtures/test-integrity/TI07/ exist, so nothing that depends on them may run while the file loads. The fixtures are
// written by the build, so each test first checks that its fixture holds the case the AC describes (the test file's
// hunk swaps one assertion line for one with the same matcher, and a source file is modified too), and derives the
// expected head line and full name from the fixture text through the existing JS/TS test index.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "src/cart.test.ts";
const MESSAGE_PREFIX =
  "This change edits only the expected values of tests while it also edits source files, so the tests may have been made to agree with the code: ";
const MESSAGE_SUFFIX = ". Check that each new expected value is right.";

/** The JS/TS must-trigger cases and the matcher each detail must name. */
const CASES: Array<{ name: string; matcher: string; call: string }> = [
  { name: "warn-tobe-number", matcher: "toBe", call: ".toBe(" },
  { name: "warn-toequal-object", matcher: "toEqual", call: ".toEqual(" },
  { name: "warn-chai-equal", matcher: "equal", call: ".equal(" },
  { name: "warn-node-assert", matcher: "assert.strictEqual", call: "assert.strictEqual(" },
  { name: "warn-negative-number", matcher: "toBe", call: ".toBe(" },
  { name: "warn-regex-tomatch", matcher: "toMatch", call: ".toMatch(" },
];

type Mode = "block" | "warn";
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
interface Block {
  kind: string;
  name: string;
  path: string[];
  line: number;
  body: string;
  bodyHash: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
}
interface FileDiff {
  path: string;
  status: "added" | "deleted" | "modified";
  removed: string[];
  added: string[];
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

/** Split a unified diff into its files with the lines each removes and adds. */
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

async function runCase(c: Case, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

/** The test blocks of one fixture file, through the existing JS/TS test index. */
async function testsOf(file: SourceFile | undefined): Promise<Block[]> {
  if (file === undefined) throw new Error("the fixture file is missing");
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

const fullName = (b: Block) => b.path.join(" › ");
const fileAt = (files: SourceFile[], path: string) => files.find((f) => f.path === path);

/** The literal-looking pieces of a line: string contents, regex literals and numbers. */
function literalPieces(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) out.push(m[2] as string);
  for (const m of line.matchAll(/\/(?:\\.|[^/\n])+\/[a-z]*/g)) out.push(m[0]);
  for (const m of line.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(m[0]);
  return out.filter((piece) => piece.length > 0);
}

/**
 * Check the fixture holds the case: the test file's hunk swaps assertion lines that use the matcher call, a source
 * file that is not a test or test-config file is modified, and exactly one test keeps its full name with a changed
 * body. Returns that test at head and the literal pieces of the changed assertion lines.
 */
async function editedTest(c: Case, call: string): Promise<{ now: Block; pieces: string[] }> {
  const { isTestFile } = await import("../src/testFiles.js");
  const files = parseDiff(c.diff);
  const test = files.find((f) => f.path === PATH);
  expect(test, "the diff modifies the test file").toBeDefined();
  expect(test?.status).toBe("modified");
  const removed = test?.removed ?? [];
  const added = test?.added ?? [];
  expect(removed.length, "the test file's hunk removes a line").toBeGreaterThan(0);
  expect(added.length, "the test file's hunk adds a line").toBe(removed.length);
  for (const line of [...removed, ...added]) expect(line, "every changed test line uses the matcher").toContain(call);
  const sources = files.filter(
    (f) =>
      f.status === "modified" &&
      /\.(ts|tsx|js|mjs)$/.test(f.path) &&
      !isTestFile(f.path) &&
      !/(^|\/)(vitest|jest|playwright)\.config\.[cm]?[jt]s$/.test(f.path),
  );
  expect(sources.length, "a JS/TS source file is modified too").toBeGreaterThan(0);

  const base = await testsOf(fileAt(c.base, PATH));
  const head = await testsOf(fileAt(c.head, PATH));
  const edited = head.flatMap((now) => {
    const same = base.filter((was) => fullName(was) === fullName(now));
    return same.length === 1 && (same[0] as Block).body !== now.body ? [now] : [];
  });
  expect(edited, "exactly one test keeps its name and changes its body").toHaveLength(1);
  return { now: edited[0] as Block, pieces: [...removed, ...added].flatMap(literalPieces) };
}

describe("TI07: an expected value edited to match, in JS/TS test files", () => {
  for (const { name, matcher, call } of CASES) {
    for (const [mode, level] of [
      ["block", "warn"],
      ["warn", "warn"],
    ] as const) {
      it(`AC-1: ${name} in mode ${mode} gives one warn TI07 at the edited test's head line naming its full name and the ${matcher} matcher, one ${level} TEST_INTEGRITY_TI07 message, and no literal text`, async () => {
        const c = loadCase(name);
        const { now, pieces } = await editedTest(c, call);
        const report = await runCase(c, mode);

        const ti07 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI07");
        expect(ti07).toHaveLength(1);
        const signal = ti07[0] as Signal;
        expect(signal.severity).toBe("warn");
        expect(signal.path).toBe(PATH);
        expect(signal.line).toBe(now.line);
        expect(signal.detail).toBe(
          `The test "${fullName(now)}" changed only an expected value of its ${matcher} assertion, in a change that also edits source files.`,
        );

        const messages = report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07");
        expect(messages).toHaveLength(1);
        const message = messages[0] as { level: string; text: string };
        expect(message.level).toBe(level);
        expect(message.text).toBe(`${MESSAGE_PREFIX}\`${PATH}\`${MESSAGE_SUFFIX}`);

        // No literal text of the edited lines reaches a detail or a message (pieces that are part of the test's
        // full name or its path are not literal text the finding adds).
        const allDetails = report.testIntegrity.signals.map((s) => s.detail);
        const allMessages = report.messages
          .filter((m) => String(m.code).startsWith("TEST_INTEGRITY_"))
          .map((m) => m.text);
        for (const piece of pieces) {
          if (fullName(now).includes(piece) || PATH.includes(piece)) continue;
          for (const text of [signal.detail, message.text]) expect(text, `literal ${piece}`).not.toContain(piece);
          if (piece.length >= 3) {
            for (const text of [...allDetails, ...allMessages]) expect(text, `literal ${piece}`).not.toContain(piece);
          }
        }
      });
    }
  }
});
