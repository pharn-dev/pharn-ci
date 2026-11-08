// v0.8.0 codes. Each v0.8.0 feature adds its own part of the " Codes added in v0.8.0:" sentence that the message-code
// description of report.v2.json gains, after the v0.7.0 sentence (v070-codes.ts). The schema pins that compare
// report.v2.json with an older commit take exactly this text out first (and, with `withoutV080SchemaEdits`, every other
// v0.8.0 schema insertion), so every other byte stays pinned. Features built in parallel add their part here as their
// own named constant; the sentence lists the parts in code-unit order of their codes.

/** Flaky tests' (A6: JUnit results, quarantine, the pharn-ci test wrapper) part of the v0.8.0 text. */
export const V080_FLAKY_TEXT =
  "FLAKY_QUARANTINED_FAILURES (info: failed tests of the JUnit results are on the org's quarantine list; the message names the counts, never a test name; pharn-ci never fails because a test failed), JUNIT_INVALID (warn: a JUnit XML file was refused whole for a DOCTYPE or other <! declaration, broken nesting, no testsuites or testsuite root or nesting deeper than 256; the message names up to 10 paths with a reason word each), JUNIT_NOT_FOUND (warn: JUnit paths were set and no file matched them) and JUNIT_TOO_LARGE (warn: the JUnit results went over the limits of one run, 50 files, 25 MiB or 20,000 test cases, or the search for files stopped at its limit; what is over is left out)";

/** The text appended to the message-code description (no character in it is escaped by JSON). */
export const V080_CODE_TEXT = ` Codes added in v0.8.0: ${V080_FLAKY_TEXT}.`;

/** Flaky tests' message codes, in code-unit order. */
export const V080_FLAKY_CODES = ["FLAKY_QUARANTINED_FAILURES", "JUNIT_INVALID", "JUNIT_NOT_FOUND", "JUNIT_TOO_LARGE"];

/** The message codes the v0.8.0 text names, in code-unit order. */
export const V080_CODES = [...V080_FLAKY_CODES];

/**
 * Flaky tests' insertion into the `flaky` property of report.v2.json: its description, right after the opening brace, as
 * the exact bytes the file gains.
 */
export const V080_FLAKY_SCHEMA_TEXT = `
      "description": "The run's JUnit results (since 0.8.0), from the files the junit-paths input or the CLI's --junit flag names. Present only when at least one JUnit XML file was parsed. A test id is <classname>::<name>, where classname falls back to the file attribute and then to the name of the enclosing testsuite (the name alone when all three are empty); whitespace and control characters are collapsed to one space; an id over 500 UTF-16 code units is cut to 491 and ends in ~ and the 8 hex digits of its 32-bit FNV-1a hash. testCount counts every testcase, failed the failures and errors; a failed test whose id is on the org's quarantine list (applied unless the org policy sets flaky.quarantine to false) counts in quarantinedFailures, any other in unquarantinedFailures, and quarantined lists the distinct quarantined ids that failed, sorted, at most 200. uploaded is true only when the normalised results were stored on pharn.dev. pharn-ci never changes its verdict because a test failed.",`;

/** `text` with `part` taken out; throws unless it appears exactly once. */
function withoutOnce(text: string, part: string, name: string): string {
  const count = text.split(part).length - 1;
  if (count !== 1) throw new Error(`v0.8.0: expected the ${name} once, found ${count}`);
  return text.replace(part, "");
}

/** `text` (report.v2.json or its code description) with the v0.8.0 code text taken out; throws unless it appears once. */
export function withoutV080CodeText(text: string): string {
  return withoutOnce(text, V080_CODE_TEXT, "v0.8.0 code text");
}

/** report.v2.json with the description of `flaky` taken out; throws unless it appears once. */
export function withoutV080FlakySchema(text: string): string {
  return withoutOnce(text, V080_FLAKY_SCHEMA_TEXT, "flaky schema description");
}

/**
 * report.v2.json with every v0.8.0 property insertion taken out (the `flaky` description) while the code text stays;
 * for the pins that cut the appended code texts themselves.
 */
export function withoutV080Properties(text: string): string {
  return withoutV080FlakySchema(text);
}

/** report.v2.json with every v0.8.0 insertion taken out: the code text and the `flaky` description. */
export function withoutV080SchemaEdits(text: string): string {
  return withoutV080Properties(withoutV080CodeText(text));
}
