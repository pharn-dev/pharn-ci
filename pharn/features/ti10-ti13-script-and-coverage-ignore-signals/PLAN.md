---
spec_id: ti10-ti13-script-and-coverage-ignore-signals
spec_content_hash: 077a9dded5b29e2f9a12a0a4a61cc590d4f4bea50955299ab0d7d32c4f1fd6f6
applied_lessons: none
---

## Approach

Add two pure detectors, `detectTI10` and `detectTI13`, beside TI01, TI03, TI04, TI11 and TI14, and feed them through
the path those already use (`check()` concatenates, sorts by id, path, line, detail; `buildReport` adds one message per
id through `SIGNAL_MESSAGES`; the renderer looks hints up by id and code). The one structural change is the diff
reader's file selection: `keepSignalFileText` (in `signals/signalFiles.ts`) also selects every `package.json` (basename
exactly `package.json`, root or nested) and every source file with the extension js, jsx, ts, tsx, mjs, cjs, mts, cts or
py, judged by new or old path like the other selected files. Both `check()` (diff text) and `readDiffChunks` (stream)
already use that one predicate, so both paths keep the same files; the reader itself (`diff/unified.ts`) and its bounds
(`MAX_KEPT_LINES` 5000 lines and hunks per file, `MAX_KEPT_LINE_CHARS` 400 per line, `textTruncated`) are unchanged. A
parsed diff that arrives without kept text (`hunks` absent) yields no TI10 or TI13, as for the earlier signals.

Every rule is decided from the added and removed lines of the hunks alone (the local diff is `--unified=0`). Each kept
line is at most 400 characters and every matcher is a hand-written left-to-right scan (or an anchored pattern with no
nested quantifier), so matching runs in linear time on a kept line.

**TI10, test script weakened** — `detectTI10(diff, { repoFiles, mode })`. Files: entries whose new path's basename is
exactly `package.json`, status `modified` or `renamed` (added and deleted give nothing), not binary, with `hunks`.

- *Script line*: one `"key": "value"` pair on the line, any indentation, optional spaces around the colon, optional
  trailing comma, nothing else. The key and value are read by a scan that honours `\"` escapes. Lines of any other
  shape (a one-line object, a value continued on the next line) are not script lines.
- *Test script*: a script line whose key starts with `test` (`test`, `test:unit`, `test:p1`, …).
- *Kinds* found in a test script's value, each at most once per line:
  1. `or-true`: `||`, optional spaces, then `true` followed by the end of the value or a non-word character.
  2. `echo`: the first word of a command position is exactly `echo`, where a command position is the start of the
     value or the text after `||` or `;` (not after `&&` or a single `|`, because the script still fails when the
     runner fails).
  3. `exit-0`: the first two words of a command position (as for `echo`) are `exit` and `0`.
  4. `pass-with-no-tests`: a token that is `--passWithNoTests` or starts with `--passWithNoTests=`.
  5. `path-filter`: a token that starts with `--testPathPattern`.
  6. `name-filter`: a token that is exactly `-t`, or starts with `--testNamePattern`.
  Tokens are the value split on white space and on the shell operators `;`, `|` and `&`.
- *Pre-existing*: per file, a map from script key to the set of kinds found on removed lines of that key. A kind on an
  added line whose key's removed set holds the same kind gives nothing. Each remaining kind on an added line is one
  signal at the added line's new-file number.
- *Removed hook*: a removed script line whose key is exactly `pretest` or `posttest`, when no added script line of the
  same file has the same key, is one signal (kind `hook-removed`) at the removed line's old-file number.
- *Exemption*: the `pass-with-no-tests` kind gives nothing when the repository has no test files: `repoFiles` is not
  empty, no entry of it is a test file (`isTestFile`), and `deletedTestFiles(diff)` is empty. An empty `repoFiles`
  (git failed) is unknown and does not exempt; a diff that deletes or renames away a test file does not exempt.
