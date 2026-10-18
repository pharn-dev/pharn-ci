import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the config parser, the renderer and the fixtures are loaded inside each test body: the AC tests are
// written before the multi-file coverage input and fixtures/golden-multi/ exist, so nothing that depends on them may
// run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;
const lines = (path: string) => fixture(path).trim().split("\n");

async function load() {
  const { check } = await import("../src/check.js");
  const { parseConfig } = await import("../src/config.js");
  const { renderMarkdown } = await import("../src/render/markdown.js");
  return { check, parseConfig, renderMarkdown };
}

type Check = Awaited<ReturnType<typeof load>>["check"];
type Input = Parameters<Check>[0];

function golden(check: Check, dir: string, coverage: unknown, extra: Record<string, unknown> = {}) {
  const input = {
    version: "0.1.0",
    coverage,
    diff: { text: fixture(`${dir}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: lines(`${dir}/files.txt`),
    ...extra,
  };
  return check(input as Input);
}

describe("golden reports and the multi-file coverage input", () => {
  it("AC-1: one file through the single-file and the multi-file input gives equal reports, and the goldens are unchanged", async () => {
    const { check, parseConfig, renderMarkdown } = await load();

    for (const [dir, coverageName, format] of [
      ["golden", "coverage.info", "lcov"],
      ["golden-cobertura", "coverage.xml", "auto"],
    ] as const) {
      const text = fixture(`${dir}/${coverageName}`);
      const single = golden(check, dir, { text, format });
      const multi = golden(check, dir, { files: [{ text }], format });
      expectValidReport(single);
      expectValidReport(multi);
      expect(multi, dir).toEqual(single);
      expect(renderMarkdown(multi), dir).toBe(renderMarkdown(single));

      // The committed golden files, compared byte for byte (never through a file snapshot, which -u could rewrite).
      expect(asFile(single), `${dir}/report.json`).toBe(fixture(`${dir}/report.json`));
      expect(renderMarkdown(single), `${dir}/report.md`).toBe(fixture(`${dir}/report.md`));
      expect(asFile(multi), `${dir}/report.json from the multi-file input`).toBe(fixture(`${dir}/report.json`));
    }

    // The exclusions golden, computed as packages/core/test/exclusions-golden.test.ts computes it, is unchanged too.
    const config = parseConfig(fixture("golden-exclusions/ci.yml")) as {
      coverage?: { exclude?: string[]; threshold?: number };
    };
    const exclusions = golden(
      check,
      "golden-exclusions",
      { text: fixture("golden-exclusions/coverage.info"), format: "lcov" },
      { threshold: config.coverage?.threshold ?? null, exclude: config.coverage?.exclude ?? [] },
    );
    expectValidReport(exclusions);
    expect(asFile(exclusions)).toBe(fixture("golden-exclusions/report.json"));
    expect(renderMarkdown(exclusions)).toBe(fixture("golden-exclusions/report.md"));
  });

  it("AC-3: two lcov files that each cover part of the change merge into the golden-multi report", async () => {
    const { check, renderMarkdown } = await load();
    const report = golden(check, "golden-multi", {
      files: [
        { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a/lcov.info" },
        { text: fixture("golden-multi/coverage-b.info"), file: "coverage/b/lcov.info" },
      ],
      format: "auto",
    });

    // Asserted before the file snapshots, so a run that would write a missing snapshot still fails here first.
    expectValidReport(report);
    expect(report.diffCoverage?.format).toBe("lcov");
    const measured = report.diffCoverage?.files.map(({ path, coveredLines, coverableLines, uncoveredLines }) => ({
      path,
      coveredLines,
      coverableLines,
      uncoveredLines,
    }));
    // src/math.ts line 3 is covered only in coverage-a.info, line 4 only in coverage-b.info; src/new.ts line 4 only
    // in coverage-b.info. A line covered in either file counts as covered.
    expect(measured).toEqual([
      { path: "src/math.ts", coveredLines: 3, coverableLines: 4, uncoveredLines: [10] },
      { path: "src/new.ts", coveredLines: 1, coverableLines: 2, uncoveredLines: [5] },
      { path: "src/utils/new-name.ts", coveredLines: 1, coverableLines: 1, uncoveredLines: [] },
    ]);
    expect(report.diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7, percent: 71.43 });

    // The two halves merge into the single golden coverage, so the report is the single-file golden report.
    const single = golden(check, "golden", { text: fixture("golden/coverage.info"), format: "lcov" });
    expect(report).toEqual(single);
    expect(renderMarkdown(report)).toBe(renderMarkdown(single));

    await expect(asFile(report)).toMatchFileSnapshot("../../../fixtures/golden-multi/report.json");
    await expect(renderMarkdown(report)).toMatchFileSnapshot("../../../fixtures/golden-multi/report.md");
  });
});
