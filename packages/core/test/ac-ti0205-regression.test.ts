import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the config parser, the diff parser and the core helpers are loaded inside the test body: the AC test is
// written before check() compares test files, so nothing that depends on that may run while the file loads.
//
// What stays: every golden report, with and without sources; and every earlier signal fixture without sources gives
// the signals and messages it gave at the base commit (a digest taken there). What changes on purpose: with sources
// unavailable, an earlier fixture whose diff modifies a JS/TS or Python test file gains exactly one
// TEST_INTEGRITY_INDEX_UNAVAILABLE message and nothing else in its signals or messages; one that modifies none is
// unchanged.

const REPO_ROOT = "/home/runner/work/demo/demo";
const EARLIER_DIRS = ["TI01", "TI03", "TI04", "TI10", "TI11", "TI13", "TI14"];
/**
 * The TI11 fixtures the signal-precision increment adds; the digest below is the base commit's, taken before they
 * existed, so they are left out of the loops over EARLIER_DIRS (and the old fixtures still hash to it).
 */
const NEW_TI11 = new Set([
  "pass-package-manager-swap.diff",
  "warn-job-retired-tests-moved.diff",
  "block-swap-drops-test.diff",
  "block-job-removed-script-kept.diff",
]);
const JS_TS_PY = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
const UNAVAILABLE = "TEST_INTEGRITY_INDEX_UNAVAILABLE";
/**
 * sha256 of the JSON list of { fixture, signals, messages } over the earlier fixtures without sources, in directory
 * then file order, as check() gave them at the base commit ad8277c.
 */
const BEFORE_DIGEST = "9851046d2ff16b5c718d655494b44f96ceed0e91f996e689aaa72524174b59f8";

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

interface Report {
  testIntegrity: { signals: unknown[] };
  messages: { code: string; level: string; text: string }[];
}

/** The exclusion patterns the TI14 fixture that appends an item is judged against: the items it appends. */
function excludeFor(name: string, text: string): string[] {
  if (name !== "TI14/block-exclude-appended.diff") return [];
  return text
    .split("\n")
    .filter((line) => /^\+\s+- /.test(line))
    .map((line) => line.replace(/^\+\s+- /, "").replace(/^["']|["']$/g, ""));
}

describe("TI02 and TI05 change the earlier outputs only where they mean to", () => {
  it("AC-21: the goldens stay byte-identical with and without sources, the earlier fixtures give their base-commit signals and messages without sources, and unavailable sources add exactly one INDEX_UNAVAILABLE message where a test file is modified", async () => {
    const { check } = await import("../src/check.js");
    const { parseConfig } = await import("../src/config.js");
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    const { isTestFile } = await import("../src/testFiles.js");
    const core = (await import("../src/index.js")) as unknown as { unavailableTestSources(reason: string): unknown };
    type Input = Parameters<typeof check>[0];
    const unavailable = core.unavailableTestSources("git cat-file failed");

    // The goldens, built as the test that owns each report.json builds them.
    const exclusionsConfig = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const golden = (dir: string) => ({
      version: "0.1.0",
      diff: { text: fixture(`${dir}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: lines(`${dir}/files.txt`),
    });
    const sets: Array<[string, Record<string, unknown>]> = [
      ["golden", { ...golden("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
      [
        "golden-cobertura",
        { ...golden("golden-cobertura"), coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } },
      ],
      [
        "golden-exclusions",
        {
          ...golden("golden-exclusions"),
          coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
          threshold: exclusionsConfig.coverage?.threshold ?? null,
          exclude: exclusionsConfig.coverage?.exclude ?? [],
        },
      ],
      [
        "golden-multi",
        {
          ...golden("golden-multi"),
          coverage: {
            files: [
              { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
              { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
            ],
            format: "auto",
          },
        },
      ],
    ];
    const withText = {
      base: { files: [{ path: "a.test.ts", text: 'it("a", () => { expect(1).toBe(1); });\n' }], dropped: [] },
      head: { files: [], dropped: [{ path: "c.test.ts", reason: "binary" }] },
    };
    for (const [dir, input] of sets) {
      const committed = fixture(`${dir}/report.json`);
      for (const [label, extra] of [
        ["without sources", {}],
        ["with sources", { testSources: withText }],
        ["with unavailable sources", { testSources: unavailable }],
      ] as const) {
        const report = check({ ...input, ...extra } as unknown as Input);
        expectValidReport(report);
        expect(asFile(report), `${dir} ${label}: the committed report.json`).toBe(committed);
      }
    }

    // The earlier signal fixtures, first without sources: what they gave at the base commit.
    const records: Array<{ fixture: string; signals: unknown[]; messages: unknown[] }> = [];
    const runs: Array<{ name: string; text: string; input: Record<string, unknown>; without: Report }> = [];
    for (const dir of EARLIER_DIRS) {
      const names = readdirSync(`${FIXTURES}test-integrity/${dir}`)
        .filter((name) => name.endsWith(".diff") && !(dir === "TI11" && NEW_TI11.has(name)))
        .sort();
      for (const file of names) {
        const name = `${dir}/${file}`;
        const text = fixture(`test-integrity/${name}`);
        const files = `test-integrity/${name.replace(/\.diff$/, ".files.txt")}`;
        const input = {
          version: "0.1.0",
          coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
          diff: { text },
          repoRoot: REPO_ROOT,
          threshold: 80,
          repoFiles: lines(existsSync(`${FIXTURES}${files}`) ? files : "test-files-deleted/files.txt"),
          exclude: excludeFor(name, text),
          testIntegrityMode: { input: "block" },
        };
        const without = check(input as unknown as Input) as unknown as Report;
        expectValidReport(without);
        records.push({ fixture: name, signals: without.testIntegrity.signals, messages: without.messages });
        runs.push({ name, text, input, without });
      }
    }
    expect(records.length).toBeGreaterThan(100);
    expect(
      createHash("sha256").update(JSON.stringify(records)).digest("hex"),
      "the earlier fixtures without sources give what they gave at the base commit",
    ).toBe(BEFORE_DIGEST);

    // Then with sources unavailable: one INDEX_UNAVAILABLE message where the diff modifies a JS/TS or Python test
    // file, and nothing else changes in the signals or the other messages.
    let modifying = 0;
    for (const { name, text, input, without } of runs) {
      const withUnavailable = check({ ...input, testSources: unavailable } as unknown as Input) as unknown as Report;
      expectValidReport(withUnavailable);
      expect(withUnavailable.testIntegrity.signals, `${name}: the same signals`).toEqual(without.testIntegrity.signals);
      const compared = parseUnifiedDiff(text).some(
        (f) =>
          JS_TS_PY.test(f.path) &&
          isTestFile(f.path) &&
          (f.status === "modified" || (f.status === "renamed" && isTestFile(f.oldPath))),
      );
      const added = withUnavailable.messages.filter((m) => String(m.code) === UNAVAILABLE);
      expect(
        withUnavailable.messages.filter((m) => String(m.code) !== UNAVAILABLE),
        `${name}: the same other messages`,
      ).toEqual(without.messages);
      if (compared) {
        modifying++;
        expect(added, `${name}: one ${UNAVAILABLE} message`).toHaveLength(1);
        expect(added[0]?.level).toBe("warn");
      } else {
        expect(added, `${name}: no ${UNAVAILABLE} message`).toEqual([]);
      }
    }
    expect(modifying, "some earlier fixtures modify a test file").toBeGreaterThan(0);
  });
});
