import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check() and the fixtures are loaded inside each test body: the AC tests are written before the multi-file coverage
// input and fixtures/coverage-multi/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Selection = "lcov" | "cobertura" | "auto";
type FileInput = { text: string; file?: string } | { missingFile: string };
type Options = { threshold?: number | null; dir?: string; coverageRoot?: string };

const lines = (path: string) => fixture(path).trim().split("\n");

async function runCheck(files: FileInput[], format: Selection, options: Options = {}) {
  const { check } = await import("../src/check.js");
  const dir = options.dir ?? "golden";
  const input = {
    version: "0.1.0",
    coverage: { files, format },
    diff: { text: fixture(`${dir}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: options.threshold === undefined ? 80 : options.threshold,
    repoFiles: lines(`${dir}/files.txt`),
    ...(options.coverageRoot === undefined ? {} : { coverageRoot: options.coverageRoot }),
  };
  return check(input as Parameters<typeof check>[0]);
}

const codes = (report: { messages: { code: string }[] }) => report.messages.map((message) => message.code);
const measured = (report: Awaited<ReturnType<typeof runCheck>>) =>
  report.diffCoverage?.files.map(({ path, coveredLines, coverableLines }) => ({ path, coveredLines, coverableLines }));

const GOLDEN_MEASURED = [
  { path: "src/math.ts", coveredLines: 3, coverableLines: 4 },
  { path: "src/new.ts", coveredLines: 1, coverableLines: 2 },
  { path: "src/utils/new-name.ts", coveredLines: 1, coverableLines: 1 },
];

describe("check(): several coverage files", () => {
  it("AC-4: lcov plus Cobertura under auto counts lines from both and has no format; two Cobertura files have format cobertura", async () => {
    const mixed = await runCheck(
      [
        { text: fixture("coverage-multi/mixed/math.info"), file: "coverage/math.info" },
        { text: fixture("coverage-multi/mixed/new.xml"), file: "coverage/new.xml" },
      ],
      "auto",
    );
    expectValidReport(mixed);
    expect(mixed.diffCoverage).not.toBeNull();
    // src/math.ts is measured from the lcov file, src/new.ts and src/utils/new-name.ts from the Cobertura file.
    expect(measured(mixed)).toEqual(GOLDEN_MEASURED);
    expect(mixed.diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7 });
    expect(mixed.diffCoverage ?? {}).not.toHaveProperty("format");

    const cobertura = await runCheck(
      [
        { text: fixture("coverage-multi/mixed/math.xml"), file: "coverage/math.xml" },
        { text: fixture("coverage-multi/mixed/new.xml"), file: "coverage/new.xml" },
      ],
      "auto",
    );
    expectValidReport(cobertura);
    expect(measured(cobertura)).toEqual(GOLDEN_MEASURED);
    expect(cobertura.diffCoverage?.format).toBe("cobertura");
  });

  it("AC-5: an explicit lcov format reads the Cobertura file as lcov, so it is COVERAGE_FILE_EMPTY naming that file", async () => {
    const report = await runCheck(
      [
        { text: fixture("coverage-multi/mixed/math.info"), file: "coverage/math.info" },
        { text: fixture("coverage-multi/mixed/new.xml"), file: "coverage/new.xml" },
      ],
      "lcov",
    );
    expectValidReport(report);
    expect(report.diffCoverage).toBeNull();
    expect(codes(report)).toContain("COVERAGE_FILE_EMPTY");
    expect(codes(report)).not.toContain("COVERAGE_FORMAT_UNSUPPORTED");
    const empty = report.messages.find((message) => message.code === "COVERAGE_FILE_EMPTY");
    expect(empty?.text).toContain("coverage/new.xml");
    expect(empty?.text).not.toContain("math.info");
  });

  it("AC-6: one coverage root applies to every file, so package-relative files land at their repo paths", async () => {
    const report = await runCheck(
      [
        { text: fixture("coverage-multi/monorepo/package-relative/a.info"), file: "packages/a/lcov.info" },
        { text: fixture("coverage-multi/monorepo/package-relative/b.info"), file: "packages/b/lcov.info" },
      ],
      "auto",
      { dir: "coverage-multi/monorepo", coverageRoot: "packages", threshold: null },
    );
    expectValidReport(report);
    expect(codes(report).filter((code) => code.startsWith("COVERAGE_PATHS_"))).toEqual([]);
    expect(measured(report)).toEqual([
      { path: "packages/a/src/index.ts", coveredLines: 1, coverableLines: 2 },
      { path: "packages/b/src/index.ts", coveredLines: 2, coverableLines: 2 },
    ]);
    expect(report.diffCoverage).toMatchObject({ coveredLines: 3, coverableLines: 4 });
  });

  it("AC-7: an entry that resolved to nothing gives one COVERAGE_FILE_MISSING naming it, error with a threshold and warn without", async () => {
    for (const [threshold, level, verdict] of [
      [80, "error", "fail"],
      [null, "warn", "warn"],
    ] as const) {
      const label = `threshold ${threshold}`;
      const report = await runCheck(
        [
          { missingFile: "coverage/missing/lcov.info" },
          { text: fixture("golden/coverage.info"), file: "coverage/lcov.info" },
        ],
        "auto",
        { threshold },
      );
      expectValidReport(report);
      expect(report.diffCoverage, label).toBeNull();
      expect(report.verdict, label).toBe(verdict);
      expect(report.messages, label).toEqual([
        { level, code: "COVERAGE_FILE_MISSING", text: "Coverage file not found: coverage/missing/lcov.info" },
      ]);
    }
  });

  it("AC-8: a valid file paired with an empty, a no-lines or a Clover file fails naming the bad file only", async () => {
    const valid = { text: fixture("golden/coverage.info"), file: "coverage/valid.info" };
    for (const [fixturePath, file, code, text] of [
      [
        "lcov/empty.info",
        "coverage/empty.info",
        "COVERAGE_FILE_EMPTY",
        "Coverage file coverage/empty.info contains no coverage records; check its format and that the tests wrote it.",
      ],
      [
        "lcov/no-lines.info",
        "coverage/no-lines.info",
        "COVERAGE_FILE_EMPTY",
        "Coverage file coverage/no-lines.info contains no coverage records; check its format and that the tests wrote it.",
      ],
      [
        "cobertura/clover.xml",
        "coverage/clover.xml",
        "COVERAGE_FORMAT_UNSUPPORTED",
        "Coverage file coverage/clover.xml is not in a recognized coverage format; pharn-ci reads lcov and Cobertura XML.",
      ],
    ] as const) {
      const report = await runCheck([valid, { text: fixture(fixturePath), file }], "auto", { threshold: 80 });
      expectValidReport(report);
      expect(report.diffCoverage, file).toBeNull();
      expect(report.verdict, file).toBe("fail");
      expect(report.messages, file).toEqual([{ level: "error", code, text }]);
      expect(report.messages[0]?.text, file).not.toContain("valid.info");
    }
  });

  it("AC-9: the paths-unmatched checks run over the merged map", async () => {
    const none = await runCheck(
      [
        { text: fixture("coverage-multi/unmatched-a.info"), file: "coverage/unmatched-a.info" },
        { text: fixture("coverage-multi/unmatched-b.info"), file: "coverage/unmatched-b.info" },
      ],
      "auto",
    );
    expectValidReport(none);
    expect(none.diffCoverage).toBeNull();
    const unmatched = none.messages.filter((message) => message.code === "COVERAGE_PATHS_UNMATCHED");
    expect(unmatched).toHaveLength(1);
    // One path in unmatched-a.info and two in unmatched-b.info.
    expect(unmatched[0]?.text).toContain("None of the 3 file paths");

    const partial = await runCheck(
      [
        { text: fixture("golden/coverage.info"), file: "coverage/lcov.info" },
        { text: fixture("coverage-multi/unmatched-a.info"), file: "coverage/unmatched-a.info" },
      ],
      "auto",
    );
    expectValidReport(partial);
    expect(codes(partial)).not.toContain("COVERAGE_PATHS_UNMATCHED");
    const partialMessages = partial.messages.filter((message) => message.code === "COVERAGE_PATHS_PARTIALLY_UNMATCHED");
    expect(partialMessages).toHaveLength(1);
    // src/legacy.ts from the golden coverage and lib/one.ts from unmatched-a.info.
    expect(partialMessages[0]?.text).toContain("2 file paths");
    expect(measured(partial)).toEqual(GOLDEN_MEASURED);
    expect(partial.diffCoverage).toMatchObject({ coveredLines: 5, coverableLines: 7 });
  });
});
