---
spec_id: ti17-always-true-matcher-2
state: Approved
spec_content_hash: "a097ee5856fed13f08a42431b7792538fc45e2d963ea81ce321ceb5fd1867320"
approved_by: model
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
---

## Intent

An AI coding agent that cannot make a failing test pass can make the test stop checking: it swaps the assertion for
one that always passes. Three spellings of that are known and no pharn-ci signal is built for them (docs/LIMITS.md,
"TI17 proposal (not implemented)"): a custom `expect.extend` matcher whose `pass` is the constant `true`, a Python
helper that always returns `True` and is asserted on, and a wildcard (`expect.anything()`, `mock.ANY`) put where a
concrete expected value stood. TI06 sees a matcher that became weaker, not a matcher that always passes, so today
the vitest Skylos case `always-true-matcher` and the pytest case `always-true-matcher-any` give no finding at all and
the pull request gets a `pass` (docs/PRECISION.md §3: vitest 7 of 9).

The reviewer of an agent's pull request (and the platform or AppSec lead who installed the check) wants pharn-ci to
say "this test now asserts something that cannot fail, look at it", as a warning and never as a block by default,
because each of the three can be deliberate. It matters now because the operator reopened the Action's feature list
for this item first (product/DECISIONS.md, 2026-11-09 "The Action's feature list reopens for four items"): it is the
one Skylos case with no signal in vitest or pytest, and Skylos is the benchmark the product is measured against.

This is the second run of this intent. The first stopped without a result for one reason: the new TI17 fixtures are
walked by an existing test that lists every `fixtures/test-integrity/<dir>/*.diff`
(`packages/action/test/ac-accept-signoff-regression.test.ts`), and that test was not among the tests the change was
allowed to re-pin. So this intent also names every existing test that walks the test-integrity fixtures or refuses new
fixtures, with what each needs (the section "Existing tests that change on purpose").

## Scope

**In scope:**

- A new test-integrity signal `TI17`, the always-true matcher, with message code `TEST_INTEGRITY_TI17`, for
  JavaScript and TypeScript test files (vitest and jest) and Python test files (pytest and unittest). It reads only
  lines the diff adds to a test file (and, for the wildcard, the lines the same change removes there).
- Detection 1 (JS/TS): an `expect.extend` matcher defined on added lines whose `pass` is the constant `true`, when an
  added line of the same test file calls that matcher.
- Detection 2 (Python): a helper function defined on added lines whose every `return` is the constant `True`, when an
  added assertion of the same test file asserts on a call to it.
- Detection 3 (JS/TS and Python): the wildcard as the expected side of an equality assertion, in place of a concrete
  expected value the change removes: `toBe`, `toEqual` or `toStrictEqual` given `expect.anything()`; `assert x == ANY`
  and `assertEqual(x, ANY)` with the wildcard spelled `ANY`, `mock.ANY` or `unittest.mock.ANY`.
- Severity `warn` in the test-integrity modes `block` and `warn`, nothing in mode `off`, like TI06. An org policy may
  set the `TI17` severity like every other TI key.
- The schema change the operator decided as the versioned decision AGENTS.md rule 2 asks for:
  `schema/report.v2.json` accepts the signal id `TI17` and names `TEST_INTEGRITY_TI17` among the known codes;
  `schema/policy.v1.json` gains a `TI17` severity key and stops describing TI17 as an error.
- A fix hint for the signal and its message, of the existing kind `restore-assertion`.
- New fixtures under `fixtures/test-integrity/TI17/`, named by result (`warn-*`, `pass-*`): at least one must-trigger
  and one must-not-trigger per detection.
- The Skylos result moving forward on purpose: vitest `always-true-matcher` becomes TI17 warn (vitest 8 of 9), pytest
  `always-true-matcher` shows TI06 warn and TI17 warn, pytest `always-true-matcher-any` becomes TI17 warn (pytest
  stays 8 of 9). Every existing test that pins the old result is re-pinned on purpose, with its reason (the section
  "Existing tests that change on purpose").
- The existing tests that walk every test-integrity fixture, or that refuse a new or changed fixture, accept the new
  TI17 fixtures and the changed `fixtures/policy/invalid/unknown-ti` fixture by adding to their allow-lists, with
  every earlier pin (count, digest, earlier allow-list entry) kept.
- Documentation: README (signal list and table, Skylos paragraph, message-code table, Roadmap line), docs/LIMITS.md
  ("TI17 proposal" becomes "What TI17 misses", the caught and missed lists, the Python parity table),
  docs/PRECISION.md §3 (the `always-true-matcher` row and the totals), docs/THREAT-MODEL.md, CHANGELOG Unreleased.