- Severity is the mode. Per file, signals are ordered by line then detail and cut to the first 20.

**TI13, coverage-ignore comment added** — `detectTI13(diff, mode)`. Files: entries whose new path is not a test file
(`isTestFile`), not binary, with `hunks`, and whose new path's extension is a JS/TS one (js, jsx, ts, tsx, mjs, cjs, mts,
cts) or `.py`. Added files count (status `added`); `*.test.mts` and `*.test.cts` count as source, because the existing
test detection does not name them.

- *JS/TS marker*: anywhere on the line, a comment start `/*` or `//`, optional spaces, the word `istanbul`, `v8` or `c8`,
  one or more spaces, then the word `ignore` followed by the end of the line or a non-word character (so `ignored` is
  not a marker). Case-insensitive, as the SPEC's marker sentence ends; the family is the tool word.
- *Python marker*: `#`, optional spaces, `pragma`, an optional `:`, optional spaces, `no`, one or more spaces, `cover`
  followed by the end or a non-word character, case-insensitive; the family is `pragma`. Only in `.py` files, and the
  JS/TS forms only in JS/TS files, so `# pragma: no cover` in `src/a.ts` and an istanbul comment in `tools/run.py`
  give nothing.
- *Normalized marker*: the matched text, lower-cased, with runs of white space collapsed to one space. The first
  marker on a line is the line's marker.
- *Pre-existing*: per file, a count of each normalized marker on removed lines. Added marker lines are taken in
  ascending new-file line order; each one whose normalized marker still has a removed count consumes one and gives
  nothing; every other one is a signal at its new-file line. So a moved marker gives nothing, and removing one and
  adding two gives one signal at the higher added line.
- Severity is the mode. One signal per added marker line; per file, at most 20, on the lowest line numbers.

**Details and messages.** Each kind or family has one fixed sentence of at most 300 characters, and the seven TI10
kinds and the four TI13 families have pairwise different sentences. No detail or message is built from line text, and
the sentences describe the kind without quoting the operator, flag, script key, value or comment from a line (the
SPEC's AC-5 and AC-8: no detail holds a script key, value or comment text). Indicative wording (the build may tighten
it within those rules):

- TI10 `or-true`: "A test script now ignores the exit status of a command, so it passes even when the tests fail."
- TI10 `echo`: "A test script now prints a message in place of running the tests, or after a failing run, so it can
  pass without the tests passing."
- TI10 `exit-0`: "A test script now forces a successful exit status, so it passes whatever the tests do."
- TI10 `pass-with-no-tests`: "A test script now lets a run that finds no tests pass."
- TI10 `path-filter`: "A test script now limits the run to the test files matching a path pattern, so the other test
  files do not run."
- TI10 `name-filter`: "A test script now limits the run to the tests whose names match a pattern, so the other tests do
  not run."
- TI10 `hook-removed`: "A script that ran before or after the tests was removed, so its checks no longer run with
  them."
- TI13 istanbul: "An Istanbul coverage hint was added, so the code it marks leaves the coverage this check grades."
- TI13 v8: "A V8 coverage hint was added, so the code it marks leaves the coverage this check grades."
- TI13 c8: "A C8 coverage hint was added, so the code it marks leaves the coverage this check grades." (capitalized so
  no lower-case comment fragment is copied)
- TI13 pragma: "A coverage.py exclusion pragma was added, so the Python code it marks leaves the coverage this check
  grades."

Messages (`SIGNAL_MESSAGES`, paths only): `TEST_INTEGRITY_TI10` "This change weakens a test script in package.json, so
the test run can pass without the tests passing: <paths>. Check that the change was meant." and `TEST_INTEGRITY_TI13`
"This change adds comments that leave code out of coverage: <paths>. Check that each was meant." Level from the highest
severity, as for the earlier ids. Hints (`MESSAGE_HINTS`, reused by `SIGNAL_HINTS`): TI10 "Restore the test script, or
say in the PR why it changes so a reviewer can confirm it; the accept label will record a reviewer's sign-off once it
ships." and TI13 "Write a test for the code in place of the ignore comment, or say in the PR why it cannot be tested;
the accept label will record a reviewer's sign-off once it ships." Neither names `pharn/accepted` or `accept-label`.

