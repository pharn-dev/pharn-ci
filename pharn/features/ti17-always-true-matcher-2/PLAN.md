---
spec_id: ti17-always-true-matcher-2
spec_content_hash: "a097ee5856fed13f08a42431b7792538fc45e2d963ea81ce321ceb5fd1867320"
applied_lessons: none
---

## Approach

ADVISORY — model work, planned from the Approved SPEC and a live read of the code this run (base commit
`12036e8c485a656eeb9a4a9beb869e51e37b7d80`, which is HEAD). The first run's plan and implementation (git
`stash@{0}`, "ti17 loop run 1 (STOP_CAP)") were read as reference DATA; this plan reuses their design and adds what
that run lacked: the one existing test that walks every test-integrity fixture,
`packages/action/test/ac-accept-signoff-regression.test.ts`, and the two sha256 pins of that file. The first run
stopped at `STOP_CAP` with every AC passing and only that test (and `ac-fix-hints-pins` AC-12, which re-runs it in a
child vitest) red, because the test was outside its `## Files`.

TI17 is one more diff-only test-integrity signal, built like TI16 (`packages/core/src/signals/ti16.ts`): it reads only
`file.hunks` (the kept added and removed lines, already cut at 5000 lines per file and 400 characters per line by
`parseUnifiedDiff`), only for files where `isTestFile(path)` holds and `testLanguage(path)` is `"jsts"` or `"python"`
(Go and non-test files are skipped by construction), and gives at most one signal per file, at the lowest line of that
file's always-true assertions, with a fixed `detail` holding only a count. It needs neither the test sources nor the
Python index, so it gives the same finding with or without them (SPEC Constraints, AGENTS.md rule 1). `check()` adds
`...detectTI17(parsedDiff)` beside `detectTI16` inside the mode-not-off branch, so mode `off` computes nothing; the
signal is always `severity: "warn"`, and the existing `applySignalOverrides` (app policy replaces, policy file only
raises, mode `warn` caps `block`) applies to it unchanged because it keys on `POLICY_SIGNAL_IDS`. Already-cut test
files are named by `textCutSignalFiles` (test file with a `testLanguage`), so no new truncation path is needed.

Three scanners, each one left-to-right pass per kept line with no backtracking and no regex with nested quantifiers
(TI15/TI16 style), each with a stated cap:

1. **Always-true matcher (JS/TS).** Walk the added lines of the file in ascending head-line order. An `expect.extend(`
   on an added line opens a definition: from there, track bracket depth (quotes with backslash escapes and `//` line
   comments skipped, a backtick treated as a quote) across the following added lines, which must be consecutive head
   lines; a gap (an unchanged line) before the object closes abandons the definition (a matcher on unchanged lines is a
   named miss). At depth 1 of the object, a key is an identifier followed by `:` (property) or `(` (method; an `async`
   prefix allowed); its span runs to the next depth-1 `,` or the closing `}`. Inside a span, every `pass` word (not
   preceded by a word character or `.`) is classified: `pass` + blanks + `:` + blanks + `true` + a non-word character
   is true; any other value, and the shorthand `pass` followed by `,` or `}`, is not. A matcher is always-true when it
   has at least one `pass` and every one is true. Calls: on added lines outside every definition span, `.` + name +
   blanks + `(` for a recorded name (so `.not.` and `.resolves.` chains count); each line counts once. Cap: 50
   always-true names per file; an unclosed opener stays open only until the gap or the end of the file, so the pass is
   linear.
2. **Always-true helper (Python).** A line whose text after indentation is `def <name>(` opens a helper; its body is
   the following consecutive added lines that are blank or indented deeper than the `def`; it ends at the first line
   indented no deeper, or at a gap. Every line of the body whose text after indentation is `return` (word) is
   classified: the value, with a trailing `# comment` and blanks removed, equal to `True` is true; a bare `return` or
   any other value is not. A body that holds a nested `def`, `class`, `lambda` or `yield` makes the helper not
   always-true (conservative; only one helper is open at a time, so the pass stays linear). Always-true = at least one
   return and all true. Uses on added lines: `assert <name>(…)` where the call, read with balanced brackets to its
   closing `)`, is the whole condition (what follows is empty, a `,` message, or a `#` comment), and
   `self.assertTrue(<name>(…))` with an optional `, msg`. A helper inside a larger condition is not a use
   (`assert matches_total(x) and x == 5`). Cap: 50 always-true names per file.