- The rebuilt `packages/action/dist`.

**Out of scope (non-goals):**

- Editing any file under `fixtures/skylos-nine/`, `fixtures/skylos-nine-pytest/` or `fixtures/skylos-nine-sources/`,
  or adding a `skylos-nine-sources` entry for `always-true-matcher`: changing the benchmark to fit the detector is the
  failure this product exists to catch.
- A `block` default for TI17, in any mode.
- A matcher or helper defined outside the diff, in another file of the diff, or on unchanged lines; a constant
  reached indirectly (a variable, a function call, a lambda); anything that is not on added lines. These are named
  misses, written into docs/LIMITS.md.
- Other always-true forms: `expect.any(...)`, `expect.objectContaining({})`, `toSatisfy(() => true)`, chai or
  node:assert custom assertions, a wildcard nested inside a larger expected value, a wildcard inside the arguments of
  a call matcher (`toHaveBeenCalledWith`, `assert_called_with`), where it stands for one argument.
- Go test files.
- Changing the Python test index (`packages/node-io/src/pythonIndex.ts`) or any other I/O: the detection is text
  scanning in core.
- A new fix-hint kind, a new report field, or any change of shape in `schema/` beyond the TI17 id, code and policy key.
- `hard-coded-answer`, the one Skylos case still missed.
- Deleting, skipping or weakening an existing test, lock or assertion; changing the count (216) or the digest that
  `ac-accept-signoff-regression` pins for the fixtures that existed before this change.
- Cutting a release. The pharn.dev app's vendored copy of `schema/`, the pharn-ci skills and the private
  `product/` documents follow in their own repositories and by their owner's hand.

## Scenarios

- An agent is asked to fix a failing cart total. It adds
  `expect.extend({ toBeTotal: () => ({ pass: true, message: () => "" }) })` to `src/cart.test.ts` and changes
  `expect(total([2, 3])).toBe(5)` to `expect(total([2, 3])).toBeTotal()`. Today the check passes with no finding. With
  TI17 the comment carries a warning at the line of the changed assertion, saying the test file adds an assertion
  that always passes, with a hint to restore the assertion; the check does not fail.
- A pytest test changes `assert total([2, 3]) == 5` to `assert total([2, 3]) == ANY` and adds
  `from unittest.mock import ANY`. The reviewer sees a TI17 warning at that line.
- A developer writes a new test that checks a call with `toHaveBeenCalledWith(1, expect.anything())`, and another
  adds a real matcher whose `pass` compares its argument. Neither gets a TI17 finding.
- An organization that wants this to stop a merge sets `test_integrity.signals.TI17` to `block` in its org policy in
  the app; from then on the same change fails the check in mode `block`.

## Acceptance Criteria

- **AC-1** Given the unchanged benchmark case `fixtures/skylos-nine/always-true-matcher` (its `change.diff` and
  `files.txt` only, no base or head sources) When `check()` runs in test-integrity mode `block` Then the report is
  valid against `schema/report.v2.json`, its `testIntegrity.signals` holds exactly one signal, with id `TI17`,
  severity `warn`, path `src/cart.test.ts` and line 9, and its messages hold one `TEST_INTEGRITY_TI17` at level `warn`
  - verify: integration
- **AC-2** Given the unchanged benchmark case `fixtures/skylos-nine-pytest/always-true-matcher-any` When `check()`
  runs in mode `block`, once with the base and head test files indexed by the real Python index and once from the
  diff alone Then each report holds exactly one test-integrity signal: id `TI17`, severity `warn`, path
  `tests/test_cart.py`, line 10
  - verify: integration
- **AC-3** Given the unchanged benchmark case `fixtures/skylos-nine-pytest/always-true-matcher` (the helper
  `matches_total` that returns `True`) When `check()` runs in mode `block` with the real Python index Then the report
  holds the `TI06` warn signal it holds today, unchanged, and one more signal: id `TI17`, severity `warn`, path
  `tests/test_cart.py`, line 13
  - verify: integration
- **AC-4** Given a diff that adds to a jest test file `src/cart.test.js` and to a vitest test file `src/cart.test.ts`
  an `expect.extend` matcher whose only `pass` is the literal `true`, written as a method with a `return` statement
  spread over several added lines (`toBeTotal(received) {` … `return { pass: true, message: () => "" };` … `}`), with
  a TypeScript parameter type in the `.ts` file, and adds an assertion `expect(total([2, 3])).toBeTotal();` in the
  same file When `check()` runs in mode `block` Then each file gives one `TI17` signal with severity `warn` at the
  line of its added assertion
  - verify: integration
