import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
const REPO_ROOT = "/home/runner/work/demo/demo";
/** The tracked files a fixture runs with when it has no sibling `<name>.files.txt`. */
const DEFAULT_FILES = ["package.json", "src/a.test.ts"];

/** The must-not-trigger cases the criterion names, by fixture. */
const TI10_NAMED = [
  "pass-pre-existing-or-true.diff",
  "pass-unrelated-script.diff",
  "pass-no-test-files.diff",
  "pass-stricter.diff",
  "pass-build-echo.diff",
];
const TI13_NAMED = ["pass-moved.diff", "pass-test-file.diff", "pass-py-istanbul.diff"];

/** The tracked files for a fixture: its sibling `<name>.files.txt` when there is one, else the default list. */
function filesFor(dir: string, name: string): string[] {
  const sibling = new URL(`fixtures/test-integrity/${dir}/${name.replace(/\.diff$/, ".files.txt")}`, ROOT);
  if (!existsSync(sibling)) return DEFAULT_FILES;
  return readFileSync(sibling, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function signalsOf(dir: string, name: string, repoFiles = filesFor(dir, name)) {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: fixture(`test-integrity/${dir}/${name}`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles,
    testIntegrityMode: { input: "block" },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report.testIntegrity.signals.filter((signal) => String(signal.id) === dir);
}

// CORE-133: the CHANGELOG, README, LIMITS and THREAT-MODEL wording checks moved out. CORE-132: the report.v1.json
// comparison with an old commit was a history pin and is removed.
describe("TI10 and TI13: schema and fixtures", () => {
  it("AC-12: the v2 schema names both message codes", () => {
    const schema = read("schema/report.v2.json");
    expect(schema).toContain("TEST_INTEGRITY_TI10");
    expect(schema).toContain("TEST_INTEGRITY_TI13");
  });

  it("AC-12: at least five must-trigger and five must-not-trigger diffs per id, the named cases among them, and they behave", async () => {
    for (const [dir, named] of [
      ["TI10", TI10_NAMED],
      ["TI13", TI13_NAMED],
    ] as const) {
      const folder = new URL(`fixtures/test-integrity/${dir}/`, ROOT);
      expect(existsSync(folder), dir).toBe(true);
      const listed = readdirSync(folder)
        .filter((n) => n.endsWith(".diff"))
        .sort();
      for (const name of named) expect(listed, `${dir}/${name}`).toContain(name);
      expect(listed.filter((n) => n.startsWith("block-")).length, `${dir} must-trigger`).toBeGreaterThanOrEqual(5);
      expect(listed.filter((n) => n.startsWith("pass-")).length, `${dir} must-not-trigger`).toBeGreaterThanOrEqual(5);

      for (const name of listed) {
        const signals = await signalsOf(dir, name);
        const label = `${dir}/${name}`;
        if (name.startsWith("pass-")) expect(signals, label).toEqual([]);
        else if (name.startsWith("block-")) {
          expect(signals.length, label).toBeGreaterThan(0);
          expect(
            signals.some((s) => s.severity === "block"),
            label,
          ).toBe(true);
        }
      }
    }

    // The no-test-files case passes because its tracked files hold no test file: with a test file it fires.
    expect(existsSync(new URL("fixtures/test-integrity/TI10/pass-no-test-files.files.txt", ROOT))).toBe(true);
    const withTests = await signalsOf("TI10", "pass-no-test-files.diff", DEFAULT_FILES);
    expect(withTests.length).toBeGreaterThan(0);
  });
});
