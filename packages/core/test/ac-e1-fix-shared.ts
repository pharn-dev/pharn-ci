import { fixture } from "./helpers.js";
import { expectValidReport } from "./schema.js";

export const REPO_ROOT = "/home/runner/work/demo/demo";

/** check() on a fixture diff under fixtures/test-integrity/, in the given mode, validated against the v2 schema. */
export function runFixture(diff: string, mode: "block" | "warn" | "off" = "block") {
  return runDiff(fixture(`test-integrity/${diff}`), mode);
}

/** check() on a diff text, in the given mode, validated against the v2 schema. */
export async function runDiff(text: string, mode: "block" | "warn" | "off" = "block") {
  const { check } = await import("../src/check.js");
  const report = check({
    version: "0.1.0",
    coverage: { text: fixture("test-files-deleted/coverage.info"), format: "lcov" },
    diff: { text },
    repoRoot: REPO_ROOT,
    threshold: 80,
    repoFiles: fixture("test-files-deleted/files.txt").trim().split("\n"),
    testIntegrityMode: { input: mode },
  } as Parameters<typeof check>[0]);
  expectValidReport(report);
  return report;
}

export type FixtureReport = Awaited<ReturnType<typeof runFixture>>;

export const signalsOf = (report: FixtureReport, id: string) =>
  report.testIntegrity.signals.filter((signal) => String(signal.id) === id);

export const messagesOf = (report: FixtureReport, code: string) =>
  report.messages.filter((message) => String(message.code) === code);