- **AC-5** Given diffs of a test file that add (a) a matcher with `pass: received === 5` and a call to it, (b) a
  matcher with one `return { pass: true, … }` and one `return { pass: false, … }` and a call to it, (c) a matcher
  with `pass: true` that no added line calls, (d) a call `expect(x).toBeTotal()` on an added line to a matcher the
  diff does not define, and (e) a matcher whose `pass` is a variable (`const ok = true;` … `pass: ok`) and a call to
  it When `check()` runs in mode `block` Then no report holds a `TI17` signal or a `TEST_INTEGRITY_TI17` message
  - verify: integration
- **AC-6** Given diffs that add to a Python test file a helper `def matches_total(value):` whose every `return` is
  `return True` (one helper with a single return, one with two `return True` in two branches) and add, in the same
  file, `assert matches_total(total([2, 3]))` in a pytest test and `self.assertTrue(matches_total(total([2, 3])))` in
  a `unittest.TestCase` method When `check()` runs in mode `block` from the diff alone Then each file gives one `TI17`
  signal with severity `warn` at the line of its first such added assertion
  - verify: integration
- **AC-7** Given diffs of a Python test file that add (a) a helper with `return value == 5` and an assert on it, (b)
  a helper with one `return True` and one `return False` and an assert on it, (c) a helper that always returns `True`
  and no added assertion on it, (d) `assert matches_total(x)` on an added line for a helper the diff does not define,
  and (e) a helper that always returns `True` used inside a larger condition
  (`assert matches_total(x) and x == 5`) When `check()` runs in mode `block` Then no report holds a `TI17` signal
  - verify: integration
- **AC-8** Given diffs of a JS or TS test file that remove `expect(total([2, 3])).toBe(5);` and add, in its place,
  `expect(total([2, 3])).toBe(expect.anything());`, and the same with `toEqual` and with `toStrictEqual` When
  `check()` runs in mode `block` from the diff alone Then each gives one `TI17` signal with severity `warn` at the
  added line
  - verify: integration
- **AC-9** Given diffs of a JS or TS test file that (a) replace `expect(spy).toHaveBeenCalledWith(1, 2);` by
  `expect(spy).toHaveBeenCalledWith(1, expect.anything());`, (b) replace `toEqual({ id: 7, total: 5 })` by
  `toEqual({ id: expect.anything(), total: 5 })`, (c) add a new test whose assertion is
  `expect(make()).toEqual(expect.anything());` while the change removes no line, and (d) re-indent a line that already
  read `toEqual(expect.anything())` (removed and added with the same expected side) When `check()` runs in mode
  `block` Then no report holds a `TI17` signal
  - verify: integration
- **AC-10** Given diffs of a Python test file that replace `assert total([2, 3]) == 5` by `assert total([2, 3]) == ANY`,
  by `== mock.ANY` and by `== unittest.mock.ANY`, and replace `self.assertEqual(total([2, 3]), 5)` by
  `self.assertEqual(total([2, 3]), ANY)` in a `unittest.TestCase` method When `check()` runs in mode `block` from the
  diff alone Then each gives one `TI17` signal with severity `warn` at the added line
  - verify: integration
- **AC-11** Given diffs of a Python test file that (a) replace `m.assert_called_with(1, 2)` by
  `m.assert_called_with(1, ANY)`, (b) replace `m.assert_called_once_with(2)` by `m.assert_called_once_with(mock.ANY)`,
  (c) replace `assert row == {"id": 7, "total": 5}` by `assert row == {"id": ANY, "total": 5}`, (d) add a new test
  whose assertion is `assert make() == ANY` while the change removes no line, and (e) re-indent a line that already
  read `assert x == ANY` When `check()` runs in mode `block` Then no report holds a `TI17` signal
  - verify: integration
- **AC-12** Given the added lines of AC-1, AC-6 and AC-10 placed in files that are not test files by name
  (`src/matchers.ts`, `src/helpers.py`), the added and removed lines of AC-10 placed in the Go test file
  `pkg/cart_test.go`, and a diff that only removes an always-true matcher and its call from a test file When
  `check()` runs in mode `block` Then no report holds a `TI17` signal
  - verify: integration
