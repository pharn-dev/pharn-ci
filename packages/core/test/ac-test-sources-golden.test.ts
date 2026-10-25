import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the config parser and the test-source helpers are loaded inside the test body: the test is written before
// the test-source input exists, so nothing that depends on it may run while the file loads. The inputs of each golden
// set are built as the test that owns its report.json builds them: packages/core/test/golden.test.ts (golden),
// ac-format-golden.test.ts (golden-cobertura), exclusions-golden.test.ts (golden-exclusions) and
// ac-globs-golden.test.ts (golden-multi).

const REPO_ROOT = "/home/runner/work/demo/demo";
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("../src/check.js");
  const { parseConfig } = await import("../src/config.js");
  const core = (await import("../src/index.js")) as unknown as {
    TEST_SOURCE_DROP_REASONS: readonly string[];
    unavailableTestSources(reason: string): unknown;
  };
  return { check, parseConfig, core };
}

describe("check() and the test-source input", () => {
  it("AC-15: every golden report is byte-identical without sources, with sources and with unavailable sources", async () => {
    const { check, parseConfig, core } = await load();
    type Input = Parameters<typeof check>[0];

    const exclusionsConfig = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const base = (dir: string) => ({
      version: "0.1.0",
      diff: { text: fixture(`${dir}/pr.diff`) },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles: lines(`${dir}/files.txt`),
    });
    const sets: Array<[string, Record<string, unknown>]> = [
      ["golden", { ...base("golden"), coverage: { text: fixture("golden/coverage.info"), format: "lcov" } }],
      [
        "golden-cobertura",
        { ...base("golden-cobertura"), coverage: { text: fixture("golden-cobertura/coverage.xml"), format: "auto" } },
      ],
      [
        "golden-exclusions",
        {
          ...base("golden-exclusions"),
          coverage: { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
          threshold: exclusionsConfig.coverage?.threshold ?? null,
          exclude: exclusionsConfig.coverage?.exclude ?? [],
        },
      ],
      [
        "golden-multi",
        {
          ...base("golden-multi"),
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

    // Sources holding text and a dropped file for every one of the six reasons, and sources marked unavailable,
    // built with the helpers the CLI and the Action use.
    expect(core.TEST_SOURCE_DROP_REASONS).toHaveLength(6);
    const withText = {
      base: {
        files: [{ path: "a.test.ts", text: "x" }],
        dropped: core.TEST_SOURCE_DROP_REASONS.map((reason, i) => ({ path: `d${i}.test.ts`, reason })),
      },
      head: { files: [], dropped: [{ path: "c.test.ts", reason: "binary" }] },
    };
    const unavailable = core.unavailableTestSources("r");

    for (const [dir, input] of sets) {
      const committed = fixture(`${dir}/report.json`);
      const reports = [
        check(input as unknown as Input),
        check({ ...input, testSources: withText } as unknown as Input),
        check({ ...input, testSources: unavailable } as unknown as Input),
      ];
      for (const [i, report] of reports.entries()) {
        expectValidReport(report);
        expect(asFile(report), `${dir}: report ${i} equals the committed report.json`).toBe(committed);
      }
    }
  });
});
