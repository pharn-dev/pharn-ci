import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

// check(), the renderer and the fixtures are loaded inside each test body: the AC tests are written before the
// coverage path check and fixtures/coverage-paths/ exist, so nothing that depends on them may run while the file loads.

const REPO_ROOT = "/home/runner/work/demo/demo";

type Message = { level: string; code: string; text: string };
type CheckOptions = { threshold: number | null; repoFiles?: string[]; coverageRoot?: string };

const lines = (path: string) => fixture(path).trim().split("\n");
const asFile = (report: unknown) => `${JSON.stringify(report, null, 2)}\n`;

async function runCheck(dir: string, options: CheckOptions) {
  const { check } = await import("../src/check.js");
  const input = {
    version: "0.1.0",
    coverage: { text: fixture(`coverage-paths/${dir}/coverage.info`), format: "lcov" as const },
    diff: { text: fixture(`coverage-paths/${dir}/pr.diff`) },
    repoRoot: REPO_ROOT,
    threshold: options.threshold,
    repoFiles: options.repoFiles ?? lines(`coverage-paths/${dir}/files.txt`),
    ...(options.coverageRoot === undefined ? {} : { coverageRoot: options.coverageRoot }),
  };
  return check(input as Parameters<typeof check>[0]);
}

const withCode = (messages: readonly Message[], code: string) => messages.filter((message) => message.code === code);
const codes = (messages: readonly Message[]) => messages.map((message) => message.code);

describe("check(): coverage paths that match no tracked file", () => {
  it("AC-1: package-relative lcov fails with a threshold, warns without, and names packages/core as the coverage root", async () => {
    const { renderMarkdown } = await import("../src/render/markdown.js");

    const failing = await runCheck("package-relative", { threshold: 80 });
    expectValidReport(failing);
    expect(failing.verdict).toBe("fail");
    expect(failing.diffCoverage).toBeNull();
    const failMessages = withCode(failing.messages, "COVERAGE_PATHS_UNMATCHED");
    expect(failMessages).toHaveLength(1);
    expect(failMessages[0]?.level).toBe("error");
    expect(failMessages[0]?.text).toContain("`packages/core`");
    expect(failMessages[0]?.text).toContain("coverage-root");
    expect(codes(failing.messages)).not.toContain("NO_COVERABLE_CHANGES");

    const warning = await runCheck("package-relative", { threshold: null });
    expectValidReport(warning);
    expect(warning.verdict).toBe("warn");
    expect(warning.diffCoverage).toBeNull();
    const warnMessages = withCode(warning.messages, "COVERAGE_PATHS_UNMATCHED");
    expect(warnMessages).toHaveLength(1);
    expect(warnMessages[0]?.level).toBe("warn");
    expect(warnMessages[0]?.text).toContain("`packages/core`");
    expect(warnMessages[0]?.text).toContain("coverage-root");
    expect(codes(warning.messages)).not.toContain("NO_COVERABLE_CHANGES");

    // Asserted before the file snapshots, so a wrong report fails here instead of being written as a new snapshot.
    await expect(asFile(failing)).toMatchFileSnapshot("../../../fixtures/coverage-paths/package-relative/report.json");
    await expect(renderMarkdown(failing)).toMatchFileSnapshot(
      "../../../fixtures/coverage-paths/package-relative/report.md",
    );
    await expect(asFile(warning)).toMatchFileSnapshot(
      "../../../fixtures/coverage-paths/package-relative/report-warn.json",
    );
  });

  it("AC-2: an absolute path from another root stays unmatched, with or without a coverage root, and is named", async () => {
    for (const coverageRoot of [undefined, "src"]) {
      const label = `coverage root ${coverageRoot ?? "absent"}`;
      const report = await runCheck("absolute-elsewhere", { threshold: 100, coverageRoot });
      expectValidReport(report);
      expect(report.verdict, label).toBe("fail");
      expect(report.diffCoverage, label).toBeNull();
      const unmatched = withCode(report.messages, "COVERAGE_PATHS_UNMATCHED");
      expect(unmatched, label).toHaveLength(1);
      expect(unmatched[0]?.level, label).toBe("error");
      expect(unmatched[0]?.text, label).toContain("`/app/src/a.ts`");
      expect(codes(report.messages), label).not.toContain("NO_COVERABLE_CHANGES");
    }
  });

  it("AC-4: a docs-only change with mapped coverage still passes, and an empty tracked-files list skips both checks", async () => {
    const docsOnly = await runCheck("docs-only", { threshold: 100 });
    expectValidReport(docsOnly);
    expect(docsOnly.verdict).toBe("pass");
    const noCoverable = withCode(docsOnly.messages, "NO_COVERABLE_CHANGES");
    expect(noCoverable).toHaveLength(1);
    expect(noCoverable[0]?.level).toBe("info");
    expect(codes(docsOnly.messages)).not.toContain("COVERAGE_PATHS_UNMATCHED");
    expect(codes(docsOnly.messages)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");

    // The same docs-only change against a tracked-files list without src/a.ts does reach the check, so the pass
    // above comes from the coverage paths being tracked, not from the change touching no coverage path.
    const docsUnmapped = await runCheck("docs-only", { threshold: 100, repoFiles: ["AGENTS.md", "README.md"] });
    expectValidReport(docsUnmapped);
    expect(codes(docsUnmapped.messages)).toContain("COVERAGE_PATHS_UNMATCHED");

    const noRepoFiles = await runCheck("package-relative", { threshold: 80, repoFiles: [] });
    expectValidReport(noRepoFiles);
    expect(codes(noRepoFiles.messages)).not.toContain("COVERAGE_PATHS_UNMATCHED");
    expect(codes(noRepoFiles.messages)).not.toContain("COVERAGE_PATHS_PARTIALLY_UNMATCHED");

    // The same input with its tracked files is reported, so the skip above comes from the empty list.
    const withRepoFiles = await runCheck("package-relative", { threshold: 80 });
    expect(codes(withRepoFiles.messages)).toContain("COVERAGE_PATHS_UNMATCHED");
  });
});