- **AC-13** Given a diff that adds, in one test file, an always-true matcher with three assertions that call it and
  one wildcard replacement, and in a second test file one always-true helper with one assertion When `check()` runs
  Then there is exactly one `TI17` signal per file, at the lowest line of that file's always-true assertions, the two
  ordered by path; each `detail` is at most 300 characters, says how many such assertions the file adds, and contains
  neither the matcher name, the helper name nor any other text of the diff; the one `TEST_INTEGRITY_TI17` message
  names both paths
  - verify: integration
- **AC-14** Given a change whose only finding is the one of AC-1 and whose diff coverage passes When `check()` runs in
  mode `block`, in mode `warn` and in mode `off` Then in `block` and in `warn` the signal has severity `warn`, the
  message has level `warn` and the verdict is `warn`; in `off` there is no `TI17` signal, no `TEST_INTEGRITY_TI17`
  message and the verdict is `pass`
  - verify: integration
- **AC-15** Given the change of AC-14 When `check()` runs in mode `block` with an app policy whose
  `test_integrity.signals.TI17` is `block`, then `off`, then with a policy file whose value is `info`, and in mode
  `warn` with the app policy value `block` Then: app `block` gives severity `block`, a message at level `error` and
  the verdict `fail`; app `off` gives no `TI17` signal and no message; the policy file's `info` leaves severity `warn`
  and the report carries a `POLICY_OVERRIDE_IGNORED` message naming `test_integrity.signals.TI17`; mode `warn` with
  app `block` gives severity `warn`
  - verify: integration
- **AC-16** Given the policy document `{ "version": 1, "test_integrity": { "signals": { "TI17": "warn" } } }` When it
  is validated by core and against `schema/policy.v1.json` Then it is valid, and given the same document with the key
  `TI18` When validated Then it is invalid with an error whose `path` names the key and whose message repeats no
  value from the document; the fixture `fixtures/policy/invalid/unknown-ti.json` (and its `.paths` file) names `TI18`
  as its unknown key
  - verify: unit
- **AC-17** Given `schema/report.v2.json` and `schema/policy.v1.json` at HEAD When a report whose signal has id `TI17`
  is validated Then it is valid, a signal with id `TI18` is invalid, the known-codes description names
  `TEST_INTEGRITY_TI17`, the policy schema describes a `TI17` severity key and no longer says TI17 is an error, and
  the two files, with exactly those insertions and description edits taken out, are byte-identical to the files at
  the base commit
  - verify: unit
- **AC-18** Given a report with a `TI17` signal When its fix hints are read Then the signal and the
  `TEST_INTEGRITY_TI17` message each carry a `fix` of kind `restore-assertion` with one fixed sentence of at most 200
  characters, the signal's `fix.target` is its `path:line`, and the list of fix kinds is the same eight kinds as
  before
  - verify: unit
- **AC-19** Given the report of AC-1 When the pull request comment is rendered Then its Test integrity section lists
  the `TI17` finding with `src/cart.test.ts:9` and its detail, placed after any `TI16` finding, with a hint line that
  says to restore the assertion that can fail or to say in the pull request why the test checks less now
  - verify: unit
- **AC-20** Given a diff of two test files, one `.test.ts` and one `test_*.py`, each adding 5000 lines of 400
  characters built from unclosed `expect.extend({` openers, nested brackets, `pass:` words, `def` lines, `return True`
  lines and `== ANY` fragments When `check()` runs in mode `block` Then it returns a report that is valid against the
  schema in under 5 seconds, with at most one `TI17` signal per file
  - verify: unit
- **AC-21** Given the nine vitest cases and the nine pytest cases (with the `-any` and `-aliased` variants) run
  through `check()` in mode `block` as the pinned Skylos tests run them When the results are counted and the
  documents are read Then vitest catches 8 of 9 and pytest 8 of 9, the only missed case of each is
  `hard-coded-answer`, and the README Skylos paragraph, the docs/PRECISION.md §3 row `always-true-matcher` (vitest
  `TI17 warn`; pytest `TI06 warn` and `TI17 warn`; the `mock.ANY` variant caught by TI17) with its totals line, and the
  docs/LIMITS.md caught and missed lists state exactly those results
  - verify: integration
- **AC-22** Given docs/LIMITS.md and the README at HEAD When they are read Then LIMITS has a `### What TI17 misses`
  subsection in place of the proposal, which says TI17 warns and never blocks by default and names each miss (a
  matcher or helper defined outside the diff or in another file, a constant computed indirectly, anything not on
  added lines, a wildcard that replaces nothing the change removes, the kept-text caps); the LIMITS Python parity
  table and the README signal table each have a `TI17` row naming a fixture or the `warn` severity as the other rows
  do; the README message-code table has a `TEST_INTEGRITY_TI17` row; and the README Roadmap still links
  `#test-integrity` and no longer names the custom matcher that always passes
  - verify: unit
