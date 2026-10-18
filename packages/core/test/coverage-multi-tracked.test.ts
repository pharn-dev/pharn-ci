import { describe, expect, it } from "vitest";
import { check } from "../src/check.js";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// F-09 meets F-22: with several coverage files, a tracked one still means the change can grade itself.

const REPO_ROOT = "/home/runner/work/demo/demo";
const files = fixture("golden-multi/files.txt").trim().split("\n");

function run(trackedPaths: readonly string[]) {
  return check({
    version: "0.1.0",
    coverage: {
      files: [
        { text: fixture("golden-multi/coverage-a.info"), file: "coverage/a.info" },
        { text: fixture("golden-multi/coverage-b.info"), file: `${REPO_ROOT}/coverage/b.info` },
      ],
      format: "auto",
    },
    diff: { text: fixture("golden-multi/pr.diff") },
    repoRoot: REPO_ROOT,
    threshold: null,
    repoFiles: [...files, ...trackedPaths],
  });
}

describe("check(): COVERAGE_FILE_TRACKED with several coverage files", () => {
  it("names the first tracked file, relative or absolute under the repo root", () => {
    const second = run(["coverage/b.info"]);
    expectValidReport(second);
    const tracked = second.messages.filter((m) => m.code === "COVERAGE_FILE_TRACKED");
    expect(tracked).toHaveLength(1);
    expect(tracked[0]?.text).toContain("`coverage/b.info`");

    const both = run(["coverage/a.info", "coverage/b.info"]);
    expectValidReport(both);
    const first = both.messages.filter((m) => m.code === "COVERAGE_FILE_TRACKED");
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toContain("`coverage/a.info`");
  });

  it("adds nothing when no coverage file is tracked", () => {
    const report = run([]);
    expectValidReport(report);
    expect(report.messages.map((m) => m.code)).not.toContain("COVERAGE_FILE_TRACKED");
  });
});
