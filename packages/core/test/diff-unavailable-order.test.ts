import { describe, expect, it } from "vitest";
import { chooseDiscoveredCoverage } from "../src/coverageDiscovery.js";
import { check, renderMarkdown } from "../src/index.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-91: an unavailable diff is always reported. check() used to return a missing or undiscovered coverage file
// before it looked at the diff, so with no coverage file and no diff, test-integrity block passed a change nothing was
// checked against, and the comment said there were no test-integrity findings. The table covers coverage (present,
// missing, not discovered) x diff (available, unavailable) x mode (block, warn) x threshold (set, unset).

type Coverage = "present" | "missing" | "not discovered";
type Diff = "available" | "unavailable";
type Mode = "block" | "warn";
type CheckInput = Parameters<typeof check>[0];

const THRESHOLD = 50; // the golden change is 71.43% covered: it meets 50, so a set threshold fails only on a missing input
const NOT_CHECKED = "Not checked: the diff is unavailable";
/** The codes that say why diff coverage passed, failed or was not computed. */
const DIFF_COVERAGE_CODES: readonly string[] = [
  "DIFF_UNAVAILABLE",
  "COVERAGE_FILE_MISSING",
  "COVERAGE_FILE_EMPTY",
  "COVERAGE_FORMAT_UNSUPPORTED",
  "COVERAGE_PATHS_UNMATCHED",
  "DIFF_COVERAGE_BELOW_THRESHOLD",
  "DIFF_COVERAGE_UNGATED",
  "NO_COVERABLE_CHANGES",
];

function coverageInput(coverage: Coverage): CheckInput["coverage"] {
  if (coverage === "present")
    return { text: fixture("golden/coverage.info"), format: "lcov", file: "coverage/lcov.info" };
  if (coverage === "missing") return { missingFile: "coverage/lcov.info" };
  // The not-found outcome of coverage auto-discovery when none of the candidate paths exists.
  const notFound = chooseDiscoveredCoverage([]);
  if (notFound.kind !== "not-found") throw new Error("expected discovery to find nothing");
  return notFound;
}

