---
spec_id: ti10-ti13-script-and-coverage-ignore-signals
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 adds test-integrity signals computed from the diff (Epic 1, backlog item 6). Two more ways a pull
request can make its checks pass without testing more are left: weakening the `test` script in `package.json` so a
failing or empty run still exits 0 (one of the ten weakening PRs of the base rate, `docs/PRECISION.md` §1, changed its
`test` script to `vitest run --passWithNoTests` after deleting the tests), and adding a coverage-ignore comment to source
so new code leaves the coverage the check grades. Today neither is reported. TI10 must report a `test*` script in any
`package.json` changed to add `|| true`, an `echo` in place of the runner or after `||` or `;`, `exit 0`,
`--passWithNoTests`, `--testPathPattern`, or a `-t` / `--testNamePattern` filter, and a removed `pretest` or `posttest`
script. TI13 must report an `istanbul ignore`, `v8 ignore` or `c8 ignore` comment added to non-test JS/TS source, and a
`# pragma: no cover` added to non-test Python. A reviewer then sees a precise, recorded finding with a hint, and a
block-mode setup fails the check. By the base rate's precision rule, `--passWithNoTests` does not fire in a repository
that has no test files (the "No tests yet" case). The local diff has no context lines, so every rule is decided from the
added and removed lines of the hunks alone, and the diff reader must keep that text for `package.json` and for non-test
source files too.

## Scope

**In scope:**

- The diff reader keeping the added and removed line text of every `package.json` (root or nested) and of source files with the extensions js, jsx, ts, tsx, mjs, cjs, mts, cts and py, in addition to the files it keeps today, with the existing bounds, through both the whole-text and the streaming path.
- Signal TI10 (test script weakened) on `package.json` files: the six weakening kinds added to a `test*` script value, and a removed `pretest` or `posttest` script.
- The TI10 exemption: `--passWithNoTests` does not fire when the repository has no test files.
- Signal TI13 (coverage ignore comment added) on non-test JS/TS and Python source files.
- Pre-existing weakenings and markers (the same kind on a removed line of the same script key, or the same normalized marker on a removed line of the same file) never fire.
- The effect of the effective test-integrity mode (block, warn, off) on both signals, on `testIntegrity.verdict` and on the overall verdict.
- One `TEST_INTEGRITY_TI10` and one `TEST_INTEGRITY_TI13` message per report that carries findings of that id, and their hints in the PR comment.
- Fixtures under `fixtures/test-integrity/TI10/` and `fixtures/test-integrity/TI13/`, and updates to the v2 schema description, CHANGELOG, README, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`; the action dist rebuilt.

**Out of scope (non-goals):**

- TI08 (`-u` / `--updateSnapshot` added to a test script) and TI09 (the test runner's own config file); scripts in files other than `package.json` (Makefile, tox, `pyproject.toml`).
- The accept label and its API call, flaky quarantine, per-signal overrides and app policy.
- Coverage-ignore markers of other tools (`/* node:coverage ignore */`, `# pragma: no branch`, a custom `exclude_lines` in a coverage config), and markers in test files.
- Reading the base or head content of any file; only the diff is read, and the git diff arguments are not changed.
- Any new dependency, action input, CLI flag or setting.
- Changing `schema/report.v1.json`, or removing or renaming any existing message code or report field.

## Acceptance Criteria

- **AC-1** Given a unified diff that edits `package.json`, `packages/api/package.json`, `package-lock.json`, `src/app.ts`, `src/a.mts`, `lib/b.cts`, `src/c.jsx`, `tools/run.py`, `README.md`, `docs/guide.md`, `.github/dependabot.yml`, `src/a.test.ts`, `.pharn/ci.yml` and `.github/workflows/ci.yml` When it is parsed with the file-selection predicate the core exports for signal text Then the two `package.json` files, the four JS/TS sources, `tools/run.py`, the test file, the config and the workflow keep the text of their added and removed lines, `package-lock.json`, `README.md`, `docs/guide.md` and `.github/dependabot.yml` keep none, a selected source file with 5001 changed lines carries `textTruncated`, and a kept line of 500 characters is cut to 400
  - verify: unit
