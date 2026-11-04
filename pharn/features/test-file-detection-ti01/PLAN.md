---
spec_id: test-file-detection-ti01
spec_content_hash: 2c38d211d99a424d8df0abed2c9412290a0012448900ddb18ad3149d2f009181
applied_lessons: none
---

## Approach

Keep the check pure and additive. A new `isTestFile` (the spec globs) and a few small helpers live in `testFiles.ts`.
The diff reader gains an opt-in text mode: for files a `keepText` predicate selects it records `hunks` (added and removed
`{ line, text }` per hunk, bounded) and, when a bound is hit, `textTruncated: true`. A selected file always gets a `hunks`
array, empty when the diff shows no hunk for it, so "text was kept and there was none" differs from "text was never kept".
`check()` and `readDiffChunks` (the streaming path of the CLI and the Action) both select test files, so the same text
exists whichever way the diff arrives.

TI01 is one new pure function in `signals/ti01.ts`: it takes the parsed diff and the effective mode and returns the signals
(sorted by path), each already carrying its effective severity (a block finding is `warn` in mode `warn`). `check()` passes
them to `buildReport`, which fills `testIntegrity.signals` and `testIntegrity.verdict`, and adds one
`TEST_INTEGRITY_TI01` message whose level is the highest severity among the signals; the overall verdict then follows from
the existing message rule. `TEST_FILES_DELETED` is untouched except that it now uses the new `isTestFile`.

## Applied lessons

- none — this project has no memory-bank yet (the lessons index verdict is NO_CANON), so there is no lesson to cite.

## Steps

- `testFiles.ts`: rewrite `isTestFile` to the globs. Basename tests: `.test.` or `.spec.` followed by one of js, jsx, ts,
  tsx, mjs, cjs as the whole remaining extension; `.e2e.ts`; `.pw.ts`; Python `test_*.py` and `*_test.py`; Go `*_test.go`.
  Directory test: any non-final segment exactly `test`, `tests` or `__tests__`. Case-sensitive. Add `testStem(path)` (the
  basename without extension, with a `.test`/`.spec`/`.e2e`/`.pw` infix, a `test_` prefix or a `_test` suffix removed),
  `definesTests(line)` (one anchored, linear pattern over the trimmed line: `it`, `test`, `describe`, `context`, `specify`
  with optional dotted modifiers then `(`; `def test_` or `async def test_`; `func Test`), `testPackageDir(path)` (the test's
  directory, or the parent of the nearest `test`/`tests`/`__tests__` segment; `""` for the repo root) and
  `keepTestFileText(file)` (the predicate: path or old path is a test file). `deletedTestFiles` stays as it is.
- `diff/unified.ts`: add the `keepText` option to `createUnifiedDiffReader` and `parseUnifiedDiff`. Selection happens at
  the first hunk or at the end of the entry's header (paths are known by then), so unselected files cost nothing. Keep per
  hunk `oldStart`, `newStart`, `added` (new-file line numbers) and `removed` (old-file line numbers); cut each text at 400
  characters; stop keeping after 5000 lines (added plus removed) per file and set `textTruncated: true`; a selected file
  with no hunk gets `hunks: []`. `addedLines` and all existing results do not change when no option is given.
- `signals/ti01.ts`: `detectTI01(diff, mode)` returns `TestIntegritySignal[]`. Candidates are deleted test files and test
  files renamed to a non-test path (old path reported); a binary file never counts; a candidate counts when a removed line
  `definesTests`, when `textTruncated` is set, when its `hunks` are absent (text not kept: fail closed), or when it is a
  rename with no removed lines. Info when exempt: (a) a deleted non-test file with the same `testStem`; (b) a deleted
  non-test file inside `testPackageDir` (never when that is `""`); (c) an added or renamed-into test file with the same
  stem whose added lines `definesTests`. Details are fixed sentences naming the reason, with no file text. Effective
  severity: block stays block in mode `block`, becomes warn in mode `warn`; info stays info; mode `off` returns nothing.
- `report.ts`: add `TestIntegritySignal` and `TestIntegrityId` types, the code `TEST_INTEGRITY_TI01`,
  `BuildReportInput.testIntegritySignals`, the single message (up to five paths with the existing "and N more" form, level
  from the highest severity), and the `testIntegrity` block's `signals` and `verdict` (fail on a block, warn on a warn,
  else pass); `languages` stays `[]`.
- `check.ts`: parse a diff text with `keepText: keepTestFileText`; compute the signals once, up front, for every report path
  that has a parsed diff; pass them to `buildReport`.
- `chunkInputs.ts`: `readDiffChunks` selects test-file text by default, so the CLI and the Action need no change.
- `render/markdown.ts`: the "Test integrity" section lists one line per signal (severity icon, `TI01`, code-spanned path,
  detail) with a hint line below, and keeps the fixed empty-state line; add the hint for `TEST_INTEGRITY_TI01` that does not
  mention an accept label.
- `index.ts`: export the new function, types and helpers.
- `schema/report.v2.json`: add `TEST_INTEGRITY_TI01` to the message-code description; do not touch `report.v1.json`.
- Fixtures: write the diffs named in `## Files` under `fixtures/test-integrity/TI01/`; each is a small, real `git diff`
  shape (with `deleted file mode`, `rename from`/`rename to`, `Binary files ... differ` where the case needs it).
