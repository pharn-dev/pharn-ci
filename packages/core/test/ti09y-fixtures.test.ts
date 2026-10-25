import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// Every case of fixtures/test-integrity/TI09/ runs through check() in mode block, with the test sources read from the
// case's base/ and head/ directories (an absent directory gives no files on that side), as the Skylos tests read them.
// A block-* case gives at least one block TI09, a warn-* case at least one TI09 and no block one, and a pass-* case no
// TI09 and no TEST_INTEGRITY_INDEX_UNAVAILABLE message.

const REPO_ROOT = "/home/runner/work/demo/demo";
const TI09 = `${FIXTURES}test-integrity/TI09`;

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

const cases = readdirSync(TI09, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function run(name: string) {
  const dir = join(TI09, name);
  const diff = readFileSync(join(dir, "change.diff"), "utf8");
  const head = sideFiles(join(dir, "head"));
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text: diff },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: ["src/cart.ts", ...head.map((file) => file.path)].sort(),
    testIntegrityMode: { input: "block" },
    testSources: {
      base: { files: sideFiles(join(dir, "base")), dropped: [] },
      head: { files: head, dropped: [] },
    },
  });
  expectValidReport(report);
  return {
    signals: report.testIntegrity.signals.filter((signal) => signal.id === "TI09"),
    unavailable: report.messages.filter((message) => message.code === "TEST_INTEGRITY_INDEX_UNAVAILABLE"),
  };
}

describe("TI09 fixtures: every case through check() in mode block", () => {
  it("holds cases of the three kinds", () => {
    expect(cases.some((name) => name.startsWith("block-"))).toBe(true);
    expect(cases.some((name) => name.startsWith("warn-"))).toBe(true);
    expect(cases.some((name) => name.startsWith("pass-"))).toBe(true);
    expect(cases.filter((name) => !/^(block|warn|pass)-/.test(name))).toEqual([]);
  });

  for (const name of cases) {
    it(`${name}`, () => {
      const { signals, unavailable } = run(name);
      if (name.startsWith("block-")) {
        expect(
          signals.some((signal) => signal.severity === "block"),
          "at least one block TI09",
        ).toBe(true);
      } else if (name.startsWith("warn-")) {
        expect(signals.length, "at least one TI09").toBeGreaterThan(0);
        expect(
          signals.some((signal) => signal.severity === "block"),
          "no block TI09",
        ).toBe(false);
      } else {
        expect(signals, "no TI09").toEqual([]);
        expect(unavailable, "no TEST_INTEGRITY_INDEX_UNAVAILABLE message").toEqual([]);
      }
    });
  }
});

// Hostile config text near the 524288-character cap: each reader scans it in linear time. A quadratic reader takes
// minutes on these inputs; the bound is loose so host load cannot trip it.
describe("TI09 readers: hostile text near the size cap", () => {
  const SIZE = 500_000;
  const hostile: Array<[string, string, string]> = [
    ["an INI key line of spaces with no separator", "pytest.ini", `[pytest]\na${" ".repeat(SIZE)}x\n`],
    ["an INI value of many continuation lines", "pytest.ini", `[pytest]\naddopts = -q\n${"  -v\n".repeat(SIZE / 5)}`],
    [
      "a TOML array left open over many lines",
      "pyproject.toml",
      `[tool.pytest.ini_options]\ntestpaths = [\n${'  "a",\n'.repeat(SIZE / 7)}`,
    ],
    [
      "a TOML multi-line string left open over many lines",
      "pyproject.toml",
      `[tool.pytest.ini_options]\naddopts = """\n${"x\n".repeat(SIZE / 2)}`,
    ],
    ["a TOML header line of spaces", "pyproject.toml", `[tool.pytest.ini_options]\na = [\n[${" ".repeat(SIZE)}x\n`],
    [
      "a TOML key line of spaces before the value",
      "pyproject.toml",
      `[tool.pytest.ini_options]\na =${" ".repeat(SIZE)} \n`,
    ],
    ["a YAML number of many digits", ".mocharc.yml", `retries: ${"1".repeat(SIZE)}x\n`],
  ];
  for (const [label, path, text] of hostile) {
    it(`${label} reads in linear time`, async () => {
      const { testConfigKind } = await import("../src/testConfig/kinds.js");
      const { readTestConfig } = await import("../src/testConfig/read.js");
      const kind = testConfigKind(path);
      expect(kind, path).not.toBe(null);
      const started = performance.now();
      readTestConfig(kind as NonNullable<typeof kind>, path, text);
      expect(performance.now() - started).toBeLessThan(5000);
    }, 60_000);
  }
});