- **AC-2** Given diffs of a modified `package.json` whose tracked files include `src/a.test.ts`, each removing `"test": "vitest run",` and adding one of `"test": "vitest run || true",`, `"test": "echo skipped",`, `"test": "vitest run; echo done",`, `"test": "vitest run || echo failed",`, `"test": "vitest run; exit 0",`, `"test": "vitest run --passWithNoTests",`, `"test": "jest --testPathPattern=src/a",`, `"test": "vitest run -t adds",` and `"test": "jest --testNamePattern=adds",`, a diff that does the same to `"test:unit"` in the nested `packages/api/package.json`, and diffs that remove `"pretest": "pnpm lint",` and `"posttest": "pnpm audit",` with no added line of the same key When the check runs in mode `block` and again in mode `warn` Then each diff gives exactly one TI10 signal for its file, at the new-file line of the added script line (the old-file line of the removed `pretest` or `posttest` line), with severity `block` in mode `block` and `warn` in mode `warn`
  - verify: integration
- **AC-3** Given diffs of a modified `package.json` whose tracked files include test files that edit `"test": "vitest run || true",` to `"test": "vitest run --reporter=dot || true",`, move the unchanged `"test"` line to another line of the file, add `"build": "tsc && echo built",`, change `"test": "vitest run",` to `"test": "vitest run --coverage",`, change `"test": "vitest run || true",` to `"test": "vitest run",`, add `"test": "vitest run && echo done",`, add `"lint": "eslint -t x",`, change `"test": "node --test",` to `"test": "node --test --test-reporter=dot",`, edit `"pretest": "pnpm lint",` to `"pretest": "pnpm lint --fix",`, add a new `package.json` (status added) holding `"test": "vitest run || true",`, and delete a `package.json` holding `"pretest": "pnpm lint",`, and a diff that adds `"test": "vitest run || true",` to `src/package.json.ts` When the check runs in mode `block` Then none of them gives a TI10 signal
  - verify: integration
- **AC-4** Given the diff that changes `"test": "vitest run",` to `"test": "vitest run --passWithNoTests",` in a modified `package.json` When the check runs in mode `block` with tracked files that include `src/a.test.ts`, with tracked files that hold no test file and a diff that deletes no test file, with tracked files that hold no test file and the same diff also deleting `test/a.test.ts` whose removed lines define tests, and with an empty tracked-file list Then the first gives one TI10 signal, the second gives none, the third gives one TI10 signal (and the TI01 finding of the earlier increment), and the fourth gives one TI10 signal
  - verify: integration
- **AC-5** Given a modified `package.json` diff that changes `"test": "vitest run",` to `"test": "vitest run --passWithNoTests || true",` and a diff that adds 21 lines `"test:p1": "vitest || true",` to `"test:p21": "vitest || true",`, together with the diffs of AC-2 When the check runs in mode `block` Then the first gives two TI10 signals on the same line with two different details, the second gives exactly 20 TI10 signals for that file on the 20 lowest line numbers, every TI10 detail of one weakening kind is the same fixed sentence of at most 300 characters, the seven kinds (`|| true`, `echo`, `exit 0`, `--passWithNoTests`, a test-path filter, a test-name filter, a removed `pretest` or `posttest`) have seven different details, and no TI10 detail or message holds a script key, a script value or other text of an added or removed line
  - verify: integration
- **AC-6** Given diffs of modified non-test sources that each add one line: `/* istanbul ignore next */`, `// istanbul ignore next`, `/* istanbul ignore else */`, `export default /* istanbul ignore next */ function f() {}` in `src/a.ts`, `/* v8 ignore next 3 */` in `src/b.mts`, `/* v8 ignore start */` in `src/c.jsx`, `/* c8 ignore stop */` in `lib/d.cts`, `// c8 ignore next` in `lib/e.js`, and in `tools/run.py` the lines `    return x  # pragma: no cover`, `if DEBUG:  # pragma: no cover` and `#pragma:no cover`, and a new source file (status added) `src/new.ts` holding `/* istanbul ignore next */` When the check runs in mode `block` and again in mode `warn` Then each diff gives exactly one TI13 signal for its file at the new-file line of the added line, with severity `block` in mode `block` and `warn` in mode `warn`
  - verify: integration