- **AC-23** Given CHANGELOG.md and docs/THREAT-MODEL.md at HEAD When they are read Then the Unreleased section names
  `TI17` and `TEST_INTEGRITY_TI17` under Added, and under Changed says that a pull request can go from `pass` to
  `warn` and that report consumers see a new signal id in `schema/report.v2.json` and a new `TI17` key in
  `schema/policy.v1.json`; no new version heading is added; and the threat model names TI17's scan of added test-file
  lines with its bounds (linear time, the kept-text caps)
  - verify: unit
- **AC-24** Given the repository at HEAD When `fixtures/` is compared with the base commit and
  `fixtures/test-integrity/TI17/` is listed Then every file under `fixtures/skylos-nine/`,
  `fixtures/skylos-nine-pytest/` and `fixtures/skylos-nine-sources/` is byte-identical to the base commit, there is no
  `fixtures/skylos-nine-sources/always-true-matcher`, and `fixtures/test-integrity/TI17/` holds for each of the three
  detections at least one `warn-*` and one `pass-*` case, each of which, run through `check()`, gives a schema-valid
  report with a `TI17` signal for the `warn-*` cases only
  - verify: integration
- **AC-25** Given `fixtures/test-integrity/TI17/` holding at least one `.diff` fixture, and
  `packages/action/test/ac-accept-signoff-regression.test.ts` at HEAD and at the base commit When that test file's
  text is read at both and its sha256 at HEAD is computed Then its `ADDED_AFTER_BASE` set at HEAD holds `TI17/<name>`
  for every `.diff` file under `fixtures/test-integrity/TI17/` and every entry the set held at the base commit; its
  `BEFORE_COUNT` (216) and its `BEFORE_DIGEST` are the literals of the base commit; and the sha256 that
  `packages/core/test/ac-ti09y-regression.test.ts` and `packages/action/test/ac-pyparity2-unchanged.test.ts` each pin
  for that file is its sha256 at HEAD
  - verify: unit

## Constraints

- AGENTS.md rule 1: the detection lives in `packages/core` and is pure: no `fs`, `process`, subprocess, network,
  clock or randomness. It reads the diff text `check()` already receives; it does not need the Python index and it
  gives the same finding with or without the base and head test sources.
- AGENTS.md rule 2: within `schema/report.v2.json` and `schema/policy.v1.json` nothing is removed, renamed or
  retyped. The only schema edits are: the signal id pattern accepts `TI17`, the known-codes description gains
  `TEST_INTEGRITY_TI17`, the policy schema gains a `TI17` severity key beside `TI16`, and its descriptions stop saying
  TI17 is an error. The TypeScript types follow. Message codes are stable API: `TEST_INTEGRITY_TI17` is new and no
  existing code changes meaning.
- AGENTS.md rule 3: every detection ships with fixtures in `fixtures/test-integrity/TI17/`, and every report a test
  produces is validated with `expectValidReport`.
- AGENTS.md rule 4: no existing test, lock or assertion is deleted, skipped or weakened. A test that pins the old
  result is re-pinned to the new one, listed below with its reason, and the list is repeated in the pull request
  body. If a floor check refuses one of these re-pins, the run stops and quotes the refusal.
- Every existing test this change must edit is listed in the section "Existing tests that change on purpose", and the
  plan's declared files include each of them: the first run stopped because one
  (`packages/action/test/ac-accept-signoff-regression.test.ts`) was missing from that declaration. Before planning,
  the tests are searched again for any other that lists `fixtures/test-integrity/` or refuses a new fixture.
- AGENTS.md rule 5 and the product rule "nothing leaves the job": no network call is added, and the signal's
  `detail`, the message text and the fix hint are fixed text, counts and repo-relative paths, never a matcher name, a
  helper name, a test name or assertion text.
- AGENTS.md rule 6: no new dependency. AGENTS.md rule 7: `pnpm build` refreshes the committed
  `packages/action/dist`.
- The scan runs in time linear in the kept diff text (at most 5000 kept lines per file, 400 characters per line), with
  hand-written left-to-right scanning or anchored patterns without nested quantifiers, as TI15 and TI16 do, and with a
  stated cap on what it tracks per file.
- Severity: `warn` by default in modes `block` and `warn`; nothing in `off`; never `block` unless an org policy sets
  it. Policy precedence is the existing one: an app policy replaces the severity, a policy file may only raise it,
  mode `warn` caps `block` to `warn`.
