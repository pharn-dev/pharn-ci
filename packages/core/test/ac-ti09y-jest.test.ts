import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() is loaded inside the test body: the AC test is written before TI09 exists, so nothing that depends on it
// may run while the file loads. The build-directory controls run in the same test as the cases that trigger.

const REPO_ROOT = "/home/runner/work/demo/demo";
const PATH = "jest.config.js";

interface Signal {
  id: string;
  severity: string;
  path: string;
  line: number | null;
  detail: string;
}
interface Report {
  testIntegrity: { signals: Signal[] };
  messages: { code: string; level: string; text: string }[];
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

/** check() in mode block over a modified jest.config.js with this base and head text; its TI09 signals. */
async function run(base: string, head: string): Promise<Signal[]> {
  const { check } = await import("@pharn-ci/core");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diffOf(PATH, base, head) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", PATH],
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: [{ path: PATH, text: base }], dropped: [] },
      head: { files: [{ path: PATH, text: head }], dropped: [] },
    },
  } as unknown as Parameters<typeof check>[0]);
  expectValidReport(report);
  return (report as unknown as Report).testIntegrity.signals.filter((s) => String(s.id) === "TI09");
}

/** A jest.config.js whose exported object holds these JS source lines (each one a `key: value`). */
const config = (...entries: string[]) => `module.exports = {\n${entries.map((e) => `  ${e},\n`).join("")}};\n`;

// The regex strings are written as JS source: `"\\.test\\.ts$"` in the config is the regex \.test\.ts$.
const TEST_REGEX = String.raw`testRegex: "\\.test\\.ts$"`;
const UNIT_REGEX = String.raw`testRegex: "\\.unit\\.test\\.ts$"`;
const DTS = String.raw`"\\.d\\.ts$"`;

describe("TI09: jest test and coverage path settings", () => {
  it("AC-9: a narrowed testMatch and testRegex and widened testPathIgnorePatterns and coveragePathIgnorePatterns each give one block TI09, and node_modules, dist and .d.ts entries give none", async () => {
    const cases: { label: string; base: string; head: string }[] = [
      {
        label: "testMatch narrowed",
        base: config('testMatch: ["**/__tests__/**/*.ts", "**/*.test.ts"]'),
        head: config('testMatch: ["**/*.test.ts"]'),
      },
      { label: "testRegex narrowed", base: config(TEST_REGEX), head: config(UNIT_REGEX) },
      {
        label: "testPathIgnorePatterns widened",
        base: config('testPathIgnorePatterns: ["/node_modules/"]'),
        head: config('testPathIgnorePatterns: ["/node_modules/", "/legacy/"]'),
      },
      {
        label: "coveragePathIgnorePatterns widened",
        base: config('coveragePathIgnorePatterns: ["/node_modules/"]'),
        head: config('coveragePathIgnorePatterns: ["/node_modules/", "src/api"]'),
      },
    ];
    for (const { label, base, head } of cases) {
      const signals = await run(base, head);
      expect(signals, `${label}: one TI09 signal`).toHaveLength(1);
      expect(signals[0]?.severity, label).toBe("block");
      expect(signals[0]?.path).toBe(PATH);
      expect(signals[0]?.detail, label).toContain(label);
    }

    const base = config('testPathIgnorePatterns: ["/node_modules/"]', 'coveragePathIgnorePatterns: ["/node_modules/"]');
    const controls: { label: string; head: string }[] = [
      {
        label: "testPathIgnorePatterns gains <rootDir>/node_modules/, /dist/ and \\.d\\.ts$",
        head: config(
          `testPathIgnorePatterns: ["/node_modules/", "<rootDir>/node_modules/", "/dist/", ${DTS}]`,
          'coveragePathIgnorePatterns: ["/node_modules/"]',
        ),
      },
      {
        label: "coveragePathIgnorePatterns gains <rootDir>/node_modules/, /dist/ and \\.d\\.ts$",
        head: config(
          'testPathIgnorePatterns: ["/node_modules/"]',
          `coveragePathIgnorePatterns: ["/node_modules/", "<rootDir>/node_modules/", "/dist/", ${DTS}]`,
        ),
      },
    ];
    for (const { label, head } of controls) {
      expect(await run(base, head), `${label}: no TI09 signal`).toEqual([]);
    }
  });
});
