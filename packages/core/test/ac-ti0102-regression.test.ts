import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { byCodeUnit } from "../src/text.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";
import { withoutFix } from "./v090-codes.js";

// check() and the fixtures run inside the test body: the AC test is written before the new TI01 and TI02 rules and the
// rebuilt dist exist.
//
// What must stay: every existing TI01 and TI02 fixture gives the signals and messages it gave at the base commit (a
// digest taken there, TI01 without sources and TI02 with its base and head text). What must change: the committed
// action dist carries the new TI01 and TI02 detail sentences. (CORE-132: the checks that read this increment's own
// change with git, that no existing test, golden, fixture or schema changed and that the dist was modified, were
// history pins and are removed.)

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_ROOT = "/home/runner/work/demo/demo";
const DIST = "packages/action/dist/index.js";
/**
 * sha256 of the JSON list of { fixture, signals, messages } over fixtures/test-integrity/TI01/*.diff (no sources)
 * then fixtures/test-integrity/TI02/* (with sources), in name order, in mode block, as check() gave them on main at
 * f1b252e, the commit this change was rebased onto (it was bc448710… at 5860ba4; #103's Python parity moved it, and this
 * change leaves it as main has it).
 */
// Re-pinned by the name-only-moves change: the two TI01 migration records changed (info to block, new detail), and
// TI02/pass-moved-to-other-file now gives one TI02 block, because TI01's same-stem rule and TI02's phase-2 leaf pick
// now need body evidence, not a name alone.
const BEFORE_DIGEST = "41cde9b625577c664f0b2aae4d319a15e6c92c46e5ca8bae5c7586c7439a415e";
/** The rename hint was dropped in review: a name alone must never soften a TI02 block. */
const HINT = "a new test in the same group has a similar name or body, so it may have been renamed.";
const MOVED =
  "Test file deleted; every test it held is found again, by name and body, in another test file of this change.";

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");

interface SourceFile {
  path: string;
  text: string;
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

async function existingOutputs(): Promise<string> {
  const { check } = await import("./text-coverage.js");
  type Input = Parameters<typeof check>[0];
  const out: Array<{ fixture: string; signals: unknown; messages: unknown }> = [];
  const run = (name: string, input: Record<string, unknown>) => {
    const report = check({
      version: "0.1.0",
      coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
      repoRoot: REPO_ROOT,
      threshold: 80,
      testIntegrityMode: { input: "block" },
      ...input,
    } as unknown as Input);
    expectValidReport(report);
    // CORE-50 (binary-diff-not-blind): TI01/pass-binary.diff (a deleted binary tests/img.test.ts) now gives one TI01
    // block, where the base commit gave nothing. The test asserts that new record, then takes it out, so the digest
    // still pins the base record of this fixture and every other one.
    if (name === "TI01/pass-binary.diff") {
      const signals = report.testIntegrity.signals.filter((s) => s.id === "TI01");
      expect(signals.map((s) => [s.path, s.severity, s.detail])).toEqual([
        ["tests/img.test.ts", "block", "Test file deleted; git shows it as binary, so its text was not read."],
      ]);
      expect(report.messages.filter((m) => m.code === "TEST_INTEGRITY_TI01")).toHaveLength(1);
      out.push({
        fixture: name,
        signals: report.testIntegrity.signals.filter((s) => s.id !== "TI01"),
        messages: report.messages.filter((m) => m.code !== "TEST_INTEGRITY_TI01"),
      });
      return;
    }
    out.push({ fixture: name, signals: report.testIntegrity.signals, messages: report.messages });
  };
  const ti01 = readdirSync(`${FIXTURES}test-integrity/TI01`)
    .filter((n) => n.endsWith(".diff"))
    .sort(byCodeUnit);
  for (const name of ti01) {
    run(`TI01/${name}`, {
      diff: { text: fixture(`test-integrity/TI01/${name}`) },
      repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    });
  }
  const ti02 = readdirSync(`${FIXTURES}test-integrity/TI02`).sort(byCodeUnit);
  for (const name of ti02) {
    const root = `${FIXTURES}test-integrity/TI02/${name}/`;
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    run(`TI02/${name}`, {
      diff: { text: readFileSync(`${root}change.diff`, "utf8") },
      repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    });
  }
  expect(out.length, "the existing TI01 and TI02 fixtures ran").toBeGreaterThan(30);
  // fix-hints (H6): the signals and messages now carry a `fix`; it is taken out, so the digest still pins the base outputs.
  return sha256(JSON.stringify(withoutFix(out)));
}

describe("TI01 and TI02 precision leave the existing outputs alone", () => {
  it("AC-14: the existing TI01 and TI02 fixtures give their base-commit outputs, and the committed dist carries the new rules", async () => {
    expect(await existingOutputs(), "the existing TI01 and TI02 fixtures give their base-commit outputs").toBe(
      BEFORE_DIGEST,
    );

    const dist = readFileSync(`${ROOT}${DIST}`, "utf8");
    expect(dist, "the rebuilt dist carries no rename hint").not.toContain(HINT);
    expect(dist, "and carries the TI01 moved-tests detail").toContain(MOVED);
  }, 120_000);
});
