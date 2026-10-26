import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 matches projects by identity, so nothing
// the build adds may run while the file loads. Each case is a vitest or jest config whose base and head text are given
// as test sources, with a diff that replaces every base line by every head line.

const REPO_ROOT = "/home/runner/work/demo/demo";
const VITEST = "vitest.config.ts";
const JEST = "jest.config.js";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}

const linesOf = (text: string) => text.replace(/\n$/, "").split("\n");

/** A `--unified=0` diff of `path` that replaces every base line by every head line. */
function diffOf(path: string, base: string, head: string): string {
  const removed = linesOf(base).map((line) => `-${line}`);
  const added = linesOf(head).map((line) => `+${line}`);
  const lines = [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`];
  lines.push(`@@ -1,${removed.length} +1,${added.length} @@`, ...removed, ...added);
  return `${lines.join("\n")}\n`;
}

/** check() in mode block over a modified config with this base and head text; its TI09 signals. */
async function run(path: string, base: string, head: string): Promise<Signal[]> {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(path, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", path],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path, text: base }], dropped: [] },
      head: { files: [{ path, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report.testIntegrity.signals as unknown as Signal[]).filter((s) => String(s.id) === "TI09");
}

/** A vitest config whose `test.projects` list holds these entries (JS source), one per line. */
const vitest = (...projects: string[]) =>
  [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    "    projects: [",
    ...projects.map((p) => `      ${p},`),
    "    ],",
    "  },",
    "});",
    "",
  ].join("\n");

/** A jest config whose `projects` list holds these entries (JS source), one per line. */
const jest = (...projects: string[]) =>
  ["module.exports = {", "  projects: [", ...projects.map((p) => `    ${p},`), "  ],", "};", ""].join("\n");

const UNIT = '{ test: { name: "unit", include: ["src/**/*.test.ts"] } }';
const BROWSER = '{ test: { name: "browser", include: ["src/**/*.browser.test.ts"] } }';
const JEST_E2E = '{ displayName: "e2e", testMatch: ["<rootDir>/e2e/**/*.test.ts"] }';
// The regex strings are written as JS source: `"\\.test\\.ts$"` in the config is the regex \.test\.ts$.
const TEST_REGEX = String.raw`"\\.test\\.ts$"`;

interface Case {
  label: string;
  path: string;
  base: string;
  head: string;
}

describe("TI09: projects matched by name and compared by their test-list keys", () => {
  it("AC-6: a reorder, unrelated keys, a rename in place and an added include give no TI09; a widened exclude, a narrowed testMatch, a widened testPathIgnorePatterns and narrowed glob-string projects give one block; an opaque entry gained for a removed project and an opaque testRegex give one warn", async () => {
    const none: Case[] = [
      { label: "vitest: projects reordered", path: VITEST, base: vitest(UNIT, BROWSER), head: vitest(BROWSER, UNIT) },
      {
        label: "vitest: setupFiles and extends changed",
        path: VITEST,
        base: vitest(
          '{ extends: true, test: { name: "unit", include: ["src/**/*.test.ts"], setupFiles: ["./setup.ts"] } }',
          BROWSER,
        ),
        head: vitest(
          '{ extends: "./vitest.shared.ts", test: { name: "unit", include: ["src/**/*.test.ts"], setupFiles: ["./setup-v2.ts"] } }',
          BROWSER,
        ),
      },
      {
        label: "vitest: a project named by a label object renamed in place",
        path: VITEST,
        base: vitest('{ test: { name: { label: "unit", color: "green" }, include: ["src/**/*.test.ts"] } }', BROWSER),
        head: vitest('{ test: { name: { label: "core", color: "green" }, include: ["src/**/*.test.ts"] } }', BROWSER),
      },
      {
        label: "vitest: test.include added where the base had none",
        path: VITEST,
        base: vitest('{ test: { name: "unit" } }', BROWSER),
        head: vitest('{ test: { name: "unit", include: ["src/**/*.test.ts"] } }', BROWSER),
      },
      {
        label: "jest: a project's transform changed",
        path: JEST,
        base: jest(
          '{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts"], transform: { "^.+\\\\.ts$": "ts-jest" } }',
          JEST_E2E,
        ),
        head: jest(
          '{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts"], transform: { "^.+\\\\.ts$": "@swc/jest" } }',
          JEST_E2E,
        ),
      },
    ];
    for (const { label, path, base, head } of none) {
      expect(await run(path, base, head), label).toEqual([]);
    }

    const blocks: Case[] = [
      {
        label: "vitest: test.exclude widened inside a matched project",
        path: VITEST,
        base: vitest('{ test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**"] } }'),
        head: vitest(
          '{ test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**", "src/legacy/**"] } }',
        ),
      },
      {
        label: "jest: testMatch narrowed in the project with the same displayName",
        path: JEST,
        base: jest(
          JEST_E2E,
          '{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/lib/**/*.test.ts"] }',
        ),
        head: jest('{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts"] }', JEST_E2E),
      },
      {
        label: "jest: testPathIgnorePatterns widened",
        path: JEST,
        base: jest('{ displayName: "unit", testPathIgnorePatterns: ["/node_modules/"] }', JEST_E2E),
        head: jest('{ displayName: "unit", testPathIgnorePatterns: ["/node_modules/", "/legacy/"] }', JEST_E2E),
      },
      {
        label: "jest: glob-string projects narrowed",
        path: JEST,
        base: jest('"packages/*"'),
        head: jest('"packages/a"'),
      },
    ];
    for (const { label, path, base, head } of blocks) {
      const signals = await run(path, base, head);
      expect(signals, label).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe("block");
      expect(signals[0]?.detail, label).toContain("projects narrowed: ");
    }

    const warns: Case[] = [
      {
        label: "jest: a named project removed while the head gains an opaque entry",
        path: JEST,
        base: jest('{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts"] }', JEST_E2E),
        head: jest(
          '{ displayName: "unit", testMatch: ["<rootDir>/src/**/*.test.ts"] }',
          'require("./jest.e2e.config.js")',
        ),
      },
      {
        label: "jest: a project's testRegex replaced by an opaque value",
        path: JEST,
        base: jest(`{ displayName: "unit", testRegex: ${TEST_REGEX} }`, JEST_E2E),
        head: jest('{ displayName: "unit", testRegex: unitPattern("test") }', JEST_E2E),
      },
    ];
    for (const { label, path, base, head } of warns) {
      const signals = await run(path, base, head);
      expect(signals, label).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe("warn");
      expect(signals[0]?.detail, label).toContain("cannot be compared");
    }
  });
});