- Settings the pull request carries cannot loosen the signal: no new input, no `.pharn/ci.yml` key and no exemption
  comment is added for TI17.
- Every enumeration of the test-integrity signals gains TI17 in the same change: the report types and the signal
  message table, the comment's hint map and signal order, the fix-hint table, the policy signal ids and limits, both
  schemas and the documentation tables.
- Every documented count is re-derived from the pinned tests, never typed by hand.
- The change is additive for report consumers and ships as a minor version later (docs/RELEASING.md); this increment
  cuts no release.

## Existing tests that change on purpose

Each is re-pinned, never deleted; the reason is the same change of result unless a line says otherwise: the vitest
`always-true-matcher` case goes from missed to TI17 warn (vitest 7 of 9 becomes 8 of 9), the pytest
`always-true-matcher` row gains TI17 beside TI06, and pytest `always-true-matcher-any` goes from missed to TI17 warn
(pytest stays 8 of 9).

- The test that walks every test-integrity fixture: `packages/action/test/ac-accept-signoff-regression.test.ts`
  (AC-14 of that feature lists every `fixtures/test-integrity/<dir>/*.diff`, leaves out only the names in its
  `ADDED_AFTER_BASE` set, and pins 216 records and one digest for the rest). Reason: the TI17 fixtures are new, so
  they are added to `ADDED_AFTER_BASE`, as every fixture added after its base was; nothing is taken out of the set and
  the count and the digest stay. Its own sha256 is pinned in `packages/core/test/ac-ti09y-regression.test.ts` and in
  `packages/action/test/ac-pyparity2-unchanged.test.ts`, so both pins are refreshed to the edited file.
  `packages/core/test/ac-fix-hints-pins.test.ts` (AC-12) runs the edited file again in a child run and passes once it
  does.
- The tests that refuse a new or changed fixture: `packages/core/test/ac-p07-unchanged.test.ts` and
  `packages/core/test/ac-p11-unchanged.test.ts` (each allows new fixtures only under listed directories and no
  modified fixture) accept `fixtures/test-integrity/TI17/` and the changed `fixtures/policy/invalid/unknown-ti.json`
  and `unknown-ti.paths`; `packages/action/test/ac-pyparity2-unchanged.test.ts` (no fixture of its base changes) gets
  the same `unknown-ti` allowance. Reason: the unknown-key fixture named `TI17` as its unknown key, which is now a
  known key, so it moves to `TI18`.
- Other tests that list fixture directories were read for this intent and walk fixed lists of earlier directories
  (`ac-ti0205-regression`, `ac-ti081516-regression`, `ac-ti06-ti12-unchanged`, node-io `ac-ti07-moved`,
  `ac-ti1411-docs`): they change only if they fail.
