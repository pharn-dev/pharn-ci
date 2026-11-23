import type { FixEntry } from "../fix/table.js";

/**
 * The one list of test-integrity signals (CORE-140). Every other list of TI ids in core derives from it: the policy's
 * signal ids and their type, the `TEST_INTEGRITY_<id>` message codes, their fix entries and the comment's hints, and the
 * report message of each id. A new signal adds one entry here and its detector; nothing else in core lists the ids.
 */

/** The top severity among the findings of one id, which picks the files a message names. */
export type SignalTop = "block" | "warn" | "info";

/** One signal of the registry. */
export interface TestIntegritySignalDefinition {
  readonly id: string;
  /** The fix kind and its one fixed sentence: `fix.hint` of the message and of every finding, and the comment's hint. */
  readonly fix: FixEntry;
  /**
   * When the comment adds the accept-label clause to the hint: on every finding and message of the id, or only on a
   * block finding (or an error-level message), where the label counts. Absent: never.
   */
  readonly accept?: "always" | "block";
  /** Findings of this id can be binary findings (`isBinaryDetail`); the comment adds the binary sentence to their hint. */
  readonly binary?: true;
  /**
   * The one `TEST_INTEGRITY_<id>` message a report with findings of the id carries. `paths` names the top-severity files,
   * or, with `allPaths`, every file of the id, so the text does not depend on severity; `notListed` is empty, or the
   * sentence that says how many findings the cap left out. Absent for an id that is no longer emitted: its code and its
   * policy key stay valid so an older report and an existing policy still validate.
   */
  readonly message?: {
    readonly allPaths?: true;
    readonly text: (top: SignalTop, paths: string, notListed: string) => string;
  };
}

export const TEST_INTEGRITY_SIGNALS = [
  {
    id: "TI01",
    fix: {
      kind: "restore-test",
      hint: "Restore the deleted test file, or move its tests to a test file that still runs them.",
    },
    binary: true,
    message: {
      text: (top, paths) =>
        top === "info"
          ? `This change deletes test files together with the code they cover or replaces them: ${paths}.`
          : `This change deletes or renames away test files that defined tests, with nothing in the change that accounts for them: ${paths}. Check that those tests were meant to go.`,
    },
  },
  {
    id: "TI02",
    fix: {
      kind: "restore-test",
      hint: "Restore the removed test, or keep a test with the same assertions in one of the touched test files.",
    },
    accept: "always",
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change removes tests from test files that stay, with no test of the same name or a similar body in the touched test files to take their place: ${paths}. Check that each removal was meant.${notListed}`,
    },
  },
  {
    id: "TI03",
    fix: {
      kind: "restore-test",
      hint: "Remove the skipping of the test so it runs again, or say in the PR why it must stay, for example a test that fails in CI.",
    },
    accept: "always",
    message: {
      text: (_top, paths) =>
        `This change skips tests or marks them as expected to fail: ${paths}. Check that each skip was meant.`,
    },
  },
  {
    id: "TI04",
    fix: {
      kind: "restore-test",
      hint: "Remove the focused-run marker (.only, fit or fdescribe) so every test in the file runs again.",
    },
    message: {
      text: (_top, paths) =>
        `This change adds \`.only\`, \`fit\` or \`fdescribe\`, which runs only the marked tests: ${paths}. Remove the markers before merging.`,
    },
  },
  {
    id: "TI05",
    fix: { kind: "restore-assertion", hint: "Restore the assertions this test had, so it checks the behaviour again." },
    accept: "always",
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change leaves tests with fewer assertions than they had, or none: ${paths}. Check that each test still checks what it did.${notListed}`,
    },
  },
  {
    id: "TI06",
    fix: {
      kind: "restore-assertion",
      hint: "Restore the stronger assertion this test had in place of the weaker one.",
    },
    accept: "block",
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change weakens tests that stay: a stronger matcher became a weaker one, an assertion guard was lowered or removed, an assertion that compares a literal with itself was added, or an assertion moved into a try block or after an early return: ${paths}. Check that each test still checks what it did.${notListed}`,
    },
  },
  {
    id: "TI07",
    fix: {
      kind: "restore-assertion",
      hint: "Restore the expected values; if the behaviour really changed, say why in the pull request and have a reviewer confirm it.",
    },
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change edits only the expected values of tests while it also edits source files, so the tests may have been made to agree with the code: ${paths}. Check that each new expected value is right.${notListed}`,
    },
  },
  {
    id: "TI08",
    fix: {
      kind: "request-review",
      hint: "Ask a reviewer to confirm the snapshot changes are intended before merging.",
    },
    message: {
      text: (_top, paths) =>
        `This change regenerates or updates snapshots in bulk: ${paths}. Check that each new snapshot was reviewed.`,
    },
  },
  {
    id: "TI09",
    fix: {
      kind: "revert-config",
      hint: "Revert the test-runner config change so the same tests run under the same rules, or say in the PR why it changes; a raised retry count or timeout is a warning only.",
    },
    accept: "always",
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change loosens test-runner settings so that fewer tests run, a weaker run passes or the coverage gate drops: ${paths}. Check that each looser setting was meant.${notListed}`,
    },
  },
  {
    id: "TI10",
    fix: {
      kind: "revert-config",
      hint: "Restore the test script in package.json so it runs the whole suite and fails when a test fails, or say in the PR why it changes.",
    },
    accept: "always",
    binary: true,
    message: {
      text: (_top, paths) =>
        `This change weakens a test script in package.json, so the test run can pass without the tests passing: ${paths}. Check that the change was meant.`,
    },
  },
  {
    id: "TI11",
    fix: {
      kind: "revert-config",
      hint: "Revert the workflow change so CI runs the tests on pull requests as before.",
    },
    binary: true,
    message: {
      text: (_top, paths) =>
        `This change edits a workflow so that CI may run fewer tests or ignore their failures: ${paths}. Check that the removed step or trigger, the reduced matrix or the added condition was meant.`,
    },
  },
  {
    id: "TI12",
    fix: {
      kind: "request-review",
      hint: "Ask a reviewer to confirm that mocking the changed module still tests its real behaviour.",
    },
    accept: "block",
    message: {
      allPaths: true,
      text: (_top, paths, notListed) =>
        `This change mocks a module it also edits, so the tests may not run the code under review: ${paths}. Check that each mock was meant.${notListed}`,
    },
  },
  {
    id: "TI13",
    fix: {
      kind: "revert-config",
      hint: "Remove the added coverage pragma and add a test that runs those lines, or say in the PR why they cannot be tested.",
    },
    accept: "always",
    message: {
      text: (_top, paths) =>
        `This change adds comments that leave code out of coverage: ${paths}. Check that each was meant.`,
    },
  },
  {
    id: "TI14",
    fix: {
      kind: "revert-config",
      hint: "Revert the change to the coverage settings of the pharn-ci config so the gate measures the same files as before.",
    },
    binary: true,
    message: {
      text: (_top, paths) =>
        `This change lowers the coverage threshold or adds a coverage exclusion in the check config: ${paths}. Once merged, the looser setting applies to every later pull request; check that it was meant.`,
    },
  },
  {
    // Not emitted since CORE-144: no message. The code TEST_INTEGRITY_TI15 and the policy key TI15 stay valid.
    id: "TI15",
    fix: {
      kind: "request-review",
      hint: "Ask a reviewer to confirm the code does not special-case the value the test checks.",
    },
  },
  {
    id: "TI16",
    fix: {
      kind: "request-review",
      hint: "Ask a reviewer to confirm the lint or type suppression added to the test file is needed.",
    },
    message: {
      text: (_top, paths) =>
        `This change adds comments that switch off a linter or type checker in test files: ${paths}.`,
    },
  },
  {
    id: "TI17",
    fix: {
      kind: "restore-assertion",
      hint: "Restore an assertion that can fail in place of the one that always passes, or say in the PR why the test checks less now.",
    },
    accept: "block",
    message: {
      text: (_top, paths) =>
        `This change adds assertions that always pass to test files: ${paths}. Check that each test still compares a value that can fail.`,
    },
  },
] as const satisfies readonly TestIntegritySignalDefinition[];

