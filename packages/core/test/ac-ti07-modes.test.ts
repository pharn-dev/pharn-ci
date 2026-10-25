import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixture are loaded inside each test body: the AC tests are written before TI07 and
// fixtures/test-integrity/TI07/ exist, so nothing that depends on them may run while the file loads. Each test first
// shows that the same input gives a TI07 finding in mode block with its test sources, so the quiet reports below are
// quiet because of the mode or the missing sources, not because the case gives nothing.

const REPO_ROOT = "/home/runner/work/demo/demo";
const CASE = "warn-tobe-number";

interface SourceFile {
  path: string;
  text: string;
}
interface Report {
  testIntegrity: { signals: { id: string }[] };
  messages: { code: string }[];
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

async function run(mode: "block" | "warn" | "off", withSources: boolean): Promise<Report> {
  const root = `${FIXTURES}test-integrity/TI07/${CASE}/`;
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  expect(head.length, "the case has head test text").toBeGreaterThan(0);
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    ...(withSources ? { testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } } } : {}),
    testIntegrityMode: { input: mode },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

const ti07Signals = (r: Report) => r.testIntegrity.signals.filter((s) => String(s.id) === "TI07");
const ti07Messages = (r: Report) => r.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI07");

describe("TI07 runs only with test sources and never in mode off", () => {
  it("AC-4: the must-trigger case in mode off, with its test sources, gives no TI07 signal and no TEST_INTEGRITY_TI07 message", async () => {
    const control = await run("block", true);
    expect(ti07Signals(control), "the same input in mode block gives TI07").toHaveLength(1);
    expect(ti07Messages(control)).toHaveLength(1);

    const off = await run("off", true);
    expect(ti07Signals(off)).toEqual([]);
    expect(ti07Messages(off)).toEqual([]);
  });

  it("AC-4: the must-trigger case in mode block without test sources gives no TI07 signal and no TEST_INTEGRITY_TI07 message", async () => {
    const control = await run("block", true);
    expect(ti07Signals(control), "the same input with its test sources gives TI07").toHaveLength(1);
    expect(ti07Messages(control)).toHaveLength(1);

    const without = await run("block", false);
    expect(ti07Signals(without)).toEqual([]);
    expect(ti07Messages(without)).toEqual([]);
  });
});
