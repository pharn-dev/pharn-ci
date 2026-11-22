// R3 schema text follow-up (epic CORE-8). R3 changed message levels (CORE-92, CORE-95, CORE-100) and widened the
// tests-exercise check to Python (CORE-104) with no structural schema change; this follow-up makes report.v2.json's
// descriptions say so. The pins that compare the schema with an older commit (or a pinned sha) put exactly these
// passages back first (`withoutR3SchemaTextEdits`, then the earlier helpers as before), so every other byte is still
// pinned. Each passage is ASCII with no character a JSON string escapes, so it can be swapped in the raw text and in a
// parsed description alike.

/** Each edit as [the text before the follow-up, the text now]. */
export const R3_SCHEMA_TEXT_EDITS: readonly (readonly [string, string])[] = [
  // The v1 codes whose level R3 changed: COVERAGE_FILE_TRACKED (CORE-92), CONFIG_CHANGED_IN_DIFF (CORE-95) and
  // DIFF_BINARY_COVERED_FILE (CORE-100), all warn in report.v1.json.
  [
    "AGENT_SETUP_EXPECTED_MISSING and COVERAGE_LINES_SKIPPED), except DIFF_UNAVAILABLE",
    "AGENT_SETUP_EXPECTED_MISSING and COVERAGE_LINES_SKIPPED), except COVERAGE_FILE_TRACKED, which is an error when a coverage threshold is set (0 included) and the diff adds, edits or renames to the tracked coverage file the gate reads, and a warn otherwise; except CONFIG_CHANGED_IN_DIFF, which is an error when the diff modifies, deletes or renames away the pharn-ci config in use, its copy at the merge base cannot be read (so the run uses no config file), and a coverage threshold is set (0 included) or the test-integrity mode is block, and a warn otherwise; except DIFF_BINARY_COVERED_FILE, which is an error when a coverage threshold is set (0 included), and a warn otherwise; and except DIFF_UNAVAILABLE",
  ],
  // CORE-100: injection budgets and the level of a cut.
  [
    "INJECTION_TEXT_TRUNCATED (warn: some files were too large to scan in full, and the message names up to 5 of them;",
    "INJECTION_TEXT_TRUNCATED (error when a cut file is an agent instruction file or a Markdown file (.md, .mdx, .markdown or .mdc), warn when only other files were cut: some files were too large to scan in full, past 50,000 added lines of one file or past one of two budgets of 8,000,000 UTF-16 code units of added text across the diff, one for agent instruction and Markdown files and one for every other file, and the message names up to 5 of them and the budget they count against;",
  ],
  // CORE-104: the tests-exercise check covers Python (the code description).
  [
    "TESTS_NOT_EXERCISING_CHANGES (warn, never an error, at most once per report: changed JS/TS source files that no JS/TS test file the change adds or modifies imports directly with a relative import while keeping or raising its assertion count;",
    "TESTS_NOT_EXERCISING_CHANGES (warn, never an error, at most once per report: changed JS/TS or Python source files that no test file the change adds or modifies imports directly while keeping or raising its assertion count, a JS/TS test file through a relative import and a Python test file through an import statement whose module name maps to the file at the repository root or under src/; Python source files are asked only when a usable Python interpreter was found for the touched Python test files;",
  ],
  // CORE-100 part 2: DEPENDENCY_CHECK_INCOMPLETE is an error unless git caused every unread file; one file may be 32 MiB.
  [
    "DEPENDENCY_CHECK_INCOMPLETE (warn: a manifest or lockfile the change touches could not be read or parsed, so dependency safety did not check it)",
    "DEPENDENCY_CHECK_INCOMPLETE (error, or warn when every file in dependencies.unread has the reason unavailable because git could not read that side at all: a manifest or lockfile the change touches could not be read or parsed, so dependency safety did not check it; every other reason is one the change can cause: unparsable, too-large (one file over 32 MiB), over-total-cap (one side over 32 MiB), over-file-cap (one side over 100 files), binary, missing or unsafe-path)",
  ],
  // CORE-104: the testIntegrity.exercise description.
  [
    "the changed JS/TS source files (an added, modified or renamed file with at least one added line; not a test, declaration, config, generated, build-output or coverage-excluded file) that no JS/TS test file the change adds or modifies imports directly with a relative import while keeping or raising its assertion count.",
    "the changed JS/TS and Python source files (an added, modified or renamed file with at least one added line; not a test, declaration, config, generated, build-output or coverage-excluded file; a .py file only when a usable Python interpreter was found for the touched Python test files) that no test file the change adds or modifies imports directly while keeping or raising its assertion count: a JS/TS test file through a relative import, a Python test file through an import statement whose module name maps to the file at the repository root or under src/.",
  ],
  // CORE-100 part 2: the dependencies.unread description.
  [
    "each with a fixed reason; they come with one DEPENDENCY_CHECK_INCOMPLETE warn message. Absent when every touched file was read.",
    "each with a fixed reason; they come with one DEPENDENCY_CHECK_INCOMPLETE message, an error unless every reason is unavailable (git could not read that side at all), then a warn. A file is not read past 32 MiB, nor a side past 32 MiB or 100 files. Absent when every touched file was read.",
  ],
  // CORE-118 (R5.1, epic CORE-10): one sentence after the v0.8.0 codes names POLICY_KEYS_UNKNOWN, the one code that
  // ticket adds. It rides this list so every pin that already puts the R3 passages back takes it out too, and every
  // other byte stays pinned; the pins that read report.ts or the docs name the code where they list added codes.
  [
    "what is over is left out).",
    "what is over is left out). Codes added in v0.12.0: POLICY_KEYS_UNKNOWN (warn, at most once per report and only for a policy the app serves: the policy held keys or ids this version of pharn-ci does not know, such as a newer test-integrity signal, policy rule, response key or agent tool, so they were skipped and the rest of the policy applies; the message names up to 20 of them as code spans, sorted, each cut to 64 characters, and counts the rest; a policy file with an unknown key still fails the run).",
  ],
];

/** `text` (report.v2.json or a description in it) with each R3 text edit put back; throws unless each appears once. */
export function withoutR3SchemaTextEdits(text: string): string {
  let out = text;
  for (const [before, after] of R3_SCHEMA_TEXT_EDITS) {
    const count = out.split(after).length - 1;
    if (count !== 1) throw new Error(`r3-schema-text: expected the edit once, found ${count}: ${after.slice(0, 80)}`);
    out = out.replace(after, () => before);
  }
  return out;
}