Mode `off` still computes nothing; `testIntegrity.languages` stays empty.

## Applied lessons

- none — this project has no memory-bank yet (the lessons index verdict is NO_CANON), so there is no lesson to cite.

## Steps

- `signals/signalFiles.ts`: add `isPackageJsonFile(path)` (basename exactly `package.json`) and
  `coverageSourceLanguage(path): "jsts" | "python" | null` (by extension: js, jsx, ts, tsx, mjs, cjs, mts, cts → `jsts`;
  py → `python`); extend `keepSignalFileText` to also return true for a `package.json` or a source file by new or old
  path; update its doc comment.
- `signals/ti10.ts` (new): the script-line scan, the kind scan, `detectTI10` and its `TI10Options`
  (`{ repoFiles: readonly string[]; mode: "block" | "warn" }`), the seven fixed details. Reuses `isTestFile` and
  `deletedTestFiles` from `testFiles.ts` and `isPackageJsonFile` from `signalFiles.ts`.
- `signals/ti13.ts` (new): the JS/TS and Python marker scans, the normalization, `detectTI13`, the four fixed details.
  Reuses `isTestFile` and `coverageSourceLanguage`. Its own comments and string literals must not contain a comment
  start followed by a marker (write "the istanbul, v8 and c8 ignore hints" in prose, and build patterns from parts), so
  the file and the rebuilt bundle do not trip TI13 on pharn-ci's own PR.
- `check.ts`: add `...detectTI10(parsedDiff, { repoFiles: input.repoFiles, mode })` and `...detectTI13(parsedDiff, mode)`
  to the signal list; the sort is unchanged.
- `report.ts`: add `TEST_INTEGRITY_TI10` and `TEST_INTEGRITY_TI13` to `MessageCode`; add their `SIGNAL_MESSAGES` entries
  in id order (TI10 after TI04, TI13 after TI11); update the `testIntegritySignals` doc comment's id list.
- `render/markdown.ts`: `MESSAGE_HINTS` entries for both codes and `SIGNAL_HINTS` entries for both ids.
- `index.ts`: export `detectTI10`, `type TI10Options`, `detectTI13`, `isPackageJsonFile`, `coverageSourceLanguage`.
- `chunkInputs.ts`: update the `readDiffChunks` doc comment, which lists the files whose text is kept (no code change).
- `schema/report.v2.json`: append `TEST_INTEGRITY_TI10` and `TEST_INTEGRITY_TI13` to the "Codes added in v2" part of the
  message-code description (outside the "Known codes:" list), each with its id, meaning and levels.
- Existing test `packages/core/test/ac-ti1411-selector.test.ts`: the final loop asserts `src/app.ts` keeps no text; drop
  `src/app.ts` from that loop only (a JS/TS source now keeps its text, as AC-11 allows) and keep the other two paths and
  every other assertion. The reason goes in BUILD.md. Discovery found no existing fixture or inline test diff that
  weakens a `package.json` test script or adds a coverage-ignore comment, so no other existing test changes; if the
  build finds one, it passes `testIntegrityMode` `off` there with the reason in BUILD.md, as AC-11 allows.
- Fixtures under `fixtures/test-integrity/TI10/` and `fixtures/test-integrity/TI13/`, in real `git diff --unified=0`
  shape, named `block-` or `pass-` by the outcome in mode `block`. TI10 fixtures run with the tracked files
  `package.json` and `src/a.test.ts`, except a diff with a sibling `<name>.files.txt`, which runs with the paths listed
  there (one per line); only `pass-no-test-files.diff` has one, listing no test file.
