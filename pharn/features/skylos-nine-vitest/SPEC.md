---
spec_id: skylos-nine-vitest
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 ships the diff-only test-integrity signals (Epic 1). Skylos's benchmark names nine ways an agent hides
a failing test, and the test-integrity spec's "Definition of done" (item 2) asks pharn-ci to reproduce them and say
which it catches, by signal id: the diff-only signals of v0.2.0 catch 2 of 9. Today nothing in the repository shows
that number or keeps it true. Backlog item 8 ("Skylos nine, part 1") reproduces the nine cases as small, hand-written
vitest-flavoured fixtures and pins them as AC tests through `check()` and the comment renderer: the two cases caught
today (a deleted test, by TI01; an added skip, by TI03) are pinned as caught, and the other seven as expected misses
that must not crash, each naming the signal planned to catch it later. When a later signal ships, the miss assertion of
its case is replaced by a catch assertion, so the benchmark result can only move forward on purpose.

## Scope

**In scope:**

- Nine fixture directories under `fixtures/skylos-nine/`: `deleted-test`, `added-skip`, `emptied-assertion`, `deselect-setting`, `hard-coded-answer`, `always-true-matcher`, `replaced-test`, `loosened-assertion` and `edited-expected-value`, each holding exactly `change.diff` (a unified diff in the `--unified=0` style of `fixtures/test-integrity/**`) and `files.txt` (the repository's tracked files at head, one path per line).
- New AC test files `packages/core/test/ac-skylos-nine-<aspect>.test.ts` that run each case through `check()` in mode `block` and render the comment.
- A table in the AC tests mapping each case to the signal that catches it or will catch it (TI01, TI03, TI05, TI09, TI15, none, TI02, TI06, TI07), with a comment saying that when the later signal ships, that case's miss assertion is replaced by the catch assertion.
- A headline test: nine cases, 2 caught, 7 expected misses.

**Out of scope (non-goals):**

- Any change under `packages/*/src`, `schema/`, `action.yml` or `packages/action/dist`; no new signal, message code, input or setting.
- The pytest half of the benchmark and the published table (backlog item 17).
- `docs/LIMITS.md`, README and CHANGELOG for v0.2.0 (backlog item 9); this item adds no CHANGELOG line because nothing user-visible changes.
- Changing any existing test, fixture or golden file, or the Biome configuration.
- Writing expected results or signal ids into a fixture.

## Acceptance Criteria

- **AC-1** Given the `deleted-test` case, whose `change.diff` deletes a vitest test file (for example `src/__tests__/<name>.test.ts`) whose removed lines define tests and leaves its source file in place, and whose `files.txt` lists the source file and not the deleted test file When `check()` runs on it in mode `block` and the comment is rendered Then the report validates against the schema, `testIntegrity.signals` holds exactly one signal with id `TI01`, its severity is `block`, `testIntegrity.verdict` is `fail`, and the rendered "Test integrity" section holds a line with `**TI01**` and the deleted file's path
  - verify: unit
- **AC-2** Given the `added-skip` case, whose `change.diff` turns an existing `it(` or `test(` opening line of a vitest test file into `it.skip(` or `test.skip(` with the same test name and no condition, in the shape of `fixtures/test-integrity/TI03/block-it-skip-existing.diff` When `check()` runs on it in mode `block` and the comment is rendered Then the report validates against the schema, `testIntegrity.signals` holds exactly one signal with id `TI03`, its severity is `block`, `testIntegrity.verdict` is `fail`, and the rendered "Test integrity" section holds a line with `**TI03**` and the file's `path:line` in a code span
  - verify: unit
- **AC-3** Given each of the seven cases `emptied-assertion`, `deselect-setting`, `hard-coded-answer`, `always-true-matcher`, `replaced-test`, `loosened-assertion` and `edited-expected-value` When `check()` runs on it in mode `block` and the comment is rendered Then `check()` returns without throwing, the report validates against the schema, `testIntegrity.signals` is an empty list, rendering does not throw, and the rendered "Test integrity" section reads `No test-integrity findings (mode: block).`
  - verify: unit
- **AC-4** Given the case table in the AC tests and the nine fixture directories When every case is run through `check()` in mode `block` Then the table has exactly nine entries mapping `deleted-test` to TI01, `added-skip` to TI03, `emptied-assertion` to TI05, `deselect-setting` to TI09, `hard-coded-answer` to TI15, `always-true-matcher` to none, `replaced-test` to TI02, `loosened-assertion` to TI06 and `edited-expected-value` to TI07, exactly two cases (`deleted-test` and `added-skip`) give a report with any test-integrity signal, each carrying only the id its table entry names, and the other seven give none, so the returned count is 2 caught of 9
  - verify: unit
- **AC-5** Given the directory `fixtures/skylos-nine/` When its entries are listed and read Then it holds exactly the nine case directories named in the Scope, each holding exactly the two files `change.diff` and `files.txt`, every `change.diff` is a non-empty unified diff whose hunk lines start with `@@`, `+` or `-` only (no context lines), every path a `change.diff` touches ends in `.ts`, `.tsx`, `.js` or `.mjs`, no `change.diff` or `files.txt` holds the text `pytest` or a `.py` path, and every `files.txt` is non-empty with one repository-relative path per line
  - verify: unit
- **AC-6** Given the seven miss cases' `change.diff` files When each diff's added and removed lines are read Then `emptied-assertion` removes at least one line holding `expect(` from a test file and adds no line holding `expect(`; `deselect-setting` touches only `vitest.config.ts` and adds or removes a line holding `exclude` or `include`; `hard-coded-answer` touches only files that are not test files and adds a line holding `if`; `always-true-matcher` adds a line holding `expect.extend(`; `replaced-test` modifies one test file that stays in its `files.txt`, removes one test-opening `it(` or `test(` line and adds one with a different test name; `loosened-assertion` removes a line holding `toBe(` or `toEqual(` and adds a line holding `toBeTruthy()`; and `edited-expected-value` removes and adds a line with the same matcher whose expected literal differs
  - verify: unit

## Constraints

- No change under `packages/*/src`, `schema/`, `action.yml` or `packages/action/dist`; no new message code, input, setting or dependency; no CHANGELOG, LIMITS or README change.
- Existing tests, fixtures under `fixtures/` other than `fixtures/skylos-nine/`, and every file under `fixtures/golden*` stay byte-identical and the whole suite still passes.
- Each AC test reads its fixtures inside the test body with the `fixture()` helper from `packages/core/test/helpers.ts`, never at module top level, so the file always loads and a missing fixture fails only its test.
- Every report produced in the AC tests is validated with `expectValidReport`.
- Fixtures are inputs only: expected results and signal ids live in the AC tests, never in a fixture.
- Fixtures are small, hand-written and vitest-flavoured (`describe`/`it`/`expect`, `vitest.config.ts`); no pytest.
- If a shipped signal fires on a miss case's natural diff, the case's diff is changed so it does not; the miss assertion is never weakened.

## Assumptions

- The AC tests call `check()` and `renderMarkdown()` the way `packages/core/test/ac-ti03-added-test.test.ts` does: `check` imported inside the test body, `testIntegrityMode: { input: "block" }`, `repoFiles` read from the case's `files.txt`, `diff: { text }` from its `change.diff`, and no accept label.
- The coverage input is not part of a case: the AC tests pass an existing coverage fixture (for example `fixtures/test-files-deleted/coverage.info`), so the case directories hold only `change.diff` and `files.txt` as the item describes.
- "Blocking" means signal severity `block`, which in mode `block` makes `testIntegrity.verdict` `fail`, as for the shipped TI01 and TI03 tests.
- The `deleted-test` case keeps its source file and deletes no other source file and adds no same-named test, so the TI01 precision rules leave it at `block` rather than `info`.
- The `deselect-setting` case avoids `package.json` scripts and `.pharn/ci.yml` so TI10 and TI14 stay silent, and avoids workflow files so TI11 stays silent; a `vitest.config.ts` edit is not read by any shipped signal.
- The `hard-coded-answer` case adds no coverage-ignore comment, so TI13 stays silent.
- The case table and headline live in the AC tests; the TEST-INTEGRITY-SPEC "Definition of done" figure "2/9" is the headline value.
- The repository has no end-to-end runner and `package.json` has `"test": "vitest run"`; every criterion is verified at unit level, as the item states.
