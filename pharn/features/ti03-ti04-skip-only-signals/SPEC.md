---
spec_id: ti03-ti04-skip-only-signals
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 adds test-integrity signals computed from the diff (Epic 1, backlog item 5). The most common way an
agent's pull request weakens tests is to skip a test that failed in CI (4 of the 10 weakening PRs in the base rate,
`docs/PRECISION.md` §1), and a run can also be narrowed to a few tests by an added `.only`. Today neither is reported.
TI03 must report a skip added to a test file, and TI04 a narrowing `.only`, `fit` or `fdescribe` added to a JS/TS test
file, so a reviewer sees a precise, recorded finding with a hint and a block-mode setup fails the check. The base rate
showed that most added skips are honest (an environment guard with a reason, or a skip in a test the PR adds), so,
by the 2026-10-25 decision and the "Precision rules" of the test-integrity spec, TI03 blocks only an unconditional skip
on a test the diff shows to exist before the change; every other skip is a warning. The local diff has no context
lines, so every rule is decided from the added and removed lines of the hunks alone.

## Scope

**In scope:**

- Signal TI03 (test skipped) on added lines of test files: JS/TS named skips (`.skip`, `.todo`, `.fails`, `x`-prefixed calls, constant `skipIf`/`runIf`), JS/TS conditional and nameless skips, Python skip and xfail decorators and `pytest.skip(`, Go `t.Skip(`, `t.Skipf(`, `t.SkipNow(`.
- The TI03 severity rule: `block` (the mode) only for an unconditional skip on a test the diff shows to exist at base; `warn` for a conditional skip, an in-body skip, a skip in a file the change adds and a named skip on a test line the change adds.
- Signal TI04 (run narrowed) on added lines of JS/TS test files: a test word chain with `.only`, and the bare calls `fit(` and `fdescribe(`.
- Pre-existing skips and `.only` calls (the same token and test name on a removed line of the same file) never fire.
- The effect of the effective test-integrity mode (block, warn, off) on both signals, on `testIntegrity.verdict` and on the overall verdict.
- One `TEST_INTEGRITY_TI03` and one `TEST_INTEGRITY_TI04` message per report that carries findings of that id, and their hints in the PR comment.
- Fixtures under `fixtures/test-integrity/TI03/` and `fixtures/test-integrity/TI04/`, and updates to the v2 schema description, CHANGELOG, README, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`; the action dist rebuilt.

**Out of scope (non-goals):**

- TI10 and TI13, the accept label and its API call, flaky quarantine, per-signal overrides and app policy.
- AST-based detection (TI02, TI05 and later), and TI04 for Python or Go.
- `test.fixme` and other runner-specific skip words not named in this SPEC; they are documented misses.
- Reading the base or head content of a file; only the diff is read, and the diff reader is not changed.
- Any new dependency, action input, CLI flag or setting.
- Changing `schema/report.v1.json`, or removing or renaming any existing message code or report field.

## Acceptance Criteria

- **AC-1** Given a diff of the modified test file `src/user.test.ts` that adds, each at its own line and some indented, `it.only('a', () => {`, `test.only("b", () => {`, `describe.only('c', () => {`, `test.describe.only('d', () => {`, `describe.only.each([1, 2])('e %s', (n) => {`, `fit('f', () => {` and `fdescribe('g', () => {` When the check runs in mode `block` Then the report holds seven TI04 signals for `src/user.test.ts`, one per added line, each with severity `block`, the new-file line of its added line and the same fixed detail of at most 300 characters that holds none of the test names `a` to `g` as a quoted string
  - verify: integration
- **AC-2** Given diffs that add `solver.fit(x)`, `model.fit(x)`, `const r = fit(a)`, `expect(foo.only(1))` and the comment `// it.only('x', () => {})` to `src/user.test.ts`, add `def fit(self):` and `it.only('x')` to `tests/test_model.py`, add `fit(` to `pkg/model_test.go`, add `it.only('x', () => {` to the non-test file `src/util.ts`, and add `it.only('x', () => {` to `tests/fixtures/data.json` When the check runs in mode `block` Then none of them gives a TI04 signal
  - verify: integration
- **AC-3** Given diffs of `src/user.test.ts` that edit `it.only('a', () => {` to `it.only('a', async () => {`, move `describe.only('c', () => {` to another line of the same file (removed and added), edit `it.only('a', () => {` to `it.only('b', () => {`, and add 21 lines `it.only('t1', () => {` to `it.only('t21', () => {` When the check runs in mode `block` Then the edit to async and the move give no TI04 signal, the renamed test gives one TI04 signal at its added line, and the 21 added lines give exactly 20 TI04 signals for that file, on the 20 lowest line numbers
  - verify: integration
- **AC-4** Given diffs of modified JS/TS test files that each remove a test-opening line and add it with a skip, keeping the test name: `it('creates a user', () => {` to `it.skip('creates a user', () => {`, `it("creates a user", () => {` to `it.skip('creates a user', () => {`, `test('n', () => {` to `test.todo('n')`, `describe('s', () => {` to `xdescribe('s', () => {`, `it('n', () => {` to `xit('n', () => {`, `test.describe('s', () => {` to `test.describe.skip('s', () => {`, `it('n', () => {` to `it.fails('n', () => {`, `it('n', () => {` to `it.skipIf(true)('n', () => {` and `it('n', () => {` to `it.runIf(false)('n', () => {` When the check runs in mode `block` and again in mode `warn` Then each diff gives exactly one TI03 signal at the new-file line of the added line, with severity `block` in mode `block` and `warn` in mode `warn`, and its detail is the "unconditional skip on an existing test" sentence
  - verify: integration
- **AC-5** Given diffs of a modified Python test file `tests/test_user.py` that each add one decorator line alone above an unchanged `def test_x():` (the hunk adds no line that opens a test): `@pytest.mark.skip(reason="flaky")`, `@pytest.mark.skip`, `@unittest.skip("broken")`, `@pytest.mark.xfail` and `@pytest.mark.xfail(reason="known bug")`, and the same diff for a decorator added above an unchanged `class TestUser:` When the check runs in mode `block` Then each gives exactly one TI03 signal of severity `block` at the decorator's new-file line whose detail is the "unconditional skip on an existing test" sentence
  - verify: integration
- **AC-6** Given diffs of modified test files that add the conditional skips `test.skip(isMobile, "not on mobile")` and `test.skip(({ browserName }) => browserName === "firefox", "flaky on firefox")` in `e2e/login.spec.ts`, `it.skipIf(process.env.CI)('n', () => {` and `it.runIf(hasDocker)('n', () => {` in place of a removed `it('n', () => {`, and in `tests/test_io.py` the decorators `@pytest.mark.skipif(sys.platform == "win32", reason="posix only")`, `@unittest.skipIf(IS_CI, "slow")`, `@unittest.skipUnless(shutil.which("docker"), "needs docker")` and `@pytest.mark.xfail(sys.version_info < (3, 11), reason="old python")` each alone above an unchanged `def test_x():` When the check runs in mode `block` Then each gives exactly one TI03 signal of severity `warn`, and its detail is the "conditional skip" sentence
  - verify: integration
- **AC-7** Given diffs of modified test files that add in-body skips: `pytest.skip("no docker")` added with the line `if not shutil.which("docker"):` above it in `tests/test_io.py`, `t.Skip("needs network")` added with `if testing.Short() {` in `pkg/net_test.go`, `t.Skipf("no %s", name)` and `t.SkipNow()` in `pkg/net_test.go`, and `test.skip()`, `test.skip(true)` and `this.skip()` in `src/user.test.ts` When the check runs in mode `block` Then each skip line gives exactly one TI03 signal of severity `warn`, the added `if` lines give none, and its detail is the "skip the diff cannot place" sentence
  - verify: integration
- **AC-8** Given diffs that add `@pytest.mark.xfail(reason="bug 12")` followed in the same hunk by an added `def test_new():`, add `it.skip('brand new', () => {` to a modified `src/user.test.ts` with no removed line naming `brand new`, and add a new test file (status added) `src/new.test.ts` holding `it.skip('a', () => {` and `test.skip(isMobile, "x")` and a new `tests/test_new.py` holding `@pytest.mark.skip(reason="wip")` above `def test_a():` When the check runs in mode `block` Then every skip line gives one TI03 signal of severity `warn`, and each detail is the "skip in a test the change adds" sentence
  - verify: integration
- **AC-9** Given diffs of test files that edit `it.fails('n', () => {` to `it.fails('n', async () => {`, move `it.skip('n', () => {` to another line of the same file, move `@pytest.mark.skip(reason="x")` and `t.Skip("x")` within their files, edit `it.skip('n', () => {` to `xit('n', () => {`, add `it.skipIf(false)('n', () => {` and `it.runIf(true)('n', () => {` in place of a removed `it('n', () => {`, add `test.fixme('n', () => {`, add the comment lines `// it.skip('x')` and `# @pytest.mark.skip`, add the string line `"it.skip('x')",`, and add `test.skip(isMobile, "x")` to the non-test file `src/util.ts` When the check runs in mode `block` Then none of them gives a TI03 signal
  - verify: integration
- **AC-10** Given the signals produced for AC-1, AC-4, AC-6, AC-7 and AC-8 When their details are compared Then every TI03 signal of one category has the same detail, the four TI03 categories have four different details, every detail is at most 300 characters, and no detail or message text holds a test name, a skip reason or other text from an added or removed line of the fixtures
  - verify: integration
- **AC-11** Given one diff that turns an existing `it('creates a user', () => {` into `it.skip('creates a user', () => {`, adds `it.only('a', () => {` to the same file, and adds `test.skip(isMobile, "x")` to another test file, and a second diff holding only the conditional skip When the check runs in mode `block`, in mode `warn` and in mode `off` Then in `block` the first diff's signals are sorted by id, then path, then line, then detail, `testIntegrity.verdict` is `fail`, and the messages hold one `TEST_INTEGRITY_TI03` and one `TEST_INTEGRITY_TI04` message, both with level `error`; in `warn` every signal is `warn`, the verdict is `warn` and both message levels are `warn`; in `off` there is no TI03 or TI04 signal or message and `testIntegrity.verdict` is `pass`; and the second diff in mode `block` gives one `warn` TI03 signal, verdict `warn` and a `TEST_INTEGRITY_TI03` message with level `warn`
  - verify: integration
- **AC-12** Given a report with TI03 signals of severity block and warn and a TI04 signal, the same diff read once as one text and once through the streaming reader in chunks of 7 characters, and the CLI run with `--format json` on a diff that adds `it.skip` to an existing test When the PR comment is rendered and the reports are compared Then the "Test integrity" section lists each signal with the id in bold, `path:line` in a code span and the detail, with an indented "Hint:" line, the TI03 hint says a reviewer decision is needed for a skipped test such as one that fails in CI and that the accept label will record it without holding `pharn/accepted` or `accept-label`, the hints for `TEST_INTEGRITY_TI03` and `TEST_INTEGRITY_TI04` exist in the Messages section, the text and streaming reports have equal `testIntegrity` blocks and message lists, the CLI JSON holds the TI03 signal, and every report validates against `schema/report.v2.json`
  - verify: integration
- **AC-13** Given the existing tests, the `fixtures/golden` outputs and the fixtures under `fixtures/test-integrity/TI01`, `TI11` and `TI14` When the whole suite runs with this increment Then every existing assertion passes unchanged, except tests whose diffs add skip or `.only` lines to test files, which may pass `testIntegrityMode` `off` with the reason recorded, and the TI01, TI11 and TI14 signals and messages for their fixtures are identical to before
  - verify: integration
- **AC-14** Given the repository files When the schema, CHANGELOG, README, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the new fixture directories are read Then `schema/report.v2.json` names `TEST_INTEGRITY_TI03` and `TEST_INTEGRITY_TI04` in its message-code description, `schema/report.v1.json` is byte-identical to the base commit, the CHANGELOG Unreleased section mentions TI03 and TI04, the README names both signals with their message codes, `docs/LIMITS.md` has sections "What TI03 misses" and "What TI04 misses" naming the missing context lines, the forms recognised only at the start of a line, `test.fixme` and the other unnamed runner words, the Go receivers other than `t`, a skip moved to another file, Python and Go for TI04 and the kept-text caps, `docs/THREAT-MODEL.md` covers TI03 and TI04 reading the kept text of test files with fixed-sentence details, and `fixtures/test-integrity/TI03/` and `fixtures/test-integrity/TI04/` each hold at least five diffs that must give a signal of that id and five that must give none, the TI03 ones including every must-not-block case of `docs/PRECISION.md` §1 as a diff whose TI03 signals are all `warn` or absent
  - verify: unit

## Constraints

- The core package stays pure: no file, process, network, clock or random access in `packages/core/src`.
- Report v2 stays additive to v1: no field or message code is removed, renamed or retyped, and `schema/report.v1.json` is not changed.
- Matching runs in linear time on a kept line (cut to 400 characters by the diff reader); a test name used for matching is at most 120 characters; no text is kept beyond what the diff reader already keeps for test files.
- No file content, diff text, test name, skip reason or command leaves the report: a finding holds the path, a line number and a fixed sentence of at most 300 characters.
- No new dependency, action input, CLI flag or setting; the mode precedence of the earlier increments is unchanged; the CLI and action dist is rebuilt.
- Existing tests are not weakened, skipped or deleted; goldens change only where the output intentionally changes.

## Assumptions

- The mode rules of the earlier increments apply as they are: in mode `block` a block-class signal has severity `block`, in mode `warn` it is shown as `warn`, a signal that is warn by design stays `warn` in every mode but `off`, and `off` computes nothing.
- The message level for an id is `error` if any of its signals is `block`, `warn` if any is `warn`, else `info`, as for TI01, TI11 and TI14.
- A file is judged by its new path: it is a test file by the existing test-file detection; JS/TS means an extension of js, jsx, ts, tsx, mjs or cjs, Python means `.py`, and Go means a name ending `_test.go`.
- Every TI03 and TI04 form is recognised only at the start of the line after leading whitespace, so comments, string lines and one-line `if (…) this.skip()` forms never fire; the last is a documented miss.
- The test name of a line is its first string or template literal argument, else the argument text up to the first comma, cut to 120 characters; names are compared by their content, so a change of quote style keeps the name.
- A TI03 category is chosen in this order: a pre-existing skip gives nothing; a skip in a file the diff adds is "in a test the change adds"; a conditional skip is "conditional"; an in-body skip (`pytest.skip(`, `t.Skip` and family, `test.skip()` or `test.skip(true)` with no other argument, `this.skip()`) is "cannot place"; a named skip with no removed test-opening line of the same name, or a decorator followed in its hunk by an added test opening, is "in a test the change adds"; the rest is block-class.
- A nameless `.skip(` form whose first argument is something other than nothing or `true` is conditional; a chain such as `describe.skip.each(table)` whose first argument is not a string is treated as nameless.
- `it.skipIf(false)` and `it.runIf(true)` with a constant are not skips and give no signal.
- A Python decorator is unconditional when it has no arguments, or its first argument is a string or a keyword argument; `skipif`, `skipIf`, `skipUnless` and an `xfail` whose first argument is anything else are conditional.
- Token normalisation: `xit`, `xtest`, `xdescribe`, `xcontext` and `xspecify` count as the token `skip`, and `fit` and `fdescribe` count as the token `only`, so swapping between the two spellings of one test is pre-existing.
- TI03 is also capped at 20 signals per file, like TI04, so the report stays bounded.
- A file whose kept text was truncated is checked on the lines that were kept; a diff passed to the check already parsed without kept text yields no TI03 or TI04.
- `testIntegrity.languages` stays an empty list, as in the earlier increments, because only line patterns run.
- The TI03 hint describes the accept label as a later sign-off without naming its label or input, because the label ships in backlog item 7; DECISIONS 2026-10-25 names the label and flaky quarantine for the hint, and the quarantine is not mentioned until A6 ships.
- The repository has no end-to-end runner, so every criterion is verified at unit or integration level; the fixtures are plain diffs run through the check, the streaming reader and the CLI.
