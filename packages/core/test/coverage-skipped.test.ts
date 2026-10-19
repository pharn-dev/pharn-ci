import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { readCoverageChunks } from "../src/chunkInputs.js";
import { parseCoverage, parseCoverageCounted } from "../src/coverage/index.js";
import { renderMarkdown } from "../src/render/markdown.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

const CODE = "COVERAGE_LINES_SKIPPED";

type Message = { level: string; code: string; text: string };

const skippedMessages = (report: { messages: readonly Message[] }) => report.messages.filter((m) => m.code === CODE);

// A diff that adds lines 3 and 4 of src/math.ts.
const DIFF = [
  "diff --git a/src/math.ts b/src/math.ts",
  "index 1111111..2222222 100644",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -2,0 +3,2 @@",
  "+  if (a < 0) {",
  "+    return 0;",
  "",
].join("\n");

const run = (coverage: unknown) =>
  check({
    version: "0.1.0",
    coverage,
    diff: { text: DIFF },
    repoFiles: ["src/math.ts"],
    threshold: null,
  } as unknown as Parameters<typeof check>[0]);

/** The text cut into chunks of `size` characters, as a stream. */
async function* chunked(text: string, size: number): AsyncIterable<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

const LCOV_CASES: ReadonlyArray<[string, number]> = [
  ["lcov/merge-and-malformed.info", 4],
  ["lcov/some-without-lines.info", 1],
  ["lcov/relative.info", 0],
];

const COBERTURA_CASES: ReadonlyArray<[string, number]> = [
  ["cobertura/invalid-lines.xml", 7],
  ["cobertura/partial-valid.xml", 3],
  ["cobertura/methods-branches.xml", 0],
  ["cobertura/coveragepy.xml", 0],
];

describe("counted parsers", () => {
  it.each(LCOV_CASES)("lcov %s skips %i record(s) and builds the same map as parseCoverage", (path, count) => {
    const counted = parseCoverageCounted(fixture(path), "lcov");
    expect(counted.skipped).toBe(count);
    expect(counted.map).toEqual(parseCoverage(fixture(path), "lcov"));
  });

  it.each(COBERTURA_CASES)(
    "cobertura %s skips %i record(s) and builds the same map as parseCoverage",
    (path, count) => {
      const counted = parseCoverageCounted(fixture(path), "cobertura");
      expect(counted.skipped).toBe(count);
      expect(counted.map).toEqual(parseCoverage(fixture(path), "cobertura"));
    },
  );
});

describe("readCoverageChunks: skipped count", () => {
  it.each([...LCOV_CASES.map(([p]) => [p, "lcov"]), ...COBERTURA_CASES.map(([p]) => [p, "cobertura"])] as const)(
    "%s streamed in small chunks counts the same as parseCoverageCounted",
    async (path, format) => {
      const text = fixture(path);
      const expected = parseCoverageCounted(text, format).skipped;
      for (const size of [7, 64, 100_000]) {
        const read = await readCoverageChunks(chunked(text, size), "auto");
        expect(read.skipped, `${path} in chunks of ${size}`).toBe(expected);
      }
    },
  );

  it("reports 0 for an empty file", async () => {
    const read = await readCoverageChunks(chunked("", 8), "auto");
    expect(read.skipped).toBe(0);
    expect(read.parsed.size).toBe(0);
  });
});

describe("check(): COVERAGE_LINES_SKIPPED", () => {
  it("a report whose every record is malformed stays COVERAGE_FILE_EMPTY alone", () => {
    const report = run({ text: fixture("lcov/only-malformed.info"), format: "auto" });
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).toContain("COVERAGE_FILE_EMPTY");
    expect(skippedMessages(report)).toEqual([]);
  });

  it("sums a parsed entry's count and a text entry's count into one message", () => {
    const parsed = parseCoverageCounted("SF:src/math.ts\nDA:3,1\nDA:4,0\nend_of_record\n", "lcov").map;
    const text = "SF:src/math.ts\nDA:3,1\nDA:q,1\nend_of_record\n";
    const report = run({
      files: [
        { parsed, format: "lcov", file: "a.info", skipped: 2 },
        { text, file: "b.info" },
      ],
      format: "auto",
    });
    expectValidReport(report);
    const skipped = skippedMessages(report);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.level).toBe("info");
    expect(skipped[0]?.text).toContain("3");
  });

  it.each([0, -1, 1.5, Number.NaN])("a parsed entry with skipped %s adds no message", (skipped) => {
    const parsed = parseCoverageCounted("SF:src/math.ts\nDA:3,1\nDA:4,0\nend_of_record\n", "lcov").map;
    const report = run({ files: [{ parsed, format: "lcov", file: "a.info", skipped }], format: "auto" });
    expectValidReport(report);
    expect(skippedMessages(report)).toEqual([]);
  });

  it("uses the singular for one record", () => {
    const report = run({ text: "SF:src/math.ts\nDA:3,1\nDA:4\nend_of_record\n", format: "auto" });
    expectValidReport(report);
    const skipped = skippedMessages(report);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.text).toMatch(/^1 malformed coverage record was skipped/);
  });

  it("is not added to a report that ends before diff coverage is computed", () => {
    // Every path in the report is untracked, so the report ends as COVERAGE_PATHS_UNMATCHED.
    const report = check({
      version: "0.1.0",
      coverage: { text: "SF:other/file.ts\nDA:1,1\nDA:x,1\nend_of_record\n", format: "auto" },
      diff: { text: DIFF },
      repoFiles: ["src/math.ts"],
      threshold: null,
    });
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).toContain("COVERAGE_PATHS_UNMATCHED");
    expect(skippedMessages(report)).toEqual([]);
  });

  it("renders the code with its fixed hint", () => {
    const report = run({ text: "SF:src/math.ts\nDA:3,1\nDA:4\nend_of_record\n", format: "auto" });
    expectValidReport(report);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain(CODE);
    expect(markdown).toContain("Regenerate the coverage report");
  });
});