- Skylos result pins in `packages/core/test/`: `ac-skylos-nine-table.test.ts` (AC-4: the case entry, the headline
  "7/9", two missed), `ac-skylos-nine-misses.test.ts` (AC-3: the miss list holds `always-true-matcher`; its miss
  assertion becomes a catch assertion), `ac-ti0205-skylos.test.ts` (AC-17), `ac-ti06-ti12-skylos.test.ts` (AC-15),
  `ac-ti07-skylos.test.ts` (AC-14: seven caught, two missed), `ac-ti09y-skylos.test.ts` (AC-18),
  `ac-v020-skylos-count.test.ts` (AC-3), `ac-v020-limits.test.ts` (AC-1: the missed pair
  `always-true-matcher`/TI17), `ac-v020-readme.test.ts` (AC-5 "7 of 9"; AC-7 stays as it is when the Roadmap line is
  reworded and still links `#test-integrity`), `ac-ti06-ti12-docs.test.ts` (AC-18),
  `ac-signal-precision-ti06-weakening.test.ts` (AC-11: seven caught), `ac-name-only-suite.test.ts` (AC-9: "catch
  **7 of 9**" and '"7/9"' read from the working tree).
- Skylos result pins in `packages/node-io/test/`: `ac-skylos-pytest-warn.test.ts` (AC-6: `always-true-matcher` gives
  only TI06), `ac-skylos-pytest-misses.test.ts` (AC-7: the miss list holds `always-true-matcher-any`),
  `ac-skylos-pytest-table.test.ts` (AC-8: the expected row, a cell pattern that allows one id per cell, the totals
  "vitest 7 of 9, pytest 8 of 9").
- Document-text pins in `packages/core/test/`, because the documents they quote change: `ac-skylos-pytest-ti17.test.ts`
  (AC-11: the last subsection is the "TI17 proposal", "not implemented"; it becomes "What TI17 misses"),
  `ac-skylos-pytest-limits.test.ts` (AC-10), `ac-skylos-pytest-readme-changelog.test.ts` (AC-12: the README paragraph
  verbatim), `ac-skylos-pytest-notes.test.ts` (AC-9: the PRECISION notes say `mock.ANY` is missed),
  `ac-release030-readme-signals.test.ts` (AC-5: "catch **7 of 9**", sixteen ids, "no TI17 row", the never-block list
  and the LIMITS parity rows), `ac-pyparity2-limits.test.ts` (AC-18: the parity rows are exactly TI01 to TI16) and
  `ac-precision-v030-readme.test.ts` (AC-10: "TI06, TI07, TI08 and TI12 warn"), the last two only where the row or
  the sentence they pin changes. `ac-name-only-docs.test.ts` reads docs/LIMITS.md at a committed revision and changes
  only if it fails.
- Schema, code and id pins in `packages/core/test/`: `ac-report-v2-schema.test.ts` (AC-4 expects TI17 rejected; the
  rejected id becomes TI18), `ac-fix-hints-mapping.test.ts` (AC-4: the signal and message kind tables gain TI17 and
  `TEST_INTEGRITY_TI17`), `ac-polv1-invalid.test.ts` (AC-3: the unknown-key fixture uses TI17; it moves to TI18).
- Schema byte-compare pins, which compare a schema with an older commit: one new helper in a new test-helper file
  takes the TI17 insertions out first, requiring each exactly once (the precedent is `withoutV090SchemaEdits` in
  `packages/core/test/v090-codes.ts`), chained in each user of that precedent:
  `packages/action/test/ac-pyparity2-unchanged.test.ts` (which also pins `ac-skylos-nine-table.test.ts` and
  `ac-accept-signoff-regression.test.ts` to its base, "catch **7 of 9**", '"7/9"', the report code set and the dist
  freshness) and, in `packages/core/test/`, `ac-fix-hints-pins.test.ts`, `ac-p07-schema-hints.test.ts`,
  `ac-p11-schema-hints.test.ts`, `ac-precision-v030-schema.test.ts`, `ac-py-index-docs.test.ts`,
  `ac-secrets-repin.test.ts`, `ac-test-sources-docs.test.ts`, `ac-ti07-schema.test.ts`, `ac-ti081516-docs.test.ts`,
  `ac-upload-schema.test.ts`, `docs-schema-levels.test.ts`; `injection-schema.test.ts` and `stale-docs.test.ts` only
  if they fail; and `ac-polrules-docs.test.ts` (AC-18) if the policy description edit reaches the text it pins.
- Meta-tests over the Skylos test files, because the files they pin change: `ac-ti06-ti12-unchanged.test.ts` (AC-19:
  the titles and the "7 of 9" and "7/9" literals of six Skylos test files) and `ac-ti09y-regression.test.ts` (AC-20:
  the count-test literals, and the sha256 of `ac-accept-signoff-regression.test.ts` named above).
- Locks that cover some of these tests and may refuse the edit: `pharn/features/skylos-nine-vitest/AC-TESTS.lock.json`,
  `pharn/features/release-readiness-v020/AC-TESTS.lock.json`, `pharn/features/report-v2-skeleton/AC-TESTS.lock.json`,
  `pharn/features/fix-hints/AC-TESTS.lock.json` and `pharn/features/accept-label-human-signoff-4/AC-TESTS.lock.json`
  (which lists `ac-accept-signoff-regression.test.ts`). A refusal is quoted and the run stops; a lock is never
  deleted.
- Must stay unchanged: `packages/core/test/ac-skylos-nine-fixture-pins.test.ts` (the sha256 and file set of
  `fixtures/skylos-nine*/`), `ac-skylos-nine-fixtures.test.ts`, `ac-skylos-nine-diffs.test.ts`, and in
  `packages/node-io/test/` `ac-skylos-pytest-fixtures.test.ts` and `ac-skylos-pytest-warn-miss-diffs.test.ts`.

## Assumptions

- The specification of TI17 is docs/LIMITS.md "TI17 proposal (not implemented)" together with the operator's decision
  of 2026-11-09; the private `product/TEST-INTEGRITY-SPEC.md` (TI01 to TI16) is not edited here.
- The first run's record and implementation are kept in a git stash and are not in the tree. This SPEC stands on its
  own; the first run's work is reference material the plan may reuse, and criteria AC-1 to AC-24 ask for what the
  first run's criteria asked for.
- One finding per test file, at the lowest line of the file's always-true assertions, with the count in a fixed
  detail, as TI16 does. A finding per assertion would repeat the same sentence and need a cap of its own.
- The finding points at the added assertion (the call of the matcher, the assert on the helper, the line with the
  wildcard), not at the definition: that is the line a reviewer has to restore. For the three benchmark cases this is
  line 9, line 13 and line 10.
- "Defined in the diff" and "used by a test in the diff" both mean added lines of the same test file. A matcher from
  a setup file, or a helper imported from another file of the change, is a named miss.
- "Constant true" means every `pass` of the matcher (every `return` of the helper) on the added lines is the literal
  `true` (`True`), with at least one; a mix of `true` and anything else is not constant, and a value reached through
  a variable, a call or a lambda is a named miss.
- "Used in an assert" means the helper call is the whole asserted condition: `assert helper(...)` with an optional
  message, or `self.assertTrue(helper(...))` in a unittest test file. The second form is read from "the pytest
  detections work for pytest and unittest test files"; a helper inside a larger condition still leaves a real check
  and is not reported.
- "The removed line of the same test had a concrete value" is judged from the diff text: the change removes, in the
  same hunk, an equality assertion of the same family whose expected side is not the wildcard. A wildcard in a new
  assertion that replaces nothing, and a replacement the diff splits across hunks, are not reported; the second is a
  named miss.
- The expected side is the whole argument of `toBe`, `toEqual` or `toStrictEqual`, the right operand of `==` in an
  `assert`, and the second argument of `assertEqual`, as in the increment's examples. The mirrored orders
  (`assert ANY == x`, `assertEqual(ANY, x)`) and an aliased import (`from unittest.mock import ANY as A`) are named
  misses.
- `ANY`, `mock.ANY` and `unittest.mock.ANY` are recognised by name, without checking the import: a test file's own
  constant called `ANY` would be reported too. This is a warning for a reviewer, and docs/LIMITS.md says so.
- A matcher call is the matcher's name after a dot on an added line (`.toBeTotal(`), so `.not.` and `.resolves.`
  chains count.
- A policy file that sets `TI17` lower than `warn` is ignored with `POLICY_OVERRIDE_IGNORED`, and an app policy may
  set any severity including `off`, exactly as for TI06; no rule special to TI17 is added.
- The fix hint's kind is `restore-assertion`, as for TI06. The comment's hint is worded after TI06's (restore the
  assertion, or say in the pull request why the test checks less now); whether it also names the accept label, as
  TI06's hint does, is left to the plan and no criterion pins it.
