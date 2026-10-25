import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside each test body: the AC tests are written before TI06 and
// fixtures/test-integrity/TI06/ exist, so nothing that depends on them may run while the file loads. Each fixture is
// written by the build, so each test first checks, through the existing JS/TS test index, that the case's one changed
// test holds the change the AC describes and that its other assertions are unchanged.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TAUTOLOGY = "an assertion that compares a literal with itself was added";
const TRY = "an assertion moved into a try block that has a catch";
const RETURN = "an assertion moved after an early return";

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
interface Assertion {
  chain: string;
  inTryCatch: boolean;
  afterEarlyReturn: boolean;
}
interface Block {
  kind: string;
  path: string[];
  line: number;
  modifiers: string[];
  body: string;
  bodyHash: string;
  assertions: Assertion[];
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
  const root = `${FIXTURES}test-integrity/TI06/${name}/`;
  return {
    diff: readFileSync(`${root}change.diff`, "utf8"),
    base: sideFiles(`${root}base`),
    head: sideFiles(`${root}head`),
  };
}

const diffPaths = (diff: string) => [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1] as string);

async function runBlock(c: Case): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: c.diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...c.head.map((f) => f.path), ...diffPaths(c.diff)])].sort(),
    testSources: { base: { files: c.base, dropped: [] }, head: { files: c.head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

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
const squash = (text: string) => text.replace(/\s+/g, "");
const count = (text: string, part: string) => squash(text).split(squash(part)).length - 1;

/** The case's one modified JS/TS test file and its one changed test, at base and at head. */
async function changedTest(c: Case): Promise<{ path: string; was: Block; now: Block }> {
  expect(c.head, "one test file at head").toHaveLength(1);
  const path = (c.head[0] as SourceFile).path;
  expect(path).toMatch(/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/);
  expect(c.diff).toContain(`--- a/${path}`);
  expect(c.diff).toContain(`+++ b/${path}`);
  const base = await testsOf(c.base.find((f) => f.path === path));
  const head = await testsOf(c.head[0]);
  const changed = head.filter((now) => {
    const was = base.filter((b) => fullName(b) === fullName(now));
    return was.length === 1 && (was[0] as Block).bodyHash !== now.bodyHash;
  });
  expect(changed, "exactly one test changes").toHaveLength(1);
  const now = changed[0] as Block;
  const was = base.find((b) => fullName(b) === fullName(now)) as Block;
  for (const m of ["skip", "todo", "skipIf", "runIf"]) expect(now.modifiers).not.toContain(m);
  expect(head.map(fullName).sort(), "the same tests at base and head").toEqual(base.map(fullName).sort());
  return { path, was, now };
}

const chains = (b: Block) => b.assertions.map((a) => a.chain).sort();

/** The one TI06 of the case, of severity warn, at the head path and line of the changed test. */
async function oneTi06(c: Case, path: string, now: Block): Promise<Signal> {
  const report = await runBlock(c);
  const ti06 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI06");
  expect(ti06).toHaveLength(1);
  const signal = ti06[0] as Signal;
  expect(signal.severity).toBe("warn");
  expect(signal.path).toBe(path);
  expect(signal.line).toBe(now.line);
  return signal;
}

describe("TI06: a tautology added, an assertion moved into a try/catch or after an early return", () => {
  for (const [name, added] of [
    ["warn-tautology-expect", "expect(true).toBe(true);"],
    ["warn-tautology-assert", "assert.ok(true);"],
  ] as const) {
    it(`AC-4: ${added} added to a test, the other assertions unchanged, gives exactly one warn TI06 whose detail holds "${TAUTOLOGY}"`, async () => {
      const c = loadCase(name);
      const { path, was, now } = await changedTest(c);
      expect(count(was.body, added), "not at base").toBe(0);
      expect(count(now.body, added), "added once at head").toBe(1);
      const kept = chains(now);
      const tautologyChain = added.startsWith("expect") ? "expect().toBe()" : "assert.ok()";
      kept.splice(kept.indexOf(tautologyChain), 1);
      expect(kept, "the other assertions are unchanged").toEqual(chains(was));
      const signal = await oneTi06(c, path, now);
      expect(signal.detail).toContain(TAUTOLOGY);
    });
  }

  it(`AC-4: an expect(total(cart)).toBe(5); that sat directly in the test body moved into try { … } catch {} gives exactly one warn TI06 whose detail holds "${TRY}"`, async () => {
    const c = loadCase("warn-try-catch");
    const { path, was, now } = await changedTest(c);
    const target = (b: Block) => b.assertions.filter((a) => a.chain === "expect().toBe()");
    expect(count(was.body, "expect(total(cart)).toBe(5);")).toBe(1);
    expect(count(now.body, "expect(total(cart)).toBe(5);")).toBe(1);
    expect(squash(now.body)).toMatch(/try\{.*expect\(total\(cart\)\)\.toBe\(5\);.*\}catch/);
    expect(
      was.assertions.some((a) => a.inTryCatch),
      "no assertion in a try block at base",
    ).toBe(false);
    expect(
      target(now).some((a) => a.inTryCatch),
      "the assertion is in a try block with a catch at head",
    ).toBe(true);
    expect(chains(now), "the same assertions").toEqual(chains(was));
    const signal = await oneTi06(c, path, now);
    expect(signal.detail).toContain(TRY);
  });

  it(`AC-4: an expect(total(cart)).toBe(5); that came before every return, coming after an if (!cart) return; at head, gives exactly one warn TI06 whose detail holds "${RETURN}"`, async () => {
    const c = loadCase("warn-early-return");
    const { path, was, now } = await changedTest(c);
    expect(count(was.body, "expect(total(cart)).toBe(5);")).toBe(1);
    expect(count(now.body, "expect(total(cart)).toBe(5);")).toBe(1);
    expect(count(now.body, "if (!cart) return;")).toBe(1);
    expect(squash(now.body).indexOf("if(!cart)return;")).toBeLessThan(
      squash(now.body).indexOf("expect(total(cart)).toBe(5);"),
    );
    expect(
      was.assertions.some((a) => a.afterEarlyReturn),
      "no assertion after an early return at base",
    ).toBe(false);
    expect(
      now.assertions.some((a) => a.afterEarlyReturn),
      "the assertion comes after an early return at head",
    ).toBe(true);
    expect(chains(now), "the same assertions").toEqual(chains(was));
    const signal = await oneTi06(c, path, now);
    expect(signal.detail).toContain(RETURN);
  });
});