3. **Wildcard expected value (JS/TS and Python).** A line is a JS equality line when it holds `.toBe(`, `.toEqual(` or
   `.toStrictEqual(` (the first occurrence is read); its expected side is a wildcard when the text after that `(` is
   blanks, `expect.anything()`, blanks, `)` — an O(1) check, so a nested wildcard (`{ id: expect.anything() }`) or a
   call matcher (`toHaveBeenCalledWith`) never qualifies. A line is a Python equality line when its text after
   indentation starts with `assert` + blank and holds a top-level `==` (first one, depth tracked), its expected side
   being the right operand cut at a top-level `,` or `#` and trimmed; or when it holds `assertEqual(` whose second
   top-level argument is the expected side. The Python wildcard is exactly `ANY`, `mock.ANY` or `unittest.mock.ANY`
   (by name, no import check; the mirrored order and aliases are named misses). Pairing, per hunk: each removed line of
   the same family whose whitespace-normalized text equals an added wildcard line's cancels it (a re-indent or move);
   each remaining added wildcard line then consumes one removed equality line of the same family in the same hunk whose
   expected side is not the wildcard; consumed added lines are findings. A wildcard that replaces nothing, or whose
   replaced line is in another hunk, is not reported.

The file's findings are the union of the matcher-call lines, helper-assert lines and wildcard lines (distinct lines).
One signal per file: `{ id: "TI17", severity: "warn", path, line: <lowest>, detail }`, where `detail` is fixed text plus
the count, never a name or diff text, at most 300 characters, for example
`This test file adds 1 assertion that always passes: a custom matcher or helper that is always true, or a wildcard in place of an expected value, so it no longer checks a value.`
(`2 assertions that always pass` for more). Signals sorted by path (`byCodeUnit`), then `sortSignals` orders by id, so
a TI17 sorts after any TI16 of the same path in report order.

Wiring follows "every enumeration gains TI17" (SPEC Constraints): `report.ts` (`MessageCode` union, the
`SIGNAL_MESSAGES` entry with one fixed sentence naming the paths, the `TI01–TI17` comments), `fix/table.ts`
(`FixSignalId`, `SIGNAL_FIXES.TI17` of kind `restore-assertion`, `MESSAGE_FIXES.TEST_INTEGRITY_TI17: S.TI17`),
`render/markdown.ts` (the `TEST_INTEGRITY_TI17` hint, worded after TI06's and naming the accept label because an org
policy can raise TI17 to `block`; `"TI17"` in `SIGNAL_HINT_IDS`), `policy/types.ts` and `policy/limits.ts`
(`PolicySignalId`, `POLICY_SIGNAL_IDS`), `index.ts` (export `detectTI17`). The comment's order of findings is unchanged
(`bySeverity`: block, then warn, then info, each in report order), so a TI17 lists after a TI16 of the same severity.