- Existing test: `ac-test-files-deleted-check.test.ts` runs its checks with the mode `off`, so its "baseline verdict"
  assertion keeps its meaning (the message is info only); note the reason in BUILD.md.
- Docs: CHANGELOG (Unreleased), README (test-integrity section: TI01), `docs/LIMITS.md` (section 8 now says text is kept,
  capped, for test files; add what TI01 misses), `docs/THREAT-MODEL.md` (parsing of untrusted diff text: caps, linear-time
  matching, no content in the report).
- Run `pnpm build` so `packages/action/dist/index.js` is rebuilt; regenerate goldens with `-u` only if a golden changes, and
  review the diff.

## Files

- `packages/core/src/testFiles.ts` — the detection function and the TI01 helpers
- `packages/core/src/diff/unified.ts` — opt-in line text per hunk, with bounds
- `packages/core/src/signals/ti01.ts` — the TI01 detector (new)
- `packages/core/src/chunkInputs.ts` — the streaming reader selects test-file text
- `packages/core/src/check.ts` — keepText on the text path, computes and passes the signals
- `packages/core/src/report.ts` — signal types, the message code, the message, the testIntegrity block
- `packages/core/src/render/markdown.ts` — the section's finding lines and the TI01 hint
- `packages/core/src/index.ts` — exports
- `schema/report.v2.json` — the message-code description names TEST_INTEGRITY_TI01
- `packages/core/test/ac-test-files-deleted-check.test.ts` — existing test: run with mode off (reason in BUILD.md)
- `fixtures/test-integrity/TI01/block-code-stays.diff` — a test file deleted, its source stays
- `fixtures/test-integrity/TI01/block-rename-away.diff` — a test renamed to a non-test path, no hunk
- `fixtures/test-integrity/TI01/block-root-tests.diff` — a repo-root tests file deleted with an unrelated source file
- `fixtures/test-integrity/TI01/pass-helper.diff` — a helper under tests deleted
- `fixtures/test-integrity/TI01/pass-init-py.diff` — an empty `__init__.py` under tests deleted
- `fixtures/test-integrity/TI01/pass-fixture-json.diff` — a data fixture under tests deleted
- `fixtures/test-integrity/TI01/pass-binary.diff` — a binary file under tests deleted
- `fixtures/test-integrity/TI01/info-with-source.diff` — `foo.test.ts` deleted with `foo.ts`
- `fixtures/test-integrity/TI01/info-package-removed.diff` — a package removed with its `__tests__`
- `fixtures/test-integrity/TI01/info-migration-ts.diff` — a mocha spec replaced by a vitest `.test.ts`
- `fixtures/test-integrity/TI01/info-migration-mjs.diff` — a spec replaced by a `.test.mjs`
- `CHANGELOG.md` — Unreleased entry
- `README.md` — the test-integrity section names TI01
- `docs/LIMITS.md` — diff text bounds and what TI01 misses
- `docs/THREAT-MODEL.md` — parsing of untrusted diff text
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `schema/report.v1.json` — unchanged, a test pins it to the base commit
- `packages/cli/src/main.ts` — the streaming reader's default does the work
- `packages/action/src/run.ts` — same
- `packages/core/src/testIntegrityMode.ts` — the mode rules from the previous increment

## Acceptance mapping

- AC-1 → `isTestFile` rewritten to the globs; unit table over the listed paths and the test-files-deleted fixtures.
- AC-2 → `keepText` on the reader; `hunks` with line numbers and text for selected files only; `addedLines` unchanged.
- AC-3 → the 400-character and 5000-line bounds, `textTruncated`, linear matching; a 6000-line diff parses quickly.
- AC-4 → `detectTI01` in mode `block`: signal, message of level error, verdict fail.
- AC-5 → default mode gives warn everywhere; mode `off` computes nothing and keeps the OFF message.
- AC-6 → files whose removed lines define no test (helper, empty `__init__.py`, json fixture) and binary files do not count.
- AC-7 → the three info exemptions: same stem, same package, migration.
- AC-8 → repo-root guard, pure rename away, truncated text, and code-stays cases count.
- AC-9 → `TEST_FILES_DELETED` unchanged (same message), and info only with the mode off.
- AC-10 → `readDiffChunks` keeps test-file text, so the CLI path and the text path report the same TI01.
- AC-11 → the section lists the findings with hints; the empty line stays; reports stay schema-valid.
- AC-12 → schema description, CHANGELOG, README, LIMITS, THREAT-MODEL and the fixtures.

## Risks & open questions

- A rename with 100 % similarity shows no lines, so a renamed helper under `tests/` counts on the path alone (stated in
  LIMITS).
- A same-stem source deleted elsewhere in the diff exempts a deleted test (the spec wording); stated in LIMITS.
- `hunks` on `DiffFile` is new surface; consumers that spread or compare whole `DiffFile` objects may see it only for test
  files. Tests that compare parser output structurally are unaffected because no existing stream fixture holds a test file.