- **AC-7** Given diffs that move `/* istanbul ignore next */` to another line of `src/a.ts` with other indentation, move `# pragma: no cover` within `tools/run.py`, remove a `/* c8 ignore next */` line, add `/* istanbul ignore next */` to the test files `src/a.test.ts` and `test/helpers.ts`, add `# pragma: no cover` to `tests/test_run.py`, add `/* istanbul ignore next */` to `tools/run.py`, add `# pragma: no cover` to `src/a.ts`, add `/* istanbul ignore next */` to `README.md` and `docs/coverage.md`, add `const s = "istanbul ignore next";` and `/* eslint-disable */` and `// v8 ignored on purpose` to `src/a.ts`, and add `x = 1  # pragma: no branch` to `tools/run.py` When the check runs in mode `block` Then none of them gives a TI13 signal
  - verify: integration
- **AC-8** Given a diff of `src/a.ts` that removes one `/* istanbul ignore next */` line and adds two, and a diff that adds 21 `/* v8 ignore next */` lines to `src/b.ts`, together with the diffs of AC-6 When the check runs in mode `block` Then the first gives exactly one TI13 signal, at the higher of the two added lines, the second gives exactly 20 TI13 signals on the 20 lowest line numbers, every TI13 detail of one marker family is the same fixed sentence of at most 300 characters, the four families (istanbul, v8, c8, `pragma: no cover`) have four different details, and no TI13 detail or message holds the comment text or other text of an added or removed line
  - verify: integration
- **AC-9** Given one diff that adds `|| true` to an existing `test` script of `package.json` and adds `/* istanbul ignore next */` to `src/a.ts`, with tracked files that include test files When the check runs in mode `block`, in mode `warn` and in mode `off` Then in `block` the signals are sorted by id, then path, then line, then detail, `testIntegrity.verdict` is `fail`, and the messages hold one `TEST_INTEGRITY_TI10` and one `TEST_INTEGRITY_TI13` message, both with level `error`; in `warn` every TI10 and TI13 signal is `warn`, the verdict is `warn` and both message levels are `warn`; and in `off` there is no TI10 or TI13 signal or message and `testIntegrity.verdict` is `pass`
  - verify: integration
- **AC-10** Given a report with TI10 and TI13 signals, the AC-9 diff read once as one text and once through the streaming reader in chunks of 7 characters, and the CLI run with `--format json` on a diff that adds `|| true` to the `test` script When the PR comment is rendered and the reports are compared Then the "Test integrity" section lists each signal with the id in bold, `path:line` in a code span and the detail, with an indented "Hint:" line, the TI10 hint asks for the script to be restored or the reason stated in the PR, the TI13 hint asks for a test in place of the ignore comment, both hints say the accept label will record a reviewer's sign-off once it ships without holding `pharn/accepted` or `accept-label`, the hints for `TEST_INTEGRITY_TI10` and `TEST_INTEGRITY_TI13` exist in the Messages section, the text and streaming reports have equal `testIntegrity` blocks and message lists, the CLI JSON holds the TI10 signal, and every report validates against `schema/report.v2.json`
  - verify: integration
- **AC-11** Given the existing tests, the `fixtures/golden` outputs and the fixtures under `fixtures/test-integrity/TI01`, `TI03`, `TI04`, `TI11` and `TI14` When the whole suite runs with this increment Then every existing assertion passes unchanged, except the selector assertion that `src/app.ts` keeps no text (a JS/TS source now keeps its text, the reason recorded) and tests whose diffs weaken a `package.json` test script or add a coverage-ignore comment to source, which may pass `testIntegrityMode` `off` with the reason recorded, and the TI01, TI03, TI04, TI11 and TI14 signals and messages for their fixtures are identical to before
  - verify: integration
