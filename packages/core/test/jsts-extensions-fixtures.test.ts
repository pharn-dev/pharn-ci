import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { check } from "@pharn-ci/core";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// The five case directories js-ts-extensions adds, each run through check() in block mode with its diff and its
// base/head sources. The AC tests drive check() with their own inline inputs; this file runs the fixtures themselves.

const REPO_ROOT = "/home/runner/work/demo/demo";

interface Case {
  dir: string;
  signal: string | null;
  path: string;
}

const CASES: readonly Case[] = [
  { dir: "TI01/block-test-mts-deleted", signal: "TI01", path: "src/cart.test.mts" },
  { dir: "TI01/block-spec-cts-deleted", signal: "TI01", path: "src/cart.spec.cts" },
  { dir: "TI03/block-spec-cts-skip-existing", signal: "TI03", path: "src/cart.spec.cts" },
  { dir: "TI04/block-test-mts-it-only", signal: "TI04", path: "src/cart.test.mts" },
  { dir: "TI13/pass-test-mts-istanbul", signal: null, path: "src/cart.test.mts" },
];

function sideFiles(dir: string): Array<{ path: string; text: string }> {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function run(dir: string) {
  const root = `${FIXTURES}test-integrity/${dir}/`;
  const base = sideFiles(`${root}base`);
  const head = sideFiles(`${root}head`);
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: readFileSync(`${root}change.diff`, "utf8") },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: [...new Set([...head.map((f) => f.path), "src/cart.ts"])].sort(),
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    testIntegrityMode: { input: "block" },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

describe("js-ts-extensions fixtures", () => {
  for (const c of CASES) {
    it(`${c.dir}: ${c.signal === null ? "no TI13 signal or message" : `${c.signal} at block naming ${c.path}`}`, () => {
      const report = run(c.dir);
      const signals = report.testIntegrity.signals as unknown as Array<{ id: string; severity: string; path: string }>;
      if (c.signal === null) {
        expect(signals.filter((s) => s.id === "TI13")).toEqual([]);
        expect(report.messages.filter((m) => String(m.code) === "TEST_INTEGRITY_TI13")).toEqual([]);
        return;
      }
      const own = signals.filter((s) => s.id === c.signal);
      expect(own.length, `a ${c.signal} signal`).toBeGreaterThan(0);
      for (const s of own) {
        expect(s.severity).toBe("block");
        expect(s.path).toBe(c.path);
      }
    });
  }
});