- Docs: CHANGELOG Unreleased entries for TI10 and TI13; README (the `test-integrity` input row names TI10 and TI13 among
  the signals so far; the message-code table gains `TEST_INTEGRITY_TI10` and `TEST_INTEGRITY_TI13` rows);
  `docs/LIMITS.md` sections "What TI10 misses" and "What TI13 misses" after "What TI04 misses", and the section 8
  kept-text sentence names `package.json` and the JS/TS and Python source files; `docs/THREAT-MODEL.md` item 16 (TI10
  and TI13 make the diff reader keep the line text of source files and `package.json`, each capped as before; linear
  scans; fixed-sentence details with no script key, command or comment text).
- "What TI10 misses" names: no context lines (any `"test…": "…"` line is read as a script, even outside `scripts`); a
  script split over lines, a multi-line value or a one-line object; a `test` key outside `scripts` read as a script; an
  added or deleted `package.json` gives nothing; the unnamed weakening forms (for example `|| exit 0` is caught but
  `--bail 0`, `--silent`, a wrapper script, `npm test --if-present`, a changed `test` in `pyproject.toml`, a Makefile or
  tox are not); `--passWithNoTests` exempt only when no tracked file is a test file; the kept-text caps and the 20 per
  file.
- "What TI13 misses" names: other tools' markers (`/* node:coverage ignore */`, `# pragma: no branch`, a custom
  `exclude_lines`); markers in test files; `*.test.mts` and `*.test.cts` counted as source; a marker inside a string
  (which fires) and a marker on a block comment's later line (which is missed); a marker moved to another file reads as
  added; the kept-text caps and the 20 per file.
- Run `pnpm build` so `packages/action/dist/index.js` is rebuilt; then `pnpm lint` and `pnpm test`.

## Files

