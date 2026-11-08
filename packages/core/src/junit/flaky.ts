import type { Message, ReportFlaky } from "../report.js";
import { codeSpan } from "../report.js";
import { byCodeUnit } from "../text.js";
import type { JunitResults } from "./results.js";

/** `n` and the singular or plural words. */
const formatCount = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The most ids `flaky.quarantined` holds. */
export const FLAKY_QUARANTINED_CAP = 200;
/** The most paths a JUnit message names. */
const NAMED_PATHS = 10;

/** What the run's JUnit results come to under a quarantine list, before the report or a summary is made of them. */
export interface FlakyTally {
  testCount: number;
  /** Failed and errored test cases. */
  failed: number;
  quarantinedFailures: number;
  unquarantinedFailures: number;
  /** The distinct ids of the quarantined failures, sorted in code-unit order (all of them, no cap). */
  quarantinedIds: string[];
}

/**
 * Counts the test cases of the results: a failed or errored case whose id is on the quarantine list is a quarantined
 * failure, any other one is not. A test that fails in two files counts twice. No list (or an empty one) quarantines
 * nothing.
 */
export function tallyJunit(results: JunitResults, quarantine: readonly string[] | undefined): FlakyTally {
  const listed = new Set(quarantine ?? []);
  const quarantinedIds = new Set<string>();
  let failed = 0;
  let quarantinedFailures = 0;
  for (const testCase of results.cases) {
    if (testCase.status !== "failed" && testCase.status !== "error") continue;
    failed++;
    if (listed.has(testCase.id)) {
      quarantinedFailures++;
      quarantinedIds.add(testCase.id);
    }
  }
  return {
    testCount: results.cases.length,
    failed,
    quarantinedFailures,
    unquarantinedFailures: failed - quarantinedFailures,
    quarantinedIds: [...quarantinedIds].sort(byCodeUnit),
  };
}

/**
 * True when the results account for a failed test command by quarantined tests alone: every file that matched was read
 * and parsed whole (no refused file, nothing left out by a cap, no walk limit), at least one test failed, and every
 * failed test is quarantined. The `pharn-ci test` wrapper exits 0 only then.
 */
export function failuresAllQuarantined(results: JunitResults, tally: FlakyTally): boolean {
  return (
    results.parsed > 0 &&
    results.invalid.length === 0 &&
    results.dropped.length === 0 &&
    results.droppedCases === 0 &&
    !results.walkLimit &&
    tally.failed > 0 &&
    tally.unquarantinedFailures === 0
  );
}

/** Up to 10 entries, then `+N more`. */
function namedPaths(paths: readonly string[]): string {
  const named = paths.slice(0, NAMED_PATHS).join(", ");
  return paths.length > NAMED_PATHS ? `${named}, +${paths.length - NAMED_PATHS} more` : named;
}

/**
 * The report's `flaky` object and the JUnit messages of a run. `flaky` is present when at least one file was parsed;
 * `uploaded` is false here (the Action sets it once the results are stored). The messages: JUNIT_NOT_FOUND (warn) when
 * no file matched, JUNIT_INVALID (warn) naming the refused files with a reason word each, JUNIT_TOO_LARGE (warn) when a
 * cap or the walk limit left something out, and FLAKY_QUARANTINED_FAILURES (info) when a failure is quarantined. They
 * hold counts, fixed words and paths, never a test name or file text, and none of them is an error: pharn-ci never fails
 * because a test failed.
 */
export function junitReport(
  results: JunitResults,
  quarantine: readonly string[] | undefined,
): { flaky?: ReportFlaky; messages: Message[] } {
  const messages: Message[] = [];
  if (results.notFound) {
    messages.push({
      level: "warn",
      code: "JUNIT_NOT_FOUND",
      text: "No JUnit XML file matched the JUnit paths, so the test results are not reported. Check that the test step writes its JUnit report where the paths point, and that it ran before pharn-ci.",
    });
  }
  if (results.invalid.length > 0) {
    const n = results.invalid.length;
    const listed = results.invalid.map((file) => `${codeSpan(file.path)} (${file.reason})`);
    messages.push({
      level: "warn",
      code: "JUNIT_INVALID",
      text: `${formatCount(n, "JUnit XML file was", "JUnit XML files were")} not used: ${namedPaths(listed)}. A file with a DOCTYPE or another <! declaration (doctype), broken nesting (malformed), no testsuites or testsuite root (not-junit) or nesting deeper than 256 (too-deep) is refused whole.`,
    });
  }
  if (results.dropped.length > 0 || results.droppedCases > 0 || results.walkLimit) {
    const parts: string[] = [];
    if (results.dropped.length > 0) parts.push(formatCount(results.dropped.length, "file", "files"));
    if (results.droppedCases > 0) parts.push(formatCount(results.droppedCases, "test case", "test cases"));
    const left = parts.length === 0 ? "" : ` ${parts.join(" and ")} left out`;
    const walk = results.walkLimit
      ? " The search for JUnit files stopped at its limit, so some may not have been found."
      : "";
    messages.push({
      level: "warn",
      code: "JUNIT_TOO_LARGE",
      text: `The JUnit results are over the limits of one run (50 files, 25 MiB, 20,000 test cases)${left === "" ? "" : `:${left}`}.${walk}`,
    });
  }
  if (results.parsed === 0) return { messages };
  const tally = tallyJunit(results, quarantine);
  if (tally.quarantinedFailures > 0) {
    messages.push({
      level: "info",
      code: "FLAKY_QUARANTINED_FAILURES",
      text: `${tally.quarantinedFailures} of ${formatCount(tally.failed, "failed test is", "failed tests are")} on the org's quarantine list. pharn-ci never fails a check because a test failed; the test step decides.`,
    });
  }
  return {
    flaky: {
      uploaded: false,
      testCount: tally.testCount,
      failed: tally.failed,
      quarantined: tally.quarantinedIds.slice(0, FLAKY_QUARANTINED_CAP),
      quarantinedFailures: tally.quarantinedFailures,
      unquarantinedFailures: tally.unquarantinedFailures,
    },
    messages,
  };
}