function run(coverage: Coverage, diff: Diff, mode: Mode | "off", threshold: number | null) {
  const report = check({
    version: "0.1.0",
    coverage: coverageInput(coverage),
    diff:
      diff === "available"
        ? { text: fixture("golden/pr.diff") }
        : { unavailable: "could not get the diff for base...head" },
    repoRoot: "/home/runner/work/demo/demo",
    threshold,
    repoFiles: fixture("golden/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  });
  expectValidReport(report);
  return report;
}

interface Row {
  coverage: Coverage;
  diff: Diff;
  mode: Mode;
  threshold: number | null;
  /** The diff-coverage message code the row must carry, once, and the level it must have; null for none. */
  code: string | null;
  level: "error" | "warn" | "info" | null;
  verdict: "pass" | "warn" | "fail";
}

/** The expected outcome of each cell, written out from the rules rather than read back from the code. */
function expected(coverage: Coverage, diff: Diff, mode: Mode, threshold: number | null): Row {
  const base = { coverage, diff, mode, threshold };
  if (diff === "unavailable") {
    // The diff comes first, whatever the coverage: an error under a threshold or in block, a warning otherwise.
    const level = threshold !== null || mode === "block" ? "error" : "warn";
    return { ...base, code: "DIFF_UNAVAILABLE", level, verdict: level === "error" ? "fail" : "warn" };
  }
  if (coverage === "present") {
    // Unchanged: diff coverage is measured, and 71.43% meets 50 with no message; without a threshold it is reported
    // as not gated.
    return threshold === null
      ? { ...base, code: "DIFF_COVERAGE_UNGATED", level: "info", verdict: "pass" }
      : { ...base, code: null, level: null, verdict: "pass" };
  }
  // Unchanged: a missing or undiscovered coverage file is COVERAGE_FILE_MISSING, an error only under a threshold.
  const level = threshold === null ? "warn" : "error";
  return { ...base, code: "COVERAGE_FILE_MISSING", level, verdict: level === "error" ? "fail" : "warn" };
}

const ROWS: Row[] = [];
for (const coverage of ["present", "missing", "not discovered"] as const)
  for (const diff of ["available", "unavailable"] as const)
    for (const mode of ["block", "warn"] as const)
      for (const threshold of [THRESHOLD, null]) ROWS.push(expected(coverage, diff, mode, threshold));

const label = (row: Row) =>
  `coverage ${row.coverage}, diff ${row.diff}, ${row.mode}, threshold ${row.threshold === null ? "unset" : row.threshold}`;

describe("check(): an unavailable diff is reported before a coverage problem (CORE-91)", () => {
  it.each(ROWS.map((row) => [label(row), row] as const))("%s", (_name, row) => {
    const report = run(row.coverage, row.diff, row.mode, row.threshold);
    const codes = report.messages.map((m) => m.code);
    if (row.code === null) {
      expect(report.diffCoverage?.percent).toBe(71.43);
      expect(report.diffCoverage?.threshold).toBe(THRESHOLD);
      expect(codes.filter((c) => DIFF_COVERAGE_CODES.includes(c))).toEqual([]);
    } else {
      const matching = report.messages.filter((m) => m.code === row.code);
      expect(matching, `${row.code} in ${codes.join(", ")}`).toHaveLength(1);
      expect(matching[0]?.level).toBe(row.level);
    }
    expect(report.verdict).toBe(row.verdict);
    if (row.diff === "unavailable") {
      // Only the diff is named: the coverage problem shows on the next run, once the diff is available.
      expect(codes).not.toContain("COVERAGE_FILE_MISSING");
      expect(report.diffCoverage).toBeNull();
    } else {
      expect(codes).not.toContain("DIFF_UNAVAILABLE");
    }
  });

  it("the ticket's key rows: no coverage and no diff fails in block and warns in warn without a threshold", () => {
    for (const coverage of ["missing", "not discovered"] as const) {
      const block = run(coverage, "unavailable", "block", null);
      expect(block.verdict, `${coverage}, block`).toBe("fail");
      expect(block.messages.find((m) => m.code === "DIFF_UNAVAILABLE")?.level, `${coverage}, block`).toBe("error");

      const warn = run(coverage, "unavailable", "warn", null);
      expect(warn.verdict, `${coverage}, warn`).toBe("warn");
      expect(warn.messages.find((m) => m.code === "DIFF_UNAVAILABLE")?.level, `${coverage}, warn`).toBe("warn");
    }
  });
});

describe("renderMarkdown(): the Test integrity section and summary cell when the diff is unavailable (CORE-91)", () => {
  /** The Test integrity section's body: the lines between its heading and the next heading. */
  function sectionOf(markdown: string): string {
    const start = markdown.indexOf("### 🔍 Test integrity");
    expect(start, "a Test integrity section").toBeGreaterThan(-1);
    const rest = markdown.slice(start + "### 🔍 Test integrity".length);
    const next = rest.indexOf("\n### ");
    return (next === -1 ? rest : rest.slice(0, next)).trim();
  }
  /** The Test integrity cell of the summary table's data row. */
  function cellOf(markdown: string): string {
    const lines = markdown.split("\n");
    const header = lines.findIndex((l) => l.startsWith("| Verdict | Diff coverage | Test integrity |"));
    expect(header, "a summary table").toBeGreaterThan(-1);
    return (lines[header + 2] ?? "").split("|")[3]?.trim() ?? "";
  }

  for (const row of ROWS) {
    it(label(row), () => {
      const markdown = renderMarkdown(run(row.coverage, row.diff, row.mode, row.threshold));
      if (row.diff === "unavailable") {
        expect(sectionOf(markdown)).toBe(`${NOT_CHECKED}.`);
        expect(cellOf(markdown)).toBe(NOT_CHECKED);
        expect(markdown).not.toContain("No test-integrity findings");
        expect(markdown).not.toContain(`none (${row.mode})`);
      } else {
        expect(sectionOf(markdown)).toBe(`No test-integrity findings (mode: ${row.mode}).`);
        expect(cellOf(markdown)).toBe(`none (${row.mode})`);
        expect(markdown).not.toContain(NOT_CHECKED);
      }
    });
  }

  it("test integrity off still says it is off, with or without a diff", () => {
    for (const diff of ["available", "unavailable"] as const) {
      const markdown = renderMarkdown(run("missing", diff, "off", null));
      expect(sectionOf(markdown), diff).toBe("Test integrity is off for this run.");
      expect(cellOf(markdown), diff).toBe("off");
    }
  });
});