Schemas (the operator's versioned decision, AGENTS.md rule 2): `report.v2.json` signal id pattern
`^TI(0[1-9]|1[0-6])$` → `^TI(0[1-9]|1[0-7])$`, and one insertion in the message-code description directly after the
TI16 parenthetical (before `, TEST_INTEGRITY_TEXT_TRUNCATED`):
`, TEST_INTEGRITY_TI17 (TI17, an assertion that always passes added to a JS/TS or Python test file: a custom matcher whose pass is always true, a helper that always returns True, or a wildcard in place of an expected value; warn in modes block and warn, never block unless an org policy sets it; one finding per test file, in testIntegrity.signals)`.
`policy.v1.json`: `"Test-integrity signal settings (TI01-TI17)."`, the `signals` description says
`TI01-TI17; any other key (TI18 included) is an error`, and a `"TI17"` property after `"TI16"` in the same shape. A new
test helper takes exactly these edits out again (each required exactly once, the `withoutV090SchemaEdits` precedent in
`packages/core/test/v090-codes.ts`), so every byte-compare pin of a schema against an older commit keeps pinning every
other byte.

Existing tests: re-pinned on purpose, never weakened, each with one added comment line naming
`ti17-always-true-matcher-2` and the reason; titles kept unless a title states the old count, in which case
`ac-ti06-ti12-unchanged`'s `RENAMED_TITLES` gains the pair. The SPEC's section "Existing tests that change on purpose"
is the list, re-checked live this run (Risks, "Fresh search"). Two groups need care:

- **The fixture walker** `packages/action/test/ac-accept-signoff-regression.test.ts` (accept-label-human-signoff-4
  AC-14): its `ADDED_AFTER_BASE` set gains one entry `"TI17/<name>.diff"` per `.diff` under
  `fixtures/test-integrity/TI17/` (35 with the fixture list below), under one comment saying they are asserted by
  `ac-ti17-fixtures` (this feature's AC-24 test), as the set's doc comment asks. Nothing is removed from the set;
  `BEFORE_COUNT` (216) and `BEFORE_DIGEST` keep their base literals. The file's sha256 is pinned in
  `packages/core/test/ac-ti09y-regression.test.ts` (`PINNED`) and in `packages/action/test/ac-pyparity2-unchanged.test.ts`
  (`NAME_ONLY_REPINNED`); both values are refreshed to the edited file's sha256, each with a "Re-pinned again by
  ti17-always-true-matcher-2" comment, as earlier increments did. The digest is computed after the final edit of the
  walker (`shasum -a 256`), never typed.
- **Fixture-refusing tests** `ac-p07-unchanged.test.ts`, `ac-p11-unchanged.test.ts` (new tracked or untracked fixtures
  only under allow-listed directories, no modified fixture) and `ac-pyparity2-unchanged.test.ts` (no fixture of its
  base modified): they gain `fixtures/test-integrity/TI17/` and the two `fixtures/policy/invalid/unknown-ti.*` files,
  the latter accepted only as modified and only when turning `TI18` back into `TI17` gives the base bytes. Plus
  `ac-name-only-docs.test.ts` (its AC-10 pins `### TI17 proposal` as the last `###` subsection of "What test integrity
  does not catch"; it becomes `### What TI17 misses`) — found by the first run, not in the SPEC's list; it changes only
  if it fails, and the PR body names it with its reason.

## Applied lessons

- none — `node pharn/floor/check-lessons-index.mjs . --verdict` printed `NO_CANON`: the project has no
  `pharn/memory-bank/lessons-learned.md` yet, so there is no lesson to apply. (The first run's handoff "learned" note,
  that the fixture walker was missed, is applied directly above; it is a run record, not a promoted lesson.)

## Steps

1. **`packages/core/src/signals/alwaysTrue.ts` (new, pure).** The two definition-and-use scanners of Approach items 1
   and 2: `alwaysTrueMatcherLines(file: DiffFile): number[]` (JS/TS) and `alwaysTrueHelperLines(file: DiffFile): number[]`
   (Python), each returning the head lines of the added assertions that use an always-true matcher or helper, sorted and
   distinct. Hand-written scanning only; the caps as constants with a doc comment.
2. **`packages/core/src/signals/wildcardExpected.ts` (new, pure).** Approach item 3:
   `wildcardReplacementLines(file: DiffFile, language: "jsts" | "python"): number[]`, with the per-hunk
   cancel-then-consume pairing.
3. **`packages/core/src/signals/ti17.ts` (new, pure).** `detectTI17(diff: readonly DiffFile[]): TestIntegritySignal[]`:
   skip files with no `hunks`, binary, not `isTestFile`, or `testLanguage` not `jsts`/`python`; union the lines of the
   three scanners; one `warn` signal per file at the lowest line with the fixed count detail; sorted by path. The doc
   comment states the three forms, the caps, the linear time and the named misses (as TI16's does).
4. **`packages/core/src/check.ts`.** Import `detectTI17`; add `...detectTI17(parsedDiff)` after
   `...detectTI16(parsedDiff)` in the `sortSignals([...])` list. Nothing else.
5. **`packages/core/src/report.ts`.** `TI01–TI17` in the `TestIntegritySignal.id` comment; `"TEST_INTEGRITY_TI17"` in
   the `MessageCode` union after TI16; the `SIGNAL_MESSAGES` entry after TI16 with one fixed sentence naming the paths
   (for example "This change adds assertions that always pass to test files: <paths>. Check that each test still
   compares a value that can fail."), no `allPaths`, like TI16; TI17 in the `testIntegritySignals` doc list.
6. **`packages/core/src/fix/table.ts`.** `"TI17"` in `FixSignalId` and the doc comment (`TI01 to TI17`);
   `TI17: { kind: "restore-assertion", hint: "Restore an assertion that can fail in place of the one that always passes." }`
   (≤ 200 characters, none of the words the fix-hint word test bans); `TEST_INTEGRITY_TI17: S.TI17` in `MESSAGE_FIXES`.
   `FIX_KINDS` stays the same eight kinds.
7. **`packages/core/src/render/markdown.ts`.** A `TEST_INTEGRITY_TI17` hint after the TI16 hint: restore the assertion
   that can fail, or say in the PR why the test checks less now, and that a reviewer who is not the PR author can record
   that sign-off with the accept label; `"TI17"` after `"TI16"` in `SIGNAL_HINT_IDS`. `bySeverity` and the section
   layout stay.
8. **`packages/core/src/policy/types.ts` and `packages/core/src/policy/limits.ts`.** `| "TI17"` in `PolicySignalId`;
   `"TI17"` after `"TI16"` in `POLICY_SIGNAL_IDS`. `validate.ts` and `apply.ts` need no change (they read the list).
9. **`packages/core/src/signals/signalFiles.ts`.** Doc comment of `textCutSignalFiles`: "TI08, TI15, TI16 and TI17".
   No code change.
10. **`packages/core/src/index.ts`.** `export { detectTI17 } from "./signals/ti17.js";` after the TI16 export.
11. **`schema/report.v2.json` and `schema/policy.v1.json`.** The edits of Approach, nothing else; keep both files
    biome-formatted (`pnpm exec biome format --write schema/report.v2.json schema/policy.v1.json`, naming the files).
12. **`packages/core/test/ti17-schema.ts` (new test helper, not an AC test).** Exports the exact edited texts as
    constants and `withoutTi17SchemaEdits(text: string): string` (report.v2.json: removes the inserted code text and
    turns `1[0-7]` back into `1[0-6]`, each exactly once, throwing otherwise) and `withoutTi17PolicySchemaEdits(text)`
    (policy.v1.json: removes the `TI17` property and restores the two descriptions). Check while building that
    `withoutTi17SchemaEdits(read("schema/report.v2.json"))` equals `git show 12036e8c:schema/report.v2.json` byte for
    byte, and the same for the policy schema.
13. **Fixtures `fixtures/test-integrity/TI17/`** (new, diff-only, unified `-U0` like the TI16 cases). Names follow
    `<warn|pass>-<matcher|helper|wildcard>-<what>.diff`, so the detection a case belongs to is read from its name
    (AC-24); the 35 cases listed under `## Files`. Each `warn-*` gives exactly one TI17 `warn` signal and each `pass-*`
    none, through `check()` in mode `block` with the diff only. No fixture beyond those listed is added, so the walker's
    `ADDED_AFTER_BASE` (step 15) names exactly this set.
14. **`fixtures/policy/invalid/unknown-ti.json` and `.paths`.** `TI17` → `TI18` in both (the key and the error path),
    nothing else, so the unknown key is still rejected and `ac-polv1-invalid.test.ts` passes unedited.
15. **The fixture walker and its two pins** (Approach, first bullet), in this order: edit
    `packages/action/test/ac-accept-signoff-regression.test.ts` (`ADDED_AFTER_BASE` gains every `TI17/*.diff` of step
    13, with a comment; nothing else in the file changes); compute its sha256; write that value into
    `packages/core/test/ac-ti09y-regression.test.ts` `PINNED` and
    `packages/action/test/ac-pyparity2-unchanged.test.ts` `NAME_ONLY_REPINNED`, each with a comment. Run the walker,
    `ac-ti09y-regression`, `ac-pyparity2-unchanged` and `ac-fix-hints-pins` before moving on.
16. **Re-pin the other existing tests** under `## Files` (SPEC "Existing tests that change on purpose"), each with an
    added comment naming `ti17-always-true-matcher-2`:
    - Skylos result pins: the vitest `always-true-matcher` case moves to `signal: "TI17", caught: true` (its miss
      assertion in `ac-skylos-nine-misses` becomes a catch assertion), "7/9"/"7 of 9" become "8/9"/"8 of 9" for vitest,
      the pytest `always-true-matcher` row expects `TI06` and `TI17`, `always-true-matcher-any` expects `TI17`; the
      pytest totals stay 8 of 9; the table cell pattern of `ac-skylos-pytest-table` allows two ids in a cell.
    - Document-text pins: the new LIMITS subsection, README paragraph, PRECISION row and notes, signal lists (seventeen
      ids, a TI17 row, TI17 in the never-block list) and the parity rows TI01–TI17, exactly as the docs of step 17 read.
    - Schema byte-compare pins (the users of `withoutV090SchemaEdits`, and `ac-polrules-docs` if its pinned policy text
      moves): read the schema through `withoutTi17SchemaEdits` (or the policy helper) first, then the earlier helpers as
      before.
    - `ac-report-v2-schema`: the rejected id becomes `TI18`; `ac-fix-hints-mapping`: the tables gain TI17 and
      `TEST_INTEGRITY_TI17`.
    - Meta-tests: `ac-ti06-ti12-unchanged` (titles via `RENAMED_TITLES`, count literals), `ac-ti09y-regression` (count
      literals, plus the step-15 pin), `ac-pyparity2-unchanged` (`SECRET_CODES` gains `TI17` and `TEST_INTEGRITY_TI17`
      with a comment, the schema read through the TI17 helper, the pinned `ac-skylos-nine-table` digest, the
      "8 of 9"/"8/9" literals, the `unknown-ti` fixture allowance, plus the step-15 pin), `ac-name-only-suite` (the
      working-tree "catch **8 of 9**" and '"8/9"' reads), `ac-name-only-docs`, `ac-p07-unchanged`, `ac-p11-unchanged`
      (fixture allowances as in Approach).
    - Never change: `ac-skylos-nine-fixture-pins`, `ac-skylos-nine-fixtures`, `ac-skylos-nine-diffs`,
      `ac-skylos-pytest-fixtures`, `ac-skylos-pytest-warn-miss-diffs`, `ac-polv1-invalid`, and any file under
      `fixtures/skylos-nine*`.
    - Every digest written into a test (the walker, `ac-skylos-nine-table`, `ac-ti06-ti12-unchanged` digests) is
      computed from the final file after all its edits, and refreshed if that file is edited again later in the build.
17. **Docs.** README: the signal sentence lists TI01 to TI17; a TI17 row in the signal table (`an assertion that always
    passes: a custom matcher whose pass is always true, a Python helper that always returns True, or a wildcard in place
    of an expected value` | `warn` | yes | yes); the never-block sentence names TI17 with TI06, TI07, TI08 and TI12
    (and the count of signals that never fail the check re-derived); the Skylos paragraph says **8 of 9** with
    `always-true-matcher` by TI17 and only `hard-coded-answer` missed; a `TEST_INTEGRITY_TI17` row in the message-code
    table after TI16; the Roadmap line keeps the `#test-integrity` link and names `hard-coded-answer` instead of the
    always-passing matcher. `docs/LIMITS.md`: the caught list gains `always-true-matcher` — caught by TI17; the
    not-caught intro and list keep only `hard-coded-answer`; `### TI17 proposal (not implemented)` becomes
    `### What TI17 misses` (still the last `###` subsection of the section): TI17 warns and never blocks by default, and
    each miss — a matcher or helper defined outside the diff or in another file, a constant computed indirectly
    (variable, call, lambda), anything not on added lines, a wildcard that replaces nothing the change removes or whose
    replaced line is in another hunk, the mirrored order and aliased imports, a test file's own constant named `ANY`
    reported too, a Python helper body read up to the first unchanged line, the other always-true forms the SPEC puts
    out of scope, and the kept-text caps (5000 lines, 400 characters); the Python parity table gains a `TI17` row naming
    `warn-matcher-arrow` and `warn-helper-pytest` / `warn-wildcard-python-any`. `docs/PRECISION.md` §3: the
    `always-true-matcher` row reads vitest `TI17 warn`, pytest `TI06 warn` and `TI17 warn`, the `mock.ANY` variant
    caught by TI17; the totals line "vitest 8 of 9, pytest 8 of 9". `docs/THREAT-MODEL.md`: a residual naming TI17's
    scan of added test-file lines (linear time, the 5000-line and 400-character kept-text caps, 50 names per file, one
    finding per file, fixed detail, no new input, a warning a PR cannot use to lower its gate). `CHANGELOG.md`
    Unreleased: under Added, TI17 and `TEST_INTEGRITY_TI17`; under Changed, a pull request can go from `pass` to `warn`,
    and report consumers see the new signal id in `schema/report.v2.json` and the new `TI17` key in
    `schema/policy.v1.json`; no version heading. Every count is read from the pinned tests' results, never typed from
    memory.
18. **Rebuild and check.** `pnpm build` (refreshes `packages/action/dist/index.js`), `pnpm exec biome check` on the
    changed files (named one by one), `pnpm lint`, then the whole `pnpm test`. A failing test outside `## Files` stops
    the build and is reported; it is never edited.

## Files

- `packages/core/src/signals/ti17.ts` — new: `detectTI17`, one warn signal per JS/TS or Python test file
- `packages/core/src/signals/alwaysTrue.ts` — new: always-true matcher (JS/TS) and helper (Python) definition and use scanners
- `packages/core/src/signals/wildcardExpected.ts` — new: wildcard expected-value scanner with per-hunk pairing
- `packages/core/src/check.ts` — run `detectTI17` beside `detectTI16`
- `packages/core/src/report.ts` — `TEST_INTEGRITY_TI17` code, its signal message, TI17 in the id comments
- `packages/core/src/fix/table.ts` — TI17 fix entry (`restore-assertion`) and its message mapping
- `packages/core/src/render/markdown.ts` — TI17 hint and hint id
- `packages/core/src/policy/types.ts` — `TI17` in `PolicySignalId`
- `packages/core/src/policy/limits.ts` — `TI17` in `POLICY_SIGNAL_IDS`
- `packages/core/src/signals/signalFiles.ts` — doc comment names TI17
- `packages/core/src/index.ts` — export `detectTI17`
- `schema/report.v2.json` — signal id pattern accepts TI17; known codes name `TEST_INTEGRITY_TI17`
- `schema/policy.v1.json` — `TI17` severity key; descriptions name TI01-TI17 and TI18 as the error example
- `packages/core/test/ti17-schema.ts` — new test helper: takes the TI17 schema edits out for byte-compare pins
- `fixtures/test-integrity/TI17/warn-matcher-arrow.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-matcher-method-ts.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-matcher-method-js.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-compares.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-mixed.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-not-called.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-undefined.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-variable.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-source-file.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-matcher-removed-only.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-helper-pytest.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-helper-unittest.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-compares.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-mixed.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-unused.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-undefined.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-in-condition.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-helper-source-file.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-tobe.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-toequal.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-tostrictequal.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-python-any.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-mock-any.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-unittest-mock-any.diff` — new fixture
- `fixtures/test-integrity/TI17/warn-wildcard-assertequal.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-called-with.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-nested.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-new-test.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-reindented.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-python-called-with.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-python-called-once-with.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-python-nested.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-python-new-test.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-python-reindented.diff` — new fixture
- `fixtures/test-integrity/TI17/pass-wildcard-go-test.diff` — new fixture
- `fixtures/policy/invalid/unknown-ti.json` — the unknown signal key moves from TI17 to TI18
- `fixtures/policy/invalid/unknown-ti.paths` — the recorded error path moves from TI17 to TI18
- `packages/action/test/ac-accept-signoff-regression.test.ts` — re-pin: `ADDED_AFTER_BASE` gains every TI17 fixture; count and digest unchanged
- `packages/core/test/ac-ti09y-regression.test.ts` — re-pin: the walker's sha256 and the count-test literals
- `packages/action/test/ac-pyparity2-unchanged.test.ts` — re-pin: the walker's sha256, TI17 codes, schema helper, 8 of 9, unknown-ti allowance
- `packages/core/test/ac-fix-hints-pins.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-skylos-nine-table.test.ts` — re-pin: always-true-matcher caught by TI17, 8/9
- `packages/core/test/ac-skylos-nine-misses.test.ts` — re-pin: its miss assertion becomes a catch assertion
- `packages/core/test/ac-ti0205-skylos.test.ts` — re-pin: the Skylos count
- `packages/core/test/ac-ti06-ti12-skylos.test.ts` — re-pin: the Skylos count
- `packages/core/test/ac-ti07-skylos.test.ts` — re-pin: eight caught, one missed
- `packages/core/test/ac-ti09y-skylos.test.ts` — re-pin: the Skylos count
- `packages/core/test/ac-v020-skylos-count.test.ts` — re-pin: the Skylos count
- `packages/core/test/ac-v020-limits.test.ts` — re-pin: the missed pair is only hard-coded-answer
- `packages/core/test/ac-v020-readme.test.ts` — re-pin: "8 of 9"
- `packages/core/test/ac-ti06-ti12-docs.test.ts` — re-pin: the Skylos count in the docs
- `packages/core/test/ac-signal-precision-ti06-weakening.test.ts` — re-pin: eight caught
- `packages/core/test/ac-name-only-suite.test.ts` — re-pin: the working-tree "8 of 9" and "8/9" reads
- `packages/core/test/ac-name-only-docs.test.ts` — re-pin only if it fails: the last subsection is `### What TI17 misses`
- `packages/core/test/ac-skylos-pytest-ti17.test.ts` — re-pin: the proposal becomes "What TI17 misses"
- `packages/core/test/ac-skylos-pytest-limits.test.ts` — re-pin: the LIMITS text it quotes
- `packages/core/test/ac-skylos-pytest-readme-changelog.test.ts` — re-pin: the README paragraph
- `packages/core/test/ac-skylos-pytest-notes.test.ts` — re-pin: the PRECISION notes (mock.ANY caught by TI17)
- `packages/core/test/ac-release030-readme-signals.test.ts` — re-pin: seventeen ids, the TI17 row, the never-block list, the parity rows
- `packages/core/test/ac-pyparity2-limits.test.ts` — re-pin: the parity rows are TI01 to TI17
- `packages/core/test/ac-precision-v030-readme.test.ts` — re-pin: the never-block sentence names TI17
- `packages/core/test/ac-report-v2-schema.test.ts` — re-pin: the rejected signal id is TI18
- `packages/core/test/ac-fix-hints-mapping.test.ts` — re-pin: the kind tables gain TI17 and TEST_INTEGRITY_TI17
- `packages/core/test/ac-p07-schema-hints.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-p11-schema-hints.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-precision-v030-schema.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-py-index-docs.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-secrets-repin.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-test-sources-docs.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-ti07-schema.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-ti081516-docs.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/ac-upload-schema.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/docs-schema-levels.test.ts` — re-pin: schema read through the TI17 helper first
- `packages/core/test/injection-schema.test.ts` — re-pin only if it fails: schema read through the TI17 helper first
- `packages/core/test/stale-docs.test.ts` — re-pin only if it fails: schema read through the TI17 helper first
- `packages/core/test/ac-polrules-docs.test.ts` — re-pin only if its pinned policy-schema text moves: read through the policy helper
- `packages/core/test/ac-ti06-ti12-unchanged.test.ts` — re-pin: the Skylos count literals, file digests and renamed titles
- `packages/core/test/ac-p07-unchanged.test.ts` — re-pin: accept the new TI17 fixtures and the unknown-ti move
- `packages/core/test/ac-p11-unchanged.test.ts` — re-pin: accept the new TI17 fixtures and the unknown-ti move
- `packages/node-io/test/ac-skylos-pytest-warn.test.ts` — re-pin: always-true-matcher gives TI06 and TI17
- `packages/node-io/test/ac-skylos-pytest-misses.test.ts` — re-pin: always-true-matcher-any is caught by TI17
- `packages/node-io/test/ac-skylos-pytest-table.test.ts` — re-pin: the expected row, two ids per cell, vitest 8 of 9
- `README.md` — TI17 row, signal list, never-block list, Skylos paragraph, message-code row, Roadmap line
- `docs/LIMITS.md` — caught/missed lists, `### What TI17 misses`, Python parity row
- `docs/PRECISION.md` — §3 always-true-matcher row and totals
- `docs/THREAT-MODEL.md` — a residual for the TI17 scan of added test-file lines and its bounds
- `CHANGELOG.md` — Unreleased Added and Changed lines
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `fixtures/skylos-nine/`, `fixtures/skylos-nine-pytest/`, `fixtures/skylos-nine-sources/` — the benchmark; never edited, no `always-true-matcher` sources added
- `packages/core/test/ac-skylos-nine-fixture-pins.test.ts` — must stay unchanged (SPEC)
- `packages/core/test/ac-skylos-nine-fixtures.test.ts` — must stay unchanged (SPEC)
- `packages/core/test/ac-skylos-nine-diffs.test.ts` — must stay unchanged (SPEC)
- `packages/node-io/test/ac-skylos-pytest-fixtures.test.ts` — must stay unchanged (SPEC)
- `packages/node-io/test/ac-skylos-pytest-warn-miss-diffs.test.ts` — must stay unchanged (SPEC)
- `packages/core/test/ac-polv1-invalid.test.ts` — passes unedited once the fixture moves to TI18
- `packages/core/test/ac-ti0102-skylos.test.ts`, `packages/core/test/ac-release030-changelog-facts.test.ts`, `packages/core/test/exercise-render.test.ts` — their old counts still hold (SPEC Assumptions)
- `packages/core/test/ac-fix-hints-table.test.ts`, `packages/core/test/ac-growth-clock.test.ts` — name TI16 or "sixteen" in titles only; the first run passed them unedited
- `packages/node-io/src/pythonIndex.ts` — the Python index is not changed (SPEC non-goal)
- `packages/action/dist/typescript.js` — `typescript5` is not bumped
- `pharn/features/*/AC-TESTS.lock.json` — other features' locks are never edited or deleted

## Acceptance mapping

- AC-1 (vitest benchmark, one TI17 at `src/cart.test.ts:9`) → steps 1, 3, 4: the arrow matcher `pass: true` and the
  call `.toBeTotal(` on line 9, diff only.
- AC-2 (pytest `-any`, line 10, with and without the index) → steps 2–4: same-hunk `== 5` → `== ANY`; TI17 reads no
  source.
- AC-3 (pytest helper, TI06 unchanged + TI17 at line 13) → steps 1, 3, 4: `def matches_total` + `return True` on added
  lines, `assert matches_total(…)` on line 13.
- AC-4 (jest and vitest method form across lines, TS parameter type) → step 1 (multi-line depth tracking, method key,
  `return { pass: true … }`).
- AC-5 (five matcher non-findings) → step 1: compared/mixed/variable `pass` not constant, uncalled matcher, call with no
  definition.
- AC-6 (pytest and unittest helper, single and two `return True`) → step 1 helper scanner, `assert` and
  `self.assertTrue`.
- AC-7 (five helper non-findings) → step 1: non-constant returns, unused helper, undefined helper, helper inside `and`.
- AC-8 (`toBe`/`toEqual`/`toStrictEqual` with `expect.anything()`) → step 2.
- AC-9 (call matcher, nested wildcard, new test, re-indent) → step 2: O(1) whole-argument check, pairing rules.
- AC-10 (`== ANY`, `== mock.ANY`, `== unittest.mock.ANY`, `assertEqual(…, ANY)`) → step 2.
- AC-11 (Python call matchers, nested, new test, re-indent) → step 2.
- AC-12 (non-test names, Go test file, removal only) → step 3 file filter; scanners read added lines only.
- AC-13 (one signal per file, lowest line, path order, count detail ≤ 300, no names, message names both paths) → steps
  3, 5.
- AC-14 (block/warn: warn and verdict warn; off: nothing, pass) → step 4 (mode-off branch), step 5 (message level).
- AC-15 (app block/off, file info ignored, mode warn caps) → step 8 (`POLICY_SIGNAL_IDS`) with the existing
  `applySignalOverrides` and `applyPolicy`.
- AC-16 (policy doc with TI17 valid, TI18 invalid, fixture names TI18) → steps 8, 11, 14.
- AC-17 (schemas accept TI17, reject TI18, code named, policy key, base bytes once the edits are out) → steps 11, 12.
- AC-18 (fix of kind `restore-assertion`, target `path:line`, eight kinds) → step 6.
- AC-19 (comment lists TI17 with path:line, detail, hint) → step 7.
- AC-20 (10000 hostile lines under 5 s, at most one TI17 per file) → steps 1–3: single pass, caps, one open definition.
- AC-21 (vitest 8 of 9, pytest 8 of 9, docs state it) → steps 3–4, 16, 17.
- AC-22 (LIMITS `### What TI17 misses`, parity and README rows, code row, Roadmap) → step 17.
- AC-23 (CHANGELOG Unreleased, THREAT-MODEL bounds) → step 17.
- AC-24 (benchmark bytes unchanged, TI17 fixtures per detection, warn-only signals) → steps 13, 16 (no Skylos edits).
- AC-25 (walker's `ADDED_AFTER_BASE` holds every TI17 `.diff` and every base entry; `BEFORE_COUNT` 216 and
  `BEFORE_DIGEST` as at base; both sha256 pins equal the walker's HEAD sha256) → steps 13, 15.

## Risks & open questions

- **Fresh search (SPEC Constraints).** This run re-searched the tests: (a) the only test that lists every directory of
  `fixtures/test-integrity/` from the working tree is `ac-accept-signoff-regression`; `ac-name-only-suite` lists them
  with `git ls-tree` at fixed revisions, and `ac-ti0205-docs` / `ac-ti06-ti12-docs` read named signal directories;
  (b) its sha256 is pinned only in `ac-ti09y-regression` and `ac-pyparity2-unchanged` (plus the older value in
  `pharn/features/accept-label-human-signoff-4/AC-TESTS.lock.json`, never edited); (c) the users of
  `withoutV090SchemaEdits`, the "7 of 9"/"7/9" literals and the `TI01-TI16` / `1[0-6]` / "sixteen" texts match the
  SPEC's lists, with the exceptions under "Explicitly not touched". The first run's full `pnpm test` with the same
  implementation failed only on the walker and `ac-fix-hints-pins`, which is evidence (not proof) that no other pin
  moves. Discovery was targeted greps, not a full run with this change applied.
- **Walker digest.** `BEFORE_DIGEST` covers the earlier fixtures' signals and messages; it stays only if TI17 fires on
  no earlier test-integrity fixture. The first run's walker failed at the count assertion, before the digest, so this
  is not yet shown. If TI17 does fire on an earlier fixture, the digest moves and the run must stop and report it
  (changing `BEFORE_DIGEST` is outside what the SPEC allows), not tune the detector to a fixture.
- **One more re-pin outside the SPEC's list** (`ac-name-only-docs`, listed "only if it fails") and the `unknown-ti`
  allowance inside `ac-pyparity2-unchanged` follow from the SPEC's own required edits. Each is an allowance for exactly
  those paths with a base-byte check, never a loosening; the PR body lists them with the SPEC's. `/pharn-grill` should
  confirm this reading of AGENTS.md rule 4.
- **AC-19 order.** The comment orders findings by severity first (`bySeverity`), so a default `warn` TI17 lists before
  an `info` TI16; "after any TI16 finding" holds in report order and within one severity. The AC test should check the
  order with TI16 and TI17 at the same severity (or in `report.json` order), not by changing `bySeverity`.
- **Python body end at a gap.** A helper's body ends at the first unchanged line; an added `def … return True` inserted
  above existing indented lines would be read as complete. Rare, warn-only, and written into "What TI17 misses".
- **Other features' AC locks** (`skylos-nine-vitest`, `release-readiness-v020`, `report-v2-skeleton`, `fix-hints`,
  `accept-label-human-signoff-4`) cover some re-pinned tests. If a floor check refuses an edit for that reason, the run
  stops and quotes it (SPEC Constraints).
- **Message-code placement.** The code is inserted after the TI16 entry, not appended as a new "Codes added in"
  sentence, so the TI codes stay together; the helper removes exactly that insertion.
- **Version wording.** No "Codes added in v0.11.0" text and no release heading are written; the minor bump is the
  release's job (SPEC non-goal).
- **Stash.** `stash@{0}` holds the first run's tree; the build may read it as reference but must write every file
  through the plan's scope, and must not pop it (it carries the first run's record directory, which is not this
  feature's).
