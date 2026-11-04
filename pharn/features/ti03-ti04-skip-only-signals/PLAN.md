---
spec_id: ti03-ti04-skip-only-signals
spec_content_hash: 0a2f5453feb9546096db6b24cdd964b89262996dc17fc4f7df715708ba05ecd1
applied_lessons: none
---

## Approach

Add two pure detectors, `detectTI03` and `detectTI04`, beside TI01, TI11 and TI14, and feed them through the path
those already use. No change to the diff reader is needed: `keepSignalFileText` already keeps the added and removed
line text of every test file (by new or old path) on both the text path of `check()` and the streaming path of
`readDiffChunks`, capped at 5000 lines per file and 400 characters per line. A parsed diff without kept text
(`hunks` absent) yields no TI03 or TI04, as for TI11 and TI14.

A shared line parser, `signals/testLines.ts`, reads one kept line (already at most 400 characters) by a hand-written
left-to-right scan, so it runs in linear time with no backtracking regex. It recognises a form only at the start of
the line after leading white space, so comment lines, string lines and `if (…) this.skip()` never match. It returns,
per language:

- **JS/TS** (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`): a *test call*: a head word (`it`, `test`, `describe`,
  `context`, `specify`, the `x`-prefixed `xit`, `xtest`, `xdescribe`, `xcontext`, `xspecify`, or the bare `fit`,
  `fdescribe`), then any `.word` modifiers (so `test.describe.only` and `describe.only.each` are chains), then `(`.
  From it: the normalised *token* (`skip` for `.skip` and every `x` head, `only` for `.only`, `fit` and `fdescribe`,
  else `todo`, `fails`, `skipIf`, `runIf` or none), the first call's first-argument text, and, for `skipIf`/`runIf`,
  the second call's first argument. Also `this.skip(` as an in-body form.
- **Python** (`.py`): a skip decorator (`@pytest.mark.skip`, `@pytest.mark.skipif`, `@pytest.mark.xfail`,
  `@unittest.skip`, `@unittest.skipIf`, `@unittest.skipUnless`) with its first-argument text, or the call
  `pytest.skip(`.
- **Go** (`_test.go`): `t.Skip(`, `t.Skipf(`, `t.SkipNow(`.

The *name* of a line is the content of its first argument when that is a string or template literal (quotes removed,
so a change of quote style keeps the name), else the argument text up to the first comma or closing parenthesis, cut
to 120 characters. Names are compared by content and never copied into a report.

`detectTI04(diff, mode)` reads JS/TS test files only. Every added line whose test call carries the token `only` is a
candidate, unless a removed line of the same file carries `only` with the same name (an edit or a move). Each
candidate is one signal at the added line's new-file number, severity the mode, one fixed detail. At most 20 per
file, on the lowest line numbers.

`detectTI03(diff, mode)` reads test files of the three languages. A skip line is categorised in the SPEC's order:

1. **Pre-existing**: a removed line of the same file has the same token and the same name → nothing.
2. **File added** (`status === "added"`) → "skip in a test the change adds" (warn).
3. **Conditional** → "conditional skip" (warn): a nameless JS `.skip(` whose first argument is neither empty nor
   `true`; `skipIf`/`runIf` with an argument other than the constants `true`/`false`; Python `skipif`, `skipIf`,
   `skipUnless`, and `xfail` whose first argument is neither absent, a string, nor a keyword argument.
4. **In-body** → "skip the diff cannot place" (warn): `pytest.skip(`, `t.Skip(`, `t.Skipf(`, `t.SkipNow(`,
   `test.skip()`/`test.skip(true)` (the nameless form with no other argument), `this.skip()`.
5. **Added test** → "skip in a test the change adds" (warn): a named JS skip with no removed test-opening line of the
   same name in the file; a Python decorator followed, later in the same hunk, by an added line that opens a test
   (`definesTests`, or `class Test…`).
6. Otherwise → "unconditional skip on an existing test", severity the mode (block-class).

Not skips, so no signal: `skipIf(false)`, `runIf(true)`, `test.fixme` and any runner word the SPEC does not name.
`skipIf(true)` and `runIf(false)` are unconditional skips. A chain such as `describe.skip.each(table)` whose first
argument is not a string is nameless. At most 20 TI03 signals per file, on the lowest line numbers.

`check()` concatenates the five detectors and keeps its sort (id, path, line, detail). `buildReport` gains two
entries in `SIGNAL_MESSAGES` (one message per id with findings, level from the highest severity, paths via
`pathList`); the renderer gains a message hint and a signal hint per id. Mode `off` still computes nothing, and
`testIntegrity.languages` stays empty.

## Applied lessons

- none — this project has no memory-bank yet (the lessons index verdict is NO_CANON), so there is no lesson to cite.

## Steps

- `signals/testLines.ts` (new): the language of a path (`jsts`, `python`, `go` or null, by the new path's extension
  or `_test.go` suffix); `parseJsTestCall(text)`; `parsePythonSkip(text)`; `parseGoSkip(text)`; `argName(argText)`
  (string or template literal content, else text to the first comma, at most 120 characters); `opensPythonTest(text)`.
  Each takes one kept line, trims leading white space, and scans once. Bracket and quote depth are tracked only to
  find the end of the first argument (a string with an escaped quote included); unbalanced text simply ends the
  argument at the end of the line.
- `signals/ti04.ts` (new): `detectTI04(diff, mode)` as in Approach. Detail, one fixed sentence (at most 300
  characters, no test text), for example: "A focused-run marker (`.only`, `fit` or `fdescribe`) was added, so the
  runner may skip the other tests of this file or of the whole run."
- `signals/ti03.ts` (new): `detectTI03(diff, mode)` as in Approach, with four fixed detail sentences, for example:
  - unconditional on an existing test: "An unconditional skip was added to a test that the diff shows existed before
    this change, so that test no longer runs."
  - conditional: "A conditional skip was added; the test is skipped only where its condition holds."
  - cannot place: "A skip was added inside a test body or hook, where the diff cannot tell which test it stops or
    whether a condition guards it."
  - in a test the change adds: "A skip was added to a test that this change adds, so no test that ran before stops
    running."
- `check.ts`: add `...detectTI03(parsedDiff, mode)` and `...detectTI04(parsedDiff, mode)` to the signal list.
- `report.ts`: add `TEST_INTEGRITY_TI03` and `TEST_INTEGRITY_TI04` to `MessageCode`; add their `SIGNAL_MESSAGES`
  entries with fixed texts naming only the paths, for example "This change skips tests or marks them as expected to
  fail: <paths>. Check that each skip was meant." and "This change adds `.only`, `fit` or `fdescribe`, which runs only
  the marked tests: <paths>. Remove the markers before merging."; update the `testIntegritySignals` doc comment.
- `render/markdown.ts`: `MESSAGE_HINTS` and `SIGNAL_HINTS` for both. The TI03 hint says a reviewer decision is needed
  for a skipped test, for example one that fails in CI, and that the accept label will record that sign-off once it
  ships; it names neither the label (`pharn/accepted`) nor its input (`accept-label`), and does not mention flaky
  quarantine. The TI04 hint says to remove the marker so the whole suite runs.
- `index.ts`: export `detectTI03` and `detectTI04`.
- `schema/report.v2.json`: append `TEST_INTEGRITY_TI03` and `TEST_INTEGRITY_TI04` to the "Codes added in v2" part of
  the message-code description, after TI14, outside the "Known codes:" list (which `markdown.test.ts` pins).
- Fixtures under `fixtures/test-integrity/TI03/` and `fixtures/test-integrity/TI04/`, in real
  `git diff --unified=0` shape, named `block-`, `warn-` or `pass-` by the outcome. The TI03 set covers every
  must-not-block case of `docs/PRECISION.md` §1: environment guards with a reason (no camera, no Docker, needs root,
  mobile-only, fixture not downloaded, `REDIS_URL` not set, OpenSSL version, Windows), `xfail` on a new test for a
  known bug, and the `it.fails` sync-to-async edit; the TI04 set covers `solver.fit(` and `def fit(`.
- Docs: CHANGELOG Unreleased entries for TI03 and TI04; README (the `test-integrity` input row names the signals so
  far, and the message-code table gains the two codes); `docs/LIMITS.md` sections "What TI03 misses" and "What TI04
  misses" after "What TI11 misses" (no context lines; forms recognised only at the start of a line, so a one-line
  `if (…) this.skip()` is missed; `test.fixme` and other unnamed runner words; Go receivers other than `t`; a skip
  moved to another file reads as added; TI04 only for JS/TS, not Python or Go; the kept-text caps); section 8 already
  says test files keep text and needs no edit; `docs/THREAT-MODEL.md` item 15: TI03 and TI04 read the kept text of
  test files with linear scans, and details are fixed sentences with no test name, reason or line text.
- Run `pnpm build` so `packages/action/dist/index.js` is rebuilt; `pnpm lint` and `pnpm test`.

## Files

- `packages/core/src/signals/testLines.ts` — the one-line JS/TS, Python and Go test-line parsers (new)
- `packages/core/src/signals/ti03.ts` — the TI03 detector (new)
- `packages/core/src/signals/ti04.ts` — the TI04 detector (new)
- `packages/core/src/check.ts` — adds the two detectors to the signal list
- `packages/core/src/report.ts` — the two message codes and their per-id messages
- `packages/core/src/render/markdown.ts` — message and signal hints for TI03 and TI04
- `packages/core/src/index.ts` — exports
- `schema/report.v2.json` — the message-code description names the two new codes
- `fixtures/test-integrity/TI03/block-it-skip-existing.diff` — `it('creates a user'` to `it.skip(` with the name kept
- `fixtures/test-integrity/TI03/block-xdescribe-existing.diff` — `describe('s'` to `xdescribe('s'`
- `fixtures/test-integrity/TI03/block-todo-existing.diff` — `test('n', () => {` to `test.todo('n')`
- `fixtures/test-integrity/TI03/block-skipif-true.diff` — `it('n'` to `it.skipIf(true)('n'`
- `fixtures/test-integrity/TI03/block-pytest-decorator.diff` — `@pytest.mark.skip(reason="flaky")` above an unchanged test
- `fixtures/test-integrity/TI03/warn-conditional-mobile.diff` — `test.skip(isMobile, "mobile only")` (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-skipif-camera.diff` — `it.skipIf(!hasCamera)('n'` in place of `it('n'` (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-skipif-docker.diff` — `@pytest.mark.skipif(` no Docker (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-skipif-openssl.diff` — `@pytest.mark.skipif(` OpenSSL version (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-skipunless-windows.diff` — `@unittest.skipUnless(` Windows only (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-pytest-skip-redis.diff` — `pytest.skip("REDIS_URL not set")` under an `if` (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-pytest-skip-fixture.diff` — `pytest.skip(` fixture not downloaded (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-go-skip-root.diff` — `t.Skip("needs root")` under an `if` (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-xfail-new-test.diff` — `@pytest.mark.xfail(reason="known bug")` above an added test (PRECISION §1)
- `fixtures/test-integrity/TI03/warn-skip-new-file.diff` — a new test file holding `it.skip(`
- `fixtures/test-integrity/TI03/pass-fails-async-edit.diff` — `it.fails` sync to async (PRECISION §1)
- `fixtures/test-integrity/TI03/pass-skip-moved.diff` — an `it.skip` moved within its file
- `fixtures/test-integrity/TI03/pass-xit-respelled.diff` — `it.skip('n'` to `xit('n'`
- `fixtures/test-integrity/TI03/pass-skipif-false.diff` — `it.skipIf(false)('n'` in place of `it('n'`
- `fixtures/test-integrity/TI03/pass-fixme.diff` — `test.fixme(` added
- `fixtures/test-integrity/TI03/pass-comment.diff` — commented-out `// it.skip(` and `# @pytest.mark.skip`
- `fixtures/test-integrity/TI03/pass-non-test-file.diff` — `test.skip(isMobile, "x")` in `src/util.ts`
- `fixtures/test-integrity/TI04/block-it-only.diff` — `it.only(` added
- `fixtures/test-integrity/TI04/block-describe-only.diff` — `describe.only(` added
- `fixtures/test-integrity/TI04/block-test-describe-only.diff` — `test.describe.only(` added
- `fixtures/test-integrity/TI04/block-fit.diff` — bare `fit(` added
- `fixtures/test-integrity/TI04/block-fdescribe.diff` — bare `fdescribe(` added
- `fixtures/test-integrity/TI04/block-only-renamed.diff` — `it.only('a'` edited to `it.only('b'`
- `fixtures/test-integrity/TI04/pass-solver-fit.diff` — `solver.fit(x)` in a JS test file (PRECISION §1)
- `fixtures/test-integrity/TI04/pass-python-def-fit.diff` — `def fit(self):` in a Python test file (PRECISION §1)
- `fixtures/test-integrity/TI04/pass-go-fit.diff` — `fit(` in a Go test file
- `fixtures/test-integrity/TI04/pass-only-async-edit.diff` — `it.only` sync to async
- `fixtures/test-integrity/TI04/pass-only-moved.diff` — a `describe.only` moved within its file
- `fixtures/test-integrity/TI04/pass-comment.diff` — a commented-out `// it.only(`
- `fixtures/test-integrity/TI04/pass-non-test-file.diff` — `it.only(` in `src/util.ts`
- `fixtures/test-integrity/TI04/pass-json-fixture.diff` — `it.only(` in `tests/fixtures/data.json`
- `CHANGELOG.md` — Unreleased entries for TI03 and TI04
- `README.md` — names TI03 and TI04 and their message codes
- `docs/LIMITS.md` — "What TI03 misses" and "What TI04 misses"
- `docs/THREAT-MODEL.md` — TI03 and TI04 read the kept text of test files; fixed-sentence details
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `schema/report.v1.json` — unchanged; a test pins it to the base commit
- `packages/core/src/diff/unified.ts` — the reader already keeps test-file text; the diff reader is not changed
- `packages/core/src/signals/signalFiles.ts` — the keep-text selector already selects test files
- `packages/core/src/chunkInputs.ts` — the streaming path already keeps the same files
- `packages/core/src/testFiles.ts` — the test-file detection is reused as it is
- `packages/core/src/testIntegrityMode.ts` — the mode rules of the earlier increment
- `packages/core/src/signals/ti01.ts` — TI01 keeps its rules and texts
- `packages/core/src/signals/ti11.ts` — TI11 keeps its rules and texts
- `packages/core/src/signals/ti14.ts` — TI14 keeps its rules and texts
- `packages/cli/src/main.ts` — no new flag; the reader options are already passed
- `packages/action/src/run.ts` — no new input

## Acceptance mapping

- AC-1 → `parseJsTestCall` reads every `only` chain and bare `fit(`/`fdescribe(`; `detectTI04` gives one block signal
  per added line with the fixed detail.
- AC-2 → start-of-line rule (no `solver.fit`, `const r = fit`, `expect(…)`, comments); JS/TS test files only by
  extension and `isTestFile` (no Python, Go, `src/util.ts`, `.json`).
- AC-3 → pre-existing by token and name across the file's removed lines; per-file cap of 20 on the lowest lines.
- AC-4 → `x` heads normalised to `skip`; `.todo`, `.fails`, `test.describe.skip`, `skipIf(true)`, `runIf(false)`;
  removed test opening with the same name by content → category 6, severity the mode.
- AC-5 → unconditional Python decorators (no args, string, keyword) with no added test opening in the hunk → category
  6; the `class TestUser:` case the same.
- AC-6 → category 3 for nameless conditional `.skip(`, non-constant `skipIf`/`runIf`, `skipif`/`skipIf`/`skipUnless`,
  `xfail(<expr>)`.
- AC-7 → category 4 for `pytest.skip(`, `t.Skip` family, `test.skip()`, `test.skip(true)`, `this.skip()`; the added
  `if` lines match no form.
- AC-8 → category 2 for added files; category 5 for a decorator above an added `def test_` and a named skip with no
  removed opening of that name.
- AC-9 → pre-existing (edit, move, respelling), constant non-skips, `test.fixme` unrecognised, start-of-line rule for
  comments and strings, non-test file.
- AC-10 → four fixed TI03 sentences and one TI04 sentence, none holding line text; message texts hold paths only.
- AC-11 → `check()` sort; `SIGNAL_MESSAGES` levels from the highest severity; mode `warn` turns category 6 and TI04 to
  warn; mode `off` computes nothing.
- AC-12 → `SIGNAL_HINTS`/`MESSAGE_HINTS`; the existing renderer line shape; the unchanged streaming reader keeps the
  same text; CLI JSON; schema v2 validation.
- AC-13 → no existing fixture or test diff adds a skip or `.only` line to a test file (checked in discovery), so no
  existing assertion changes; TI01, TI11, TI14 untouched.
- AC-14 → schema description, CHANGELOG, README, LIMITS sections, THREAT-MODEL item, fixture sets above (TI03: 5
  block, 10 warn, 7 pass; TI04: 6 block, 8 pass).

## Risks & open questions

- The name of a chain whose first argument is not a string (`describe.only.each([1, 2])('e %s', …)`) is the text to
  the first comma (`[1`); this is deterministic on both sides of an edit, but two different `.each` tables that start
  alike read as the same name. Documented as a limit only if a fixture shows it matters.
- "Followed in its hunk by an added test opening" is read as any later added line of the same hunk that opens a test;
  a decorator added above an unchanged test in a hunk that also adds an unrelated test below would read as "adds"
  (warn). Stated in LIMITS as part of "no context lines".
- AC-13 relies on discovery: no existing fixture or inline test diff adds a skip or `.only` line to a test file. If
  the build finds one, it passes `testIntegrityMode` `off` there with the reason recorded in BUILD.md, as the SPEC
  allows, and changes nothing else.
- Fixture count and names are advisory; the build may add or rename fixtures within the two directories only by
  changing this list first.
