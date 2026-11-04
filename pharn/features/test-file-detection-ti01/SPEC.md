---
spec_id: test-file-detection-ti01
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 adds test-integrity signals. Every signal has to know which changed files are tests, and the first
signal, TI01 "test file deleted", has to tell an honest deletion (a test removed together with the code it covers) from
a deletion that leaves the code untested. Today the only knowledge of tests is a name-based check behind the
`TEST_FILES_DELETED` info message, which names every deleted test file and cannot say whether the file defined any tests.
Reviewers and the PR comment need a precise, recorded finding: a deleted test file whose removed lines defined tests,
while its code stays, is a block-level finding in `block` mode; a helper, a fixture, an `__init__.py`, a test deleted
with its source, a package removed with its tests, or a test migrated to another runner is not. The unified-diff parser
also has to keep the text of added and removed lines, because TI01 reads removed lines and the later signals TI03, TI04,
TI10, TI13 and TI14 read line text.

## Scope

**In scope:**

- One test-file detection function, used by every test-integrity signal, covering the test globs of the test-integrity spec.
- The unified-diff parser keeping, per hunk, the text of added and removed lines for the files a caller selects, with bounds on memory.
- Signal TI01 with its precision rules: a file counts only if its removed lines define tests, and three exemptions make it info.
- The effect of the effective test-integrity mode (block, warn, off) on the TI01 severity, on `testIntegrity.verdict` and on the overall verdict.
- One `TEST_INTEGRITY_TI01` message per report that carries TI01 findings, listing paths.
- `TEST_FILES_DELETED` kept as it is, computed from the new detection function.
- The "Test integrity" section of the PR comment listing the findings, with a hint line.
- Fixtures for TI01 under `fixtures/test-integrity/TI01/`, and updates to the schema description, CHANGELOG, README, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`.

**Out of scope (non-goals):**

- Other signals (TI02 to TI16), including TI03 and TI04, which only get the line text they will need.
- The accept label, per-signal overrides and app policy.
- Parsing test files with a syntax tree; TI01 uses line patterns only.
- Filling `testIntegrity.languages`; it stays an empty list until the syntax-tree detectors land.
- Removing or renaming any existing message code or report field.
- Any new setting or input: nothing carried by the pull request can loosen this check.

## Acceptance Criteria

- **AC-1** Given the test-file detection function When it is asked about repo-relative paths Then it answers true for `src/a.test.ts`, `a.spec.jsx`, `lib/x.test.mjs`, `lib/x.test.cjs`, `pkg/__tests__/x.js`, `test/x.ts`, `packages/a/tests/data.json`, `e2e/login.e2e.ts`, `e2e/login.pw.ts`, `test_foo.py`, `pkg/foo_test.py`, `pkg/foo_test.go`, and false for `src/latest.ts`, `src/contest.ts`, `src/testing/x.ts`, `a.test.md`, `Test.go`, `test_foo.txt`, `src/a_tests.py`, `src/Test/x.ts`, and true for every path the fixtures under `fixtures/test-files-deleted` treat as a test file
  - verify: unit
- **AC-2** Given a unified diff with a modified file, a deleted file and an added file When it is parsed with a `keepText` predicate that selects the deleted and added files Then each selected file carries `hunks` whose `added` entries hold the new-file line number and text and whose `removed` entries hold the old-file line number and text, the unselected file carries no `hunks`, and the `addedLines` of every file equal what a parse without the predicate returns
  - verify: unit
- **AC-3** Given a selected deleted file with 6000 removed lines, one of them 5000 characters long When the diff is parsed (as one text and as a stream of lines) Then at most 5000 lines are kept, every kept line is at most 400 characters, the file carries `textTruncated: true`, a selected file within the bounds does not carry `textTruncated`, and parsing the 6000-line diff completes within one second
  - verify: unit
- **AC-4** Given a diff that deletes `src/__tests__/b.test.ts`, whose removed lines start with `it(`, while `src/b.ts` stays When the check runs in mode `block` Then `testIntegrity.signals` holds one TI01 entry for that path with severity `block`, a null line and a detail of at most 300 characters that holds no removed line text, `testIntegrity.verdict` is `fail`, the messages hold one `TEST_INTEGRITY_TI01` message of level `error` naming the path, and the overall verdict is `fail`
  - verify: integration
- **AC-5** Given the same diff When the check runs with the default mode (`warn`), and again with mode `off` Then the default run reports the TI01 entry with severity `warn`, `testIntegrity.verdict` `warn`, a `TEST_INTEGRITY_TI01` message of level `warn` and overall verdict `warn`, and the `off` run reports no signal, a `testIntegrity.verdict` of `pass`, no `TEST_INTEGRITY_TI01` message and the `TEST_INTEGRITY_OFF` message
  - verify: integration
- **AC-6** Given diffs that delete only a helper `tests/helpers.ts` (no removed line defines a test), an empty `tests/__init__.py`, and a fixture `tests/fixtures/data.json`, and a diff that shows a deleted test file as binary When the check runs in mode `block` Then no TI01 signal and no `TEST_INTEGRITY_TI01` message is reported for any of them, while `TEST_FILES_DELETED` still names the non-binary test paths as before
  - verify: integration
- **AC-7** Given a deleted test file that defines tests and a diff that also (a) deletes a non-test file with the same stem such as `foo.test.ts` with `foo.ts`, or (b) deletes the other files of the package that holds the test, such as `packages/a/src/x.ts` and `packages/a/__tests__/x.test.ts` together, or (c) adds a test file with the same stem and defining tests, such as `x.test.js` replaced by `x.test.ts` or by `x.test.mjs` When the check runs in mode `block` Then the TI01 entry for the deleted test file has severity `info`, the detail names the reason, `testIntegrity.verdict` is `pass`, the `TEST_INTEGRITY_TI01` message has level `info`, and the overall verdict is not raised by it
  - verify: integration
- **AC-8** Given a diff that deletes `tests/test_a.py` (whose removed lines hold `def test_a`) in a repository whose tests live in a repo-root `tests/` folder and also deletes an unrelated source file `src/other.py`, a diff that renames `src/x.test.ts` to `src/x.ts` with no hunk, a diff that deletes a test file whose kept text was truncated before any test-defining line, and a diff that deletes `foo.test.ts` while `foo.ts` stays When the check runs in mode `block` Then each of the four reports a TI01 entry with severity `block`, because a package that is the repository root never exempts, a pure rename away counts, truncated text without a test-defining line counts, and tests deleted while their code stays count
  - verify: integration
- **AC-9** Given every diff of `fixtures/test-files-deleted` and the seven-file fixture When the check runs Then the `TEST_FILES_DELETED` message has the same level, code and text as before this increment, it is `info`, and with the test-integrity mode set to `off` the overall verdict equals the verdict of the same inputs without the deleted test files
  - verify: integration
- **AC-10** Given a git diff that deletes a test file defining tests and keeps its source, and read once through the streaming path used by the CLI and the Action and once as one text passed to the check When both reports are produced Then they hold the same TI01 signals and the same `TEST_INTEGRITY_TI01` message, and the CLI JSON output run on that diff holds the TI01 entry
  - verify: integration
- **AC-11** Given a report with TI01 signals of severity block, warn and info, and a report with none When the PR comment is rendered Then the "Test integrity" section holds one line per finding with the id, the path and the detail, and a hint line under it in the style of the Messages hints, the Messages hints hold a hint for `TEST_INTEGRITY_TI01` that does not mention an accept label, the empty report keeps the line `No test-integrity findings (mode: warn).`, and every report validates against `schema/report.v2.json`
  - verify: unit
- **AC-12** Given the repository files When the schema, CHANGELOG, README, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the TI01 fixtures are read Then `schema/report.v2.json` names `TEST_INTEGRITY_TI01` in its message-code description, `schema/report.v1.json` is byte-identical to the base commit, the CHANGELOG Unreleased section mentions TI01, the README names TI01, `docs/LIMITS.md` states that text is kept and capped for test files and lists what TI01 misses, `docs/THREAT-MODEL.md` covers the new parsing of diff text, and `fixtures/test-integrity/TI01/` holds at least one must-block and one must-not-block diff per case named in AC-4 to AC-8
  - verify: unit

## Constraints

- The core package stays pure: no file, process, network, clock or random access in `packages/core/src`.
- Report v2 stays additive to v1: no field or message code is removed, renamed or retyped, and `schema/report.v1.json` is not changed.
- Matching on diff text runs in linear time on a line cut to 400 characters; memory for line text is bounded per file as in AC-3.
- No file content, diff text or test name leaves the report: a finding holds paths, a reason and counts only.
- No new dependency, no new input and no new setting; the mode precedence of the previous increment is unchanged.
- Existing tests are not weakened, skipped or deleted; goldens change only where the new section lists findings.

## Assumptions

- The previous increment's mode rules apply as they are: default `warn`, the config can only tighten, `off` computes nothing.
- In mode `warn` a block-severity signal is reported with effective severity `warn`, so the severity in `testIntegrity.signals`, the message level and the verdict agree.
- One `TEST_INTEGRITY_TI01` message is emitted per report, not per file, listing up to five paths with the existing "and N more" form; every file is still listed in `testIntegrity.signals`.
- The package of a test is its own directory, or the directory that holds the nearest `test`, `tests` or `__tests__` folder above it; a package that is the repository root never exempts.
- The same-stem exemption looks for the source file anywhere in the diff, as the test-integrity spec words it; a same-named file elsewhere can therefore exempt, and `docs/LIMITS.md` says so.
- A pure rename away from a test path has no lines to read, so it counts on the path alone; a deleted binary file never counts.
- `testIntegrity.languages` stays an empty list because only line patterns run.
- The existing test that checks a deleted-test-file diff gives "the baseline verdict" holds only while TI01 is off, so it is changed minimally to run both of its checks with the test-integrity mode `off`; it still asserts that `TEST_FILES_DELETED` is info only. The reason is recorded in BUILD.md and the PR description.
- The repository has no end-to-end runner, so all criteria are verified at unit or integration level; the fixtures are plain diffs run through the check and the CLI.
- TI01 hint text does not mention the accept label because that feature ships in a later item.
