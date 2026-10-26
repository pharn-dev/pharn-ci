import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 matches projects by identity, and the
// case dirs it reads are written by the build, so nothing the build adds may run while the file loads. Each case runs
// as ti09y-fixtures runs it: the test sources from its base/ and head/ directories, in mode block.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09`;

/** The TI09 case dirs of the base commit 5860ba4. */
const EARLIER = [
  "block-added-jest-config",
  "block-jest-test-match-narrowed",
  "block-mocha-grep-added",
  "block-package-json-pass-with-no-tests",
  "block-playwright-forbid-only-off",
  "block-pyproject-testpaths-narrowed",
  "block-pytest-addopts-deselect",
  "block-setup-cfg-norecursedirs-widened",
  "block-vite-exclude-widened",
  "block-vitest-include-narrowed",
  "block-vitest-threshold-lowered",
  "pass-added-vitest-config",
  "pass-exclude-build-dirs",
  "pass-package-json-jest-removed",
  "pass-playwright-project-retries",
  "pass-pytest-cacheprovider",
  "pass-tox-testpaths-widened",
  "pass-vitest-include-widened",
  "pass-vitest-key-moved",
  "pass-vitest-reformatted",
  "pass-vitest-threshold-raised",
  "warn-include-cannot-compare",
  "warn-vitest-retry-increased",
];
/**
 * sha256 of the JSON list of { fixture, signals } over EARLIER in that order, where signals are the case's TI09
 * signals as { id, severity, path, line, detail }, as check() gave them at the base commit 5860ba4.
 */
const EARLIER_DIGEST = "1db1e3a944727b8ca43f48b14f6bc950906847feb89f85001ab013f87b1c18f1";

interface SourceFile {
  path: string;
  text: string;
}

const byPath = (a: SourceFile, b: SourceFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The `<logical path>.txt` files under one side of a case, as test-source files sorted by logical path. */
function sideFiles(dir: string): SourceFile[] {
  try {
    statSync(dir);
  } catch {
    return [];
  }
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => name.split("\\").join("/"))
    .filter((name) => name.endsWith(".txt") && statSync(join(dir, name)).isFile())
    .map((name) => ({ path: name.slice(0, -".txt".length), text: readFileSync(join(dir, name), "utf8") }))
    .sort(byPath);
}

async function run(name: string) {
  const { check } = await import("../src/check.js");
  const dir = join(TI09, name);
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const base = sideFiles(join(dir, "base"));
  const head = sideFiles(join(dir, "head"));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", ...head.map((file) => file.path)].sort(),
    testIntegrityMode: { input: "block" },
    testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  const signals = report.testIntegrity.signals
    .filter((s) => String(s.id) === "TI09")
    .map((s) => ({ id: String(s.id), severity: s.severity, path: s.path, line: s.line, detail: s.detail }));
  return { signals, base, head };
}

describe("TI09: projects compared by identity, on the case dirs", () => {
  it("AC-5: esbuild swapped for oxc in every named project gives no TI09, a removed project and a narrowed project include each give one block TI09 naming projects narrowed, and the earlier TI09 case dirs give their base-commit signals", async () => {
    // hono 4952: every inline project swaps esbuild for oxc and keeps its name, include and exclude.
    const unrelated = await run("pass-vitest-project-unrelated-key");
    const baseText = unrelated.base.map((f) => f.text).join("\n");
    const headText = unrelated.head.map((f) => f.text).join("\n");
    expect(baseText, "the base projects set esbuild").toMatch(/\besbuild\s*:/);
    expect(headText, "the head projects set oxc").toMatch(/\boxc\s*:/);
    expect(headText, "no esbuild left at head").not.toMatch(/\besbuild\s*:/);
    for (const [side, text] of [
      ["base", baseText],
      ["head", headText],
    ] as const) {
      expect(text, `${side}: inline test.projects`).toMatch(/\bprojects\s*:/);
      expect(text, `${side}: the configDefaults.exclude spread`).toContain("...configDefaults.exclude");
    }
    expect(unrelated.signals, "pass-vitest-project-unrelated-key").toEqual([]);

    for (const name of ["block-vitest-project-removed", "block-vitest-project-include-narrowed"]) {
      const { signals } = await run(name);
      expect(signals, name).toHaveLength(1);
      expect(signals[0]?.severity, name).toBe("block");
      expect(signals[0]?.detail, name).toContain("projects narrowed: ");
    }

    // Every case dir of the base commit gives what it gave there.
    const records: Array<{ fixture: string; signals: unknown[] }> = [];
    for (const name of EARLIER) records.push({ fixture: name, signals: (await run(name)).signals });
    expect(records.filter((r) => r.signals.length > 0).length, "the earlier block and warn cases signal").toBe(13);
    expect(
      createHash("sha256").update(JSON.stringify(records)).digest("hex"),
      "the earlier TI09 case dirs give their base-commit signals",
    ).toBe(EARLIER_DIGEST);
  });
});
