import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the build writes
// fixtures/test-integrity-precision/TI01/block-stem-hollow and info-stem-moved and before TI01's same-stem rule asks
// for body evidence, so nothing that depends on them may run while the file loads. With no test sources, or with a base
// side that could not be read, the bodies cannot be compared, so the same-stem case keeps the mode's severity with the
// not-available detail; there is no fallback that compares the tests from the diff text. The two existing migration
// diffs, checked diff-only, give the same.

const REPO_ROOT = "/home/runner/work/demo/demo";
const DELETED = "test/pricing.test.ts";
const NOT_AVAILABLE =
  "Test file deleted; a test file of the same name was added, but the text to compare their tests was not available.";

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
interface Report {
  testIntegrity: { signals: Signal[] };
}
type Mode = "block" | "warn";

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

async function run(input: Record<string, unknown>, mode: Mode): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: REPO_ROOT,
    threshold: 80,
    testIntegrityMode: { input: mode },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

function expectNotAvailable(report: Report, path: string, mode: Mode, label: string): void {
  const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01" && s.path === path);
  expect(ti01, `${label}: one TI01 signal for ${path}`).toHaveLength(1);
  expect(ti01[0]?.severity, `${label}: the mode's severity`).toBe(mode);
  expect(ti01[0]?.detail, `${label}: the not-available detail`).toBe(NOT_AVAILABLE);
}

const MODES: readonly Mode[] = ["block", "warn"];

describe("TI01 same stem: no text to compare keeps the mode's severity", () => {
  it.each([["block-stem-hollow"], ["info-stem-moved"]] as const)(
    "AC-4: %s checked with no test sources and with an unavailable base side is one TI01 for test/pricing.test.ts with the not-available detail, block in mode block and warn in mode warn",
    async (name) => {
      const root = `${FIXTURES}test-integrity-precision/TI01/${name}/`;
      const diff = readFileSync(`${root}change.diff`, "utf8");
      const head = sideFiles(`${root}head`);
      expect(head.length, `${name}: the fixture has head text`).toBeGreaterThan(0);
      expect(sideFiles(`${root}base`).length, `${name}: the fixture has base text`).toBeGreaterThan(0);
      const repoFiles = [...new Set([...head.map((f) => f.path), "src/pricing.ts"])].sort();
      for (const mode of MODES) {
        expectNotAvailable(
          await run({ diff: { text: diff }, repoFiles }, mode),
          DELETED,
          mode,
          `${name} ${mode} no sources`,
        );
        const baseUnavailable = {
          base: { unavailable: "git cat-file failed" },
          head: { files: head, dropped: [] },
        };
        expectNotAvailable(
          await run({ diff: { text: diff }, repoFiles, testSources: baseUnavailable }, mode),
          DELETED,
          mode,
          `${name} ${mode} base unavailable`,
        );
      }
    },
  );

  it.each([["info-migration-ts.diff"], ["info-migration-mjs.diff"]] as const)(
    "AC-4: the existing TI01/%s checked diff-only is one TI01 for lib/x.test.js with the not-available detail, block in mode block and warn in mode warn",
    async (name) => {
      for (const mode of MODES) {
        const report = await run(
          {
            diff: { text: fixture(`test-integrity/TI01/${name}`) },
            repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
          },
          mode,
        );
        expectNotAvailable(report, "lib/x.test.js", mode, `${name} ${mode}`);
      }
    },
  );
});
