import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// CORE-92 (R3.1): a coverage report the pull request commits at the path the gate reads must not pass a gated run.
// COVERAGE_FILE_TRACKED is an error when a threshold is in force and the diff adds, modifies or renames to the tracked
// coverage file; otherwise it stays the warning it was. check() is loaded inside each test body: the tests are written
// before the change, so nothing that depends on it may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";
const COVERAGE = "coverage/lcov.info";
const repoFiles = fixture("tracked-coverage/files.txt").trim().split("\n");

type Message = { level: string; code: string; text: string };
type Report = { verdict: string; messages: Message[] };

const tracked = (report: Report) => report.messages.filter((message) => message.code === "COVERAGE_FILE_TRACKED");

async function run(options: {
  diff: string | null;
  threshold: number | null;
  file?: string;
  files?: readonly { text: string; file: string }[];
}): Promise<Report> {
  const { check } = await import("./text-coverage.js");
  const text = fixture("tracked-coverage/coverage.info");
  const coverage =
    options.files === undefined
      ? { text, file: options.file ?? COVERAGE, format: "lcov" as const }
      : { files: options.files, format: "lcov" as const };
  const report = check({
    version: "0.1.0",
    coverage,
    diff:
      options.diff === null
        ? { unavailable: "the base ref could not be read" }
        : { text: fixture(`tracked-coverage/${options.diff}`) },
    repoRoot: REPO_ROOT,
    threshold: options.threshold,
    repoFiles,
  } as Parameters<typeof check>[0]) as unknown as Report;
  expectValidReport(report);
  return report;
}

describe("COVERAGE_FILE_TRACKED under a threshold (CORE-92)", () => {
  it("AC-1: threshold 80 and the diff modifies the tracked report: an error naming the path and the fix, verdict fail", async () => {
    const report = await run({ diff: "modified.diff", threshold: 80 });
    const messages = tracked(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(report.verdict).toBe("fail");
    const text = messages[0]?.text ?? "";
    expect(text).toContain("`coverage/lcov.info`");
    expect(text).toContain("`git rm --cached coverage/lcov.info`");
    expect(text).toContain("let the test run write it");
    // The message never carries the report's content.
    for (const content of ["SF:", "DA:", "TN:", "end_of_record", "src/app.ts"]) expect(text).not.toContain(content);
  });

  it("AC-2: threshold 80 and the diff adds the tracked report, or renames a file to it: an error, verdict fail", async () => {
    for (const diff of ["added.diff", "renamed.diff"]) {
      const report = await run({ diff, threshold: 80 });
      const messages = tracked(report);
      expect(messages, diff).toHaveLength(1);
      expect(messages[0]?.level, diff).toBe("error");
      expect(report.verdict, diff).toBe("fail");
    }
  });

  it("AC-2: threshold 0 is in force too, and an absolute coverage path under the repo root counts the same", async () => {
    for (const [threshold, file] of [
      [0, COVERAGE],
      [80, `${REPO_ROOT}/${COVERAGE}`],
    ] as const) {
      const report = await run({ diff: "modified.diff", threshold, file });
      const messages = tracked(report);
      expect(messages, `${threshold} ${file}`).toHaveLength(1);
      expect(messages[0]?.level, `${threshold} ${file}`).toBe("error");
      expect(messages[0]?.text, `${threshold} ${file}`).not.toContain(REPO_ROOT);
      expect(report.verdict, `${threshold} ${file}`).toBe("fail");
    }
  });

  it("AC-3: no threshold and the same diffs: the warning as before, verdict warn", async () => {
    for (const diff of ["modified.diff", "added.diff", "renamed.diff"]) {
      const report = await run({ diff, threshold: null });
      const messages = tracked(report);
      expect(messages, diff).toHaveLength(1);
      expect(messages[0]?.level, diff).toBe("warn");
      expect(messages[0]?.text, diff).toBe(
        "The coverage file `coverage/lcov.info` is tracked in the repository, so the change under review can supply its own coverage numbers.",
      );
      expect(report.verdict, diff).toBe("warn");
    }
  });

  it("AC-4: threshold 80 and a tracked report the diff does not touch: the warning as before, verdict warn", async () => {
    const report = await run({ diff: "untouched.diff", threshold: 80 });
    const messages = tracked(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("warn");
    expect(messages[0]?.text).toBe(
      "The coverage file `coverage/lcov.info` is tracked in the repository, so the change under review can supply its own coverage numbers.",
    );
    expect(report.verdict).toBe("warn");
  });

  it("an unavailable diff cannot show the report changed: the tracked message stays a warning beside DIFF_UNAVAILABLE", async () => {
    const report = await run({ diff: null, threshold: 80 });
    expect(tracked(report).map((message) => message.level)).toEqual(["warn"]);
    expect(report.messages.find((message) => message.code === "DIFF_UNAVAILABLE")?.level).toBe("error");
  });

  it("with several coverage files, a tracked one the diff changes is named and fails, even after an untouched one", async () => {
    const text = fixture("tracked-coverage/coverage.info");
    const { check } = await import("./text-coverage.js");
    const report = check({
      version: "0.1.0",
      coverage: {
        files: [
          { text, file: "AGENTS.md" },
          { text, file: COVERAGE },
        ],
        format: "lcov",
      },
      diff: { text: fixture("tracked-coverage/modified.diff") },
      repoRoot: REPO_ROOT,
      threshold: 80,
      repoFiles,
    }) as unknown as Report;
    expectValidReport(report);
    const messages = tracked(report);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.level).toBe("error");
    expect(messages[0]?.text).toContain("`coverage/lcov.info`");
    expect(report.verdict).toBe("fail");
  });
});

describe("trackedCoverageInDiff (CORE-92)", () => {
  it("is true for a diff entry that adds, modifies or renames to the path, false for a deletion, a rename away or another path", async () => {
    const { trackedCoverageInDiff } = await import("../src/gateInputs.js");
    const { parseUnifiedDiff } = await import("../src/diff/unified.js");
    for (const [diff, expected] of [
      ["modified.diff", true],
      ["added.diff", true],
      ["renamed.diff", true],
      ["untouched.diff", false],
    ] as const) {
      expect(trackedCoverageInDiff(COVERAGE, parseUnifiedDiff(fixture(`tracked-coverage/${diff}`))), diff).toBe(
        expected,
      );
    }
    const renamedAway = parseUnifiedDiff(fixture("tracked-coverage/renamed.diff"));
    expect(trackedCoverageInDiff("reports/lcov.info", renamedAway)).toBe(false);
    const deleted = parseUnifiedDiff(
      "diff --git a/coverage/lcov.info b/coverage/lcov.info\ndeleted file mode 100644\nindex 4444444..0000000\n--- a/coverage/lcov.info\n+++ /dev/null\n@@ -1 +0,0 @@\n-TN:\n",
    );
    expect(trackedCoverageInDiff(COVERAGE, deleted)).toBe(false);
  });
});
