import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside the test body: the AC test is written before the build writes
// fixtures/test-integrity-precision/TI01/block-stem-renamed-away, so nothing that depends on it may run while the file
// loads. The two exemptions that hide nothing (a source file of the same name deleted, other files of the package
// deleted) keep their info and their details as at the base commit 8302706 (taken there, verbatim). A test file
// renamed to a path that is not a test file is no longer softened by an added test file of the same stem: it keeps its
// rename detail and blocks.

const REPO_ROOT = "/home/runner/work/demo/demo";
const RENAMED = "test/pricing.test.ts";
const RENAMED_TO = "lib/pricing-data.ts";
const ADDED = "src/pricing.test.ts";
const RENAME_DETAIL = "Test file renamed to a path that is not a test file, so its tests are no longer found by name.";
/** [fixture, deleted test file, the TI01 detail check() gave at the base commit 8302706]. */
const EXEMPTIONS = [
  ["info-with-source.diff", "src/foo.test.ts", "Test file deleted together with a source file of the same name."],
  [
    "info-package-removed.diff",
    "packages/a/__tests__/y.test.ts",
    "Test file deleted together with other files of its package.",
  ],
] as const;

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

function diffSection(diff: string, path: string): string {
  const part = diff.split(/^(?=diff --git )/m).find((p) => p.startsWith(`diff --git a/${path} b/`));
  if (part === undefined) throw new Error(`the diff has no section for ${path}`);
  return part;
}

async function run(input: Record<string, unknown>): Promise<Report> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    repoRoot: REPO_ROOT,
    threshold: 80,
    testIntegrityMode: { input: "block" },
    ...input,
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report as unknown as Report;
}

describe("TI01 exemptions stay; a renamed-away test file is not softened by the stem", () => {
  it("AC-5: info-with-source.diff and info-package-removed.diff stay info with their base details, and a test file renamed to lib/pricing-data.ts beside an added src/pricing.test.ts is a TI01 block with the rename detail", async () => {
    for (const [name, path, detail] of EXEMPTIONS) {
      const report = await run({
        diff: { text: fixture(`test-integrity/TI01/${name}`) },
        repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
      });
      const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01" && s.path === path);
      expect(ti01, `${name}: one TI01 signal for ${path}`).toHaveLength(1);
      expect(ti01[0]?.severity, name).toBe("info");
      expect(ti01[0]?.detail, `${name}: the base detail`).toBe(detail);
    }

    const root = `${FIXTURES}test-integrity-precision/TI01/block-stem-renamed-away/`;
    const diff = readFileSync(`${root}change.diff`, "utf8");
    const base = sideFiles(`${root}base`);
    const head = sideFiles(`${root}head`);
    const renamed = diffSection(diff, RENAMED);
    expect(renamed, `${RENAMED} is renamed away`).toMatch(new RegExp(`^rename from ${RENAMED}$`, "m"));
    expect(renamed, `to ${RENAMED_TO}`).toMatch(new RegExp(`^rename to ${RENAMED_TO}$`, "m"));
    expect(diffSection(diff, ADDED), `${ADDED} is added`).toMatch(/^new file mode/m);
    expect(diffSection(diff, ADDED), `${ADDED} defines tests`).toMatch(/^\+\s*(it|test)\(/m);
    const { isTestFile } = (await import("../src/testFiles.js")) as unknown as { isTestFile(path: string): boolean };
    expect(isTestFile(RENAMED_TO), `${RENAMED_TO} is not a test file`).toBe(false);

    const report = await run({
      diff: { text: diff },
      repoFiles: [...new Set([...head.map((f) => f.path), RENAMED_TO])].sort(),
      testSources: { base: { files: base, dropped: [] }, head: { files: head, dropped: [] } },
    });
    const ti01 = report.testIntegrity.signals.filter((s) => String(s.id) === "TI01" && s.path === RENAMED);
    expect(ti01, `one TI01 signal for ${RENAMED}`).toHaveLength(1);
    expect(ti01[0]?.severity).toBe("block");
    expect(ti01[0]?.detail).toBe(RENAME_DETAIL);
  });
});