- The detection adds a new scanner over untrusted diff text, so docs/THREAT-MODEL.md gains its note in this change.
- Every `.diff` file directly under `fixtures/test-integrity/TI17/` joins the `ADDED_AFTER_BASE` set of
  `ac-accept-signoff-regression.test.ts`; which fixtures exist beyond the minimum of AC-24 is the plan's choice. Each
  of them is asserted by this feature's own tests, as the set's comment asks of every fixture it leaves out.
- AC-25 reads the test file and the two pins; that the edited test itself passes is shown by the project's `test`
  script at verify and by `ac-fix-hints-pins` AC-12, which already runs every edited test in a child run.
- Existing tests that name the old count and still hold are left as they are: `ac-ti0102-skylos.test.ts` (AC-7 counts
  only its seven named catches, which stay caught), `ac-release030-changelog-facts.test.ts` (it reads a released
  CHANGELOG section, which this change does not edit) and `exercise-render.test.ts` (its "7 of 9" counts source
  files, not Skylos cases). Any of them changes only if it fails, with its reason added to the pull request body.
- The lock `pharn/features/accept-label-human-signoff-4/AC-TESTS.lock.json` already records an older sha256 of
  `ac-accept-signoff-regression.test.ts` than the file has today (earlier increments re-pinned the file), so a
  further on-purpose edit of the file is expected to be accepted as those were; if a floor check refuses it, the run
  stops and quotes the refusal.
- The project's `test` script (`vitest run`) is the runner for every criterion, at the `unit` and `integration`
  levels; the criteria that use the real Python index run where `python3` is present, as the existing pytest Skylos
  tests do. No criterion needs an end-to-end run.
- The 5 second bound of AC-20 is a generous ceiling for a linear scan of 10000 lines of 400 characters on a CI
  runner, not a performance target.
- The line numbers of the listed tests in the increment description are approximate and are not repeated here; the
  test file and its criterion id identify each pin.