- `packages/core/src/signals/signalFiles.ts` — selector keeps `package.json` and JS/TS/Python source text; two path helpers
- `packages/core/src/signals/ti10.ts` — the TI10 detector and its script-line and kind scans (new)
- `packages/core/src/signals/ti13.ts` — the TI13 detector and its marker scans (new)
- `packages/core/src/check.ts` — adds the two detectors to the signal list
- `packages/core/src/report.ts` — the two message codes and their per-id messages
- `packages/core/src/render/markdown.ts` — message and signal hints for TI10 and TI13
- `packages/core/src/index.ts` — exports
- `packages/core/src/chunkInputs.ts` — doc comment of `readDiffChunks` names the newly kept files
- `schema/report.v2.json` — the message-code description names the two new codes
- `packages/core/test/ac-ti1411-selector.test.ts` — existing test: `src/app.ts` no longer asserted text-free (reason in BUILD.md)
- `fixtures/test-integrity/TI10/block-or-true.diff` — `"test": "vitest run"` to `"vitest run || true"`
- `fixtures/test-integrity/TI10/block-echo-in-place.diff` — `"test"` value replaced by `echo skipped`
- `fixtures/test-integrity/TI10/block-pass-with-no-tests.diff` — `--passWithNoTests` added (PRECISION §1 case)
- `fixtures/test-integrity/TI10/block-path-filter.diff` — `jest --testPathPattern=src/a`
- `fixtures/test-integrity/TI10/block-name-filter.diff` — `vitest run -t adds`
- `fixtures/test-integrity/TI10/block-pretest-removed.diff` — a `pretest` script removed
- `fixtures/test-integrity/TI10/block-nested-exit-zero.diff` — `"test:unit"` in `packages/api/package.json` gains `; exit 0`
- `fixtures/test-integrity/TI10/pass-pre-existing-or-true.diff` — `vitest run || true` to `vitest run --reporter=dot || true`
- `fixtures/test-integrity/TI10/pass-unrelated-script.diff` — the `lint` script edited to `eslint -t x`
- `fixtures/test-integrity/TI10/pass-build-echo.diff` — `"build": "tsc && echo built"` added
- `fixtures/test-integrity/TI10/pass-stricter.diff` — `vitest run` to `vitest run --coverage`
- `fixtures/test-integrity/TI10/pass-and-echo.diff` — `"test": "vitest run && echo done"` added
- `fixtures/test-integrity/TI10/pass-new-package.diff` — a new `package.json` holding `vitest run || true`
- `fixtures/test-integrity/TI10/pass-no-test-files.diff` — `--passWithNoTests` added in a repository with no test files
- `fixtures/test-integrity/TI10/pass-no-test-files.files.txt` — the tracked files for that fixture, no test file among them
- `fixtures/test-integrity/TI13/block-istanbul-next.diff` — the istanbul next hint added to `src/a.ts`
- `fixtures/test-integrity/TI13/block-istanbul-inline.diff` — the istanbul hint inline before `function f() {}`
- `fixtures/test-integrity/TI13/block-v8-next.diff` — the v8 next hint added to `src/b.mts`
- `fixtures/test-integrity/TI13/block-c8-line.diff` — the c8 line-comment hint added to `lib/e.js`
- `fixtures/test-integrity/TI13/block-pragma-no-cover.diff` — `# pragma: no cover` added to `tools/run.py`
- `fixtures/test-integrity/TI13/block-new-file.diff` — a new `src/new.ts` holding the istanbul hint
- `fixtures/test-integrity/TI13/pass-moved.diff` — the istanbul hint moved within `src/a.ts`, other indentation
- `fixtures/test-integrity/TI13/pass-removed.diff` — a c8 hint removed
- `fixtures/test-integrity/TI13/pass-test-file.diff` — the istanbul hint added to `src/a.test.ts`
- `fixtures/test-integrity/TI13/pass-py-istanbul.diff` — the istanbul hint added to `tools/run.py`
- `fixtures/test-integrity/TI13/pass-string.diff` — `const s = "istanbul ignore next";` added to `src/a.ts`
- `fixtures/test-integrity/TI13/pass-v8-ignored-word.diff` — `// v8 ignored on purpose` added
- `fixtures/test-integrity/TI13/pass-pragma-no-branch.diff` — `# pragma: no branch` added to `tools/run.py`
- `fixtures/test-integrity/TI13/pass-markdown.diff` — the istanbul hint added to `README.md`
- `CHANGELOG.md` — Unreleased entries for TI10 and TI13
- `README.md` — the `test-integrity` input row and the message-code table name TI10 and TI13
- `docs/LIMITS.md` — "What TI10 misses", "What TI13 misses", and the section 8 kept-text sentence
- `docs/THREAT-MODEL.md` — item 16: source and `package.json` text kept; fixed-sentence details
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `schema/report.v1.json` — unchanged; a test pins it to the base commit
- `packages/core/src/diff/unified.ts` — the reader already keeps text for any selected file, within its bounds
- `packages/core/src/testFiles.ts` — the test-file detection is reused as it is
- `packages/core/src/testIntegrityMode.ts` — the mode rules of the earlier increment
- `packages/core/src/signals/ti01.ts` — TI01 keeps its rules and texts
- `packages/core/src/signals/ti03.ts` — TI03 keeps its rules and texts
- `packages/core/src/signals/ti04.ts` — TI04 keeps its rules and texts
- `packages/core/src/signals/ti11.ts` — TI11 keeps its rules and texts
- `packages/core/src/signals/ti14.ts` — TI14 keeps its rules and texts
- `packages/core/src/signals/testLines.ts` — the test-line parsers are not used by TI10 or TI13
- `packages/cli/src/main.ts` — no new flag; the reader options are already passed
- `packages/action/src/run.ts` — no new input
- `package.json` — no new dependency or script

## Acceptance mapping