- **AC-12** Given the repository files When the schema, CHANGELOG, README, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the new fixture directories are read Then `schema/report.v2.json` names `TEST_INTEGRITY_TI10` and `TEST_INTEGRITY_TI13` in its message-code description, `schema/report.v1.json` is byte-identical to the base commit, the CHANGELOG Unreleased section mentions TI10 and TI13, the README `test-integrity` input row and message table name both signals with their message codes, `docs/LIMITS.md` has a section "What TI10 misses" naming the missing context lines, a script split over lines or with a multi-line value, a `test` key outside `scripts`, an added or deleted `package.json`, the unnamed weakening forms and the kept-text caps, and a section "What TI13 misses" naming the other tools' markers, test files, `*.test.mts` and `*.test.cts` files counted as source, a marker inside a string or a block comment's later line, and the kept-text caps, `docs/THREAT-MODEL.md` covers the diff reader keeping the line text of source files and `package.json` and the fixed-sentence details, and `fixtures/test-integrity/TI10/` and `fixtures/test-integrity/TI13/` each hold at least five `block-*` diffs that must give a signal of that id and five `pass-*` diffs that must give none, including the pre-existing weakening, the edited unrelated script, `--passWithNoTests` in a repository with no test files, a `test` script made stricter, an `echo` in a `build` script, a moved marker, a marker in a test file and an istanbul comment in a `.py` file
  - verify: unit

## Constraints

- The core package stays pure: no file, process, network, clock or random access in `packages/core/src`.
- Report v2 stays additive to v1: no field or message code is removed, renamed or retyped, and `schema/report.v1.json` is not changed.
- The diff reader keeps the line text of the newly selected files within the existing bounds (`MAX_KEPT_LINES` lines and `MAX_KEPT_LINE_CHARS` characters per line, per file); matching runs in linear time on a kept line.
- No file content, diff text, script key, command or comment text leaves the report: a finding holds the path, a line number and a fixed sentence of at most 300 characters.
- No new dependency, action input, CLI flag or setting; the mode precedence of the earlier increments is unchanged; the CLI and action dist is rebuilt.
- Existing tests are not weakened, skipped or deleted; goldens change only where the output intentionally changes.

## Assumptions

- The mode rules of the earlier increments apply as they are: in mode `block` a TI10 or TI13 signal has severity `block`, in mode `warn` it is `warn`, and `off` computes nothing; neither signal has a warn-by-design category, so no `warn-*` fixture is needed.
- The message level for an id is `error` if any of its signals is `block`, `warn` if any is `warn`, else `info`, as for the earlier signals.
- A `package.json` is any file whose basename is exactly `package.json`, judged by its new path; a script line is a line holding one `"key": "value"` pair (optional trailing comma, any indentation); without context lines any such line whose key starts with `test` is read as a script, a documented limit.
- The weakening kinds are matched in the script value as: `||` then optional spaces then `true`; `echo` as the first command word of the value or the first word after `||` or `;`; `exit 0` as a command; the flag `--passWithNoTests`; a flag starting `--testPathPattern`; and `-t` as a whole word or `--testNamePattern`. `echo` after `&&` does not fire, because the script still fails when the runner fails.
- A kind counts as pre-existing when a removed line of the same file with the same script key holds the same kind; each new kind on an added line is one signal, at most 20 TI10 signals per file on the lowest line numbers.
- A `package.json` the diff adds or deletes gives no TI10 signal: an added one weakens no script that existed, and a deleted one removes its whole package; a renamed one is read like a modified one.
- "The repository has no test files" means no tracked file is a test file by the existing detection and the diff deletes or renames away no test file, so a PR that deletes all its tests and adds `--passWithNoTests` still fires; an empty tracked-file list (git failed) is unknown and does not exempt.
- A TI13 marker is a `/*` or `//` comment start, optional spaces, the word `istanbul`, `v8` or `c8`, spaces, then the word `ignore`, anywhere on the line; or in Python `#`, optional spaces, `pragma`, an optional colon, optional spaces, `no`, spaces, `cover`, case-insensitive. The normalized marker is that matched text lower-cased with runs of spaces collapsed; removed markers of the same file are matched one-to-one against added ones in line order.
- A file is judged by its new path: test files by the existing test-file detection (which does not count `*.test.mts` or `*.test.cts`, so those count as source for TI13), JS/TS source by the extensions js, jsx, ts, tsx, mjs, cjs, mts and cts, Python by `.py`.
- A file whose kept text was truncated is checked on the lines that were kept; a diff passed to the check already parsed without kept text yields no TI10 or TI13.
- `testIntegrity.languages` stays an empty list, as in the earlier increments, because only line patterns run.
- The TI10 and TI13 hints describe the accept label as a later sign-off without naming its label or input, because the label ships in backlog item 7.
- The repository has no end-to-end runner, so every criterion is verified at unit or integration level; the fixtures are plain diffs run through the check, the streaming reader and the CLI.