/** A test-integrity signal id: TI01 to TI17. */
export type TestIntegritySignalId = (typeof TEST_INTEGRITY_SIGNALS)[number]["id"];

/** The message code of a test-integrity signal id. */
export type TestIntegrityMessageCode = `TEST_INTEGRITY_${TestIntegritySignalId}`;

/** Every signal id, in registry order. */
export const TEST_INTEGRITY_SIGNAL_IDS: readonly TestIntegritySignalId[] = TEST_INTEGRITY_SIGNALS.map((s) => s.id);

/** The message code of a signal id. */
export function testIntegrityCode<I extends TestIntegritySignalId>(id: I): `TEST_INTEGRITY_${I}` {
  return `TEST_INTEGRITY_${id}`;
}

/** The fix entry of each signal id. */
export const TEST_INTEGRITY_SIGNAL_FIXES = Object.fromEntries(
  TEST_INTEGRITY_SIGNALS.map((s) => [s.id, s.fix]),
) as Readonly<Record<TestIntegritySignalId, FixEntry>>;

/** The fix entry of each `TEST_INTEGRITY_<id>` message code: the same object as its signal's entry. */
export const TEST_INTEGRITY_MESSAGE_FIXES = Object.fromEntries(
  TEST_INTEGRITY_SIGNALS.map((s) => [testIntegrityCode(s.id), s.fix]),
) as Readonly<Record<TestIntegrityMessageCode, FixEntry>>;

/** The registry entry of a signal id, or undefined for any other string (an id from a newer or another producer). */
export function testIntegritySignal(id: string): TestIntegritySignalDefinition | undefined {
  return TEST_INTEGRITY_SIGNALS.find((s) => s.id === id);
}
