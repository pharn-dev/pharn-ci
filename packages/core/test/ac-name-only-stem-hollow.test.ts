import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the test index and the fixtures are loaded inside the test body: the AC test is written before the build
// writes fixtures/test-integrity-precision/TI01/block-stem-hollow and block-stem-no-assertions and before TI01's
// same-stem rule asks for body evidence, so nothing that depends on them may run while the file loads. The test first
// checks, through the existing JS/TS test index, that each fixture holds the case: test/pricing.test.ts is deleted with
// tests that assert for real, and src/pricing.test.ts is added with the same test and group names but hollow bodies
// (`expect(true).toBe(true)`), or bodies with no assertion at all.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = "test/pricing.test.ts";
const ADDED = "src/pricing.test.ts";
const NOT_EVERY_TEST =
  "Test file deleted; a test file of the same name was added, but not every test it held is found again by body.";

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
interface Block {
  kind: string;
  path: string[];
  line: number;
  body: string;
  assertionCount: number;
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

async function testsOf(files: SourceFile[], path: string): Promise<Block[]> {
  const file = files.find((f) => f.path === path);
  if (file === undefined) throw new Error(`the fixture has no text for ${path}`);
  const core = (await import("@pharn-ci/core")) as unknown as {
    indexTestFile(path: string, text: string): { parsed: boolean; tests?: Block[] };
  };
  const result = core.indexTestFile(file.path, file.text);
  if (!result.parsed) throw new Error(`the fixture ${file.path} does not parse: ${JSON.stringify(result)}`);
  return (result.tests ?? []).filter((b) => b.kind === "test");
}

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/${path}`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

const fullName = (b: Block) => b.path.join(" › ");

async function runCase(name: string, hollow: boolean): Promise<Report> {
  const root = `${FIXTURES}test-integrity-precision/TI01/${name}/`;
  const diff = readFileSync(`${root}change.diff`, "utf8");
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);

  expect(diffSection(diff, DELETED), `${name}: ${DELETED} is deleted`).toMatch(/^deleted file mode/m);
  expect(diffSection(diff, ADDED), `${name}: ${ADDED} is added`).toMatch(/^new file mode/m);
  expect(
    head.some((f) => f.path === DELETED),
    `${name}: ${DELETED} has no head text`,
  ).toBe(false);

  const was = await testsOf(base, DELETED);
  const now = await testsOf(head, ADDED);
  expect(was.length, `${name}: the deleted file held tests`).toBeGreaterThan(0);
  for (const t of was) {
    expect(t.assertionCount, `${name}: "${fullName(t)}" asserts at base`).toBeGreaterThan(0);
    expect(t.body, `${name}: "${fullName(t)}" is not hollow at base`).not.toContain("expect(true)");
    expect(t.path.length, `${name}: "${fullName(t)}" sits in a group`).toBeGreaterThan(1);
  }
  expect(now.map(fullName).sort(), `${name}: the added file has the same test and group names`).toEqual(
    was.map(fullName).sort(),
  );
  for (const t of now) {
    if (hollow) {
      expect(t.body, `${name}: "${fullName(t)}" is hollow at head`).toContain("expect(true).toBe(true)");
      expect(t.assertionCount, `${name}: "${fullName(t)}" asserts, hollowly, at head`).toBeGreaterThan(0);
    } else {
      expect(t.assertionCount, `${name}: "${fullName(t)}" has no assertion at head`).toBe(0);
    }
  }

  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/pricing.ts"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("TI01 same stem: a hollow replacement keeps the block", () => {
  it.each([
    ["block-stem-hollow", true],
    ["block-stem-no-assertions", false],
  ] as const)(
    "AC-1: %s — a deleted test/pricing.test.ts replaced by a same-stem src/pricing.test.ts whose same-named tests do not hold the bodies is one TI01 block saying not every test is found again by body",
    async (name, hollow) => {
      const report = await runCase(name, hollow);
      const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01" && s.path === DELETED);
      expect(ti01, `${name}: one TI01 signal for ${DELETED}`).toHaveLength(1);
      expect(ti01[0]?.severity).toBe("block");
      expect(ti01[0]?.detail).toBe(NOT_EVERY_TEST);
    },
  );
});