- AC-1 → `keepSignalFileText` selects `package.json` by basename and the nine source extensions by new or old path;
  `package-lock.json`, Markdown and `.github/dependabot.yml` stay unselected; the unchanged reader bounds give
  `textTruncated` at 5001 lines and cut a 500-character line to 400.
- AC-2 → script-line scan, the six value kinds on `test*` keys (root and nested `package.json`), the removed-hook rule
  at the old-file line; severity the mode.
- AC-3 → pre-existing kinds by key; non-`test` keys ignored; `&&` positions not command positions for `echo`; `-t` only
  as a whole token; `pretest` kept when an added line of the same key exists; added and deleted `package.json` skipped;
  `src/package.json.ts` is not a `package.json` (and has no TI13 marker).
- AC-4 → the exemption: non-empty `repoFiles` with no test file and no deleted test file; an empty list or a deleted
  test file does not exempt; TI01 still reports the deleted test.
- AC-5 → one signal per kind per line; the per-file cap of 20 on the lowest lines; seven fixed, distinct details with no
  line text.
- AC-6 → JS/TS marker scan (block and line comments, inline, the three tools) in non-test JS/TS files of every listed
  extension, Python pragma scan (trailing, spacing variants), added files included; severity the mode.
- AC-7 → normalized-marker matching for moves; removed-only markers give nothing; test files skipped; per-language
  markers only; comment start required; whole word `ignore`; `no branch` is not `no cover`; Markdown not selected.
- AC-8 → one-to-one consumption in line order (the higher added line fires); cap of 20; four fixed, distinct details
  with no comment text.
- AC-9 → `check()` sort; `SIGNAL_MESSAGES` levels from the highest severity (`error` in block, `warn` in warn); mode
  `off` computes nothing and adds no TI10 or TI13 message.
- AC-10 → `SIGNAL_HINTS` and `MESSAGE_HINTS` in the existing renderer line shape; the hints' fixed wording; the shared
  selector keeps text and streaming reports equal; CLI JSON; schema v2 validation.
- AC-11 → no existing fixture or test diff touches a `package.json` test script or adds a marker (checked in discovery);
  the one selector assertion on `src/app.ts` changes, recorded in BUILD.md; TI01, TI03, TI04, TI11 and TI14 untouched.
- AC-12 → schema description, CHANGELOG, README, the two LIMITS sections, THREAT-MODEL item 16; TI10 fixtures (7 block,
  7 pass) and TI13 fixtures (6 block, 8 pass) cover every named pass case.

## Risks & open questions

- Source files now keep text, so the reader's memory for a large diff grows with the number of changed source files
  (each still capped at 5000 lines of at most 400 characters). THREAT-MODEL item 16 states it beside the residual risk
  of no input size caps.
- The rebuilt `packages/action/dist/index.js` is a JS file TI13 reads on pharn-ci's own PR. It already holds three
  coverage hints from bundled dependencies; they give no signal while their lines are unchanged. If a dependency bump
  or a rebuild moves one onto an added line, the dogfood run (default mode `warn`) reports a TI13 warning on the bundle.
  `ti13.ts` itself must not hold a literal marker (see Steps).
- Case-insensitivity: the SPEC's marker sentence ends "case-insensitive" after the Python form; this plan applies it to
  both forms, since normalization lower-cases the matched text either way. A reader who wants JS/TS markers matched
  case-sensitively should say so at grill.
- `exit 0` is read at the same command positions as `echo` (start, after `||` or `;`), so `vitest run && exit 0`, which
  still fails when the runner fails, gives nothing. The SPEC says only "as a command"; the AC cases (`; exit 0`) agree
  with either reading.
- Details contain the plain word "test" and tool names (Istanbul, V8, C8); the AC-5 and AC-8 tests should check that no
  detail holds the line's script key in quotes, its value, or its comment text (for example `ignore next`,
  `pragma: no cover`), not single common words.
- Fixture count and names are advisory; the build may add or rename fixtures within the two directories only by
  changing this list first.
