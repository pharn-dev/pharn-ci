# pharn-ci — Limits

What pharn-ci does **not** guarantee, stated plainly. pharn-ci is pre-1.0 (latest release: `v0.9.0`).
These are the design's inherent limits and the known gaps in what is built. For the security design
see [`THREAT-MODEL.md`](./THREAT-MODEL.md).

## 1. What diff coverage measures

- **Coverage is not test quality.** A covered line was executed by some test; nothing says a test
  asserted anything about it. A suite that runs code without checking results scores 100%.
- **Only added lines count.** Removed lines and unchanged context are not measured (a moved line
  counts as added at its new position). A change that deletes the tests for code it leaves in place
  does not lower diff coverage. pharn-ci names a deleted test file, or one renamed to a name that is
  not a test file, in `TEST_FILES_DELETED` (info only; the verdict is unchanged), and reports the
  ones whose removed lines define tests as TI01 (see "What TI01 misses" below). A test file is
  recognized only by name: `.test.` or `.spec.` with a JavaScript or TypeScript extension (`.js`, `.jsx`, `.ts`,
  `.tsx`, `.mjs`, `.cjs`, `.mts` or `.cts`), `.e2e.ts`, `.pw.ts`, `test_*.py`, `*_test.py`, `*_test.go`, or any file in a
  `test`, `tests` or `__tests__` directory. An added skip or focus marker in a test file is TI03 or TI04. A test case deleted from a file that stays is
  TI02, an emptied test body or fewer assertions TI05, and a weakened assertion TI06 (see "What TI02 misses", "What
  TI05 misses" and "What TI06 misses" below).
- **What TI01 misses.** TI01 reads line patterns, not syntax. (1) A test file counts only if its
  removed lines start with `it(`, `test(`, `describe(`, `context(`, `specify(`, `def test_` or
  `func Test`; a test written another way (a custom wrapper, a `Deno.test(` call) reads as not
  defining tests. (2) A source file of the same name deleted anywhere in the change makes the
  finding `info`, so an unrelated `foo.ts` deleted beside `foo.test.ts` exempts it. (3) A rename
  shows only the lines it edits, never the tests the file keeps, so a test renamed to a path that is
  not a test file counts on its path alone, edited or not, and a helper renamed out of `tests/`
  counts too. (4) A test file emptied but not deleted is not TI01; TI02 reports
  the tests it removed. (5) Text is kept for at most 5000 lines per file and 400 characters per
  line; a deleted JS/TS, Python or Go file cut at that bound with no test-defining line kept still
  counts, so a huge test file is never waved through, while a cut fixture, snapshot or data file
  under a test directory does not. (6) A package that is the repository root never exempts a deletion.
  (7) A snapshot file (a basename that ends in `.snap`) is never a TI01 candidate, deleted or renamed away, because it
  holds stored output and no test; the `TEST_FILES_DELETED` message and `deletedTestFiles` still list it by its old
  path, and TI08 owns snapshot churn. A test file that stores tests in a `.snap` file is not read. (8) A deleted JS/TS or
  Python test file is `info`, not `block`, when the change keeps the base text of the file, every test name and every
  group name it held is added, in a test with at least one assertion, in another test file of the change (a test of an
  added file, or a test of a modified file whose full name is not at base), and every test it held is found again in a
  distinct one of those tests by its body: a body-token Jaccard of at least 4/5, or a new body that holds at least 4/5
  of the old body's distinct tokens and every assertion chain it held. A name alone never qualifies, so a file deleted
  and re-added under the same names with trivial assertions blocks; the moved tests are also judged by TI05, TI06 and
  TI07 as pairs. A test moved and refactored past those thresholds (a new fixture helper, say) keeps the file a
  `block`: a known false block, cleared with the accept label. A name added in a file the change does not touch does
  not count. The rule is off when the sources are missing, the base text was dropped, a compared file could not be
  read, or the Python interpreter was not found. A file with a same-name test file added has no name requirement, see
  (9). (9) A deleted test file for which the change adds a test file of the same name (the same stem, in another
  directory), or renames a file to one, is `info` only on body evidence, as in (8) and with no name check: every test it
  held must be found again, by body, in a distinct new test with an assertion (a Jaccard of at least 4/5, or a body that
  holds at least 4/5 of the old body's distinct tokens and every assertion chain it held). A test file of the same name
  alone softens nothing. Otherwise the file stays a `block` (`warn` in mode `warn`), and it blocks too when no sources
  are given or the text could not be compared, so a diff-only run never softens it. A test file renamed to a path that
  is not a test file is never softened by a same-name file. The tests found again are judged as pairs by TI05, TI06 and
  TI07. A replacement whose tests were rewritten past those thresholds is a known false block, cleared with the accept
  label. (10) TI01 does not read the test runner's include or exclude settings, so deleting a test file the runner
  never ran (a sample app's own test inside a `fixtures/` directory the vitest config excludes, say) still blocks: a
  known false block seen on the precision corpus ([PRECISION.md](./PRECISION.md#official-results-v030-2026-10-26)),
  cleared with the accept label.
- **Only lines the coverage report knows count.** An added line with no `DA` entry in the lcov file
  or no class-level `<line>` record in a Cobertura file (a comment, a type, a blank line, a
  declaration the tool does not instrument) is left out of the denominator. What is "coverable" is
  decided by your coverage tool, not by pharn-ci.
- **Files missing from the coverage report are invisible.** A new source file that no test imports
  is often absent from the coverage report entirely, so it adds nothing to the denominator instead
  of counting as 0%. Configure your coverage tool to include all source files (for example vitest's
  `coverage.include` or `all`) if you want untested files to count.
- **Deleted and binary files are skipped.** Renamed files are measured under their new path; a
  pure rename adds no lines. Rename detection is git's default similarity (`--find-renames`).
- **No coverable changes passes.** When none of the added lines are tracked by the coverage report,
  the verdict is `pass` with `NO_COVERABLE_CHANGES`, even with a threshold of 100. This holds only
  when the coverage report's paths match tracked files; a report whose paths match none is
  `COVERAGE_PATHS_UNMATCHED` instead (section 7).
- **Exclusions apply to changed files only.** Patterns from `coverage.exclude`, `--exclude` and the
  Action's `exclude` input (merged, never overriding each other) remove matching changed files from
  every count and from the table. They are listed in `diffCoverage.excludedFiles` and in the
  comment's "Excluded" summary; a deleted file is never listed. The agent setup inventory and
  `COVERAGE_FILE_EMPTY` are unaffected, and a change whose every file is excluded is the
  `NO_COVERABLE_CHANGES` pass.
- **The glob subset is small.** `*`, `**` as a whole segment and `?`, anchored at the repository
  root, matching the whole path, case-sensitively. Not supported, and rejected with an error rather
  than matched literally: braces, `[...]` classes, negation (`!`), backslashes, unanchored
  gitignore-style patterns (`foo/` or `*.ts` matching in subdirectories: use `**/*.ts`), `..`
  segments, and case-insensitive matching.
- **Coverage paths must be relative to the repository root.** `SF:` paths are matched exactly
  (case-sensitive) against repo-relative diff paths. Absolute paths under the repo root are
  relativized. In a monorepo, a coverage file whose paths are relative to a package directory
  matches nothing unless a coverage root is set. The same holds for Cobertura `filename` values:
  they are joined to the report's `<source>` entries, and a report made inside a package directory
  yields paths relative to that package, which match nothing unless a coverage root is set.
  Section 7 describes the check that reports this and the setting that fixes it. A relative
  `filename` that starts with `..`
  (after normalization) is joined only to the first 16 distinct `<source>` entries; past them it
  is used as written. Other filenames are joined to every source.
- **Percentages are rounded to two decimals, but the threshold is compared exactly.** 15,999 of
  20,000 lines (79.995%) fails a threshold of 80. When rounding up would show a failing coverage as
  reaching the threshold, it is rounded down instead (79.99%), so the number shown agrees with the
  verdict. 100% and 0% are reserved for exactly all and exactly none covered.
- **Threshold 0 gates no percentage.** Any measured coverage meets it, and the report says so with
  `DIFF_COVERAGE_UNGATED`, as it does without a threshold. Unlike no threshold, it still makes a
  missing coverage file or diff an error (below).

### What TI14 misses

TI14 reads the added and removed lines of the pharn-ci config in use, one line at a time. The local diff is
`--unified=0`, so there are no context lines.

- **No context lines.** A bare `- item` line added to a list cannot be tied to its key. It counts as an exclusion
  only when it follows an added `exclude:` key line in the same hunk, or when its value is one of the exclusion
  patterns the check was given (so a pattern also given by the workflow input can make an item added to
  `coverage.file` read as an exclusion, and an exclusion appended to a list is missed when the check was not given
  it).
- **Threshold by line.** Only a plain decimal number on a `threshold:` line counts, read as the config reads it:
  the key and the value may be quoted, a double-quoted value is decoded (`"\u0037\u0030"` is 70), and any number of
  decimals is read. A value moved onto another key, and a threshold set by the workflow input (which the config can
  only raise, and which is out of the diff's reach) are not seen. A config renamed with no edits shows no lines. A removed threshold
  whose replacement the line cannot be read as a plain number (an empty value, a value padded past the 400-character
  kept-line cap) is a finding too: TI14 fails closed rather than guess what the config read.
- **One comment rule.** TI14 and the config reader end a value at the same `#`: one that starts the line or follows a
  space or a tab, as YAML says. A `#` after any other Unicode space (U+00A0, U+3000, U+FEFF, ...) is not a comment
  to YAML, and the config refuses it with an error naming the character, so `threshold: 50<U+00A0># lowered` can no
  longer set a gate TI14 does not see.
- **Any new pattern counts.** An exclusion that swaps one generated directory for another is reported like one that
  hides source; the finding is a prompt for a reviewer, and the exclusion's pattern is not judged.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8). A diff that reaches
  `check()` already parsed without kept text (not through `readDiffChunks` or a diff text) yields no TI14.

### What TI11 misses

TI11 reads the added and removed lines of workflow files (`.github/workflows/*.yml` and `*.yaml`) the same way.

- **No context lines.** An added `continue-on-error: true`, `if:` or `timeout-minutes` line cannot be tied to a test
  step or to the job it sits in, which is why those rules are `warn` in every mode but `off`. An `if:` other than a
  literal false or an event-name test, a job-level condition written another way and a timeout of 2 minutes are not
  seen.
- **Test commands by name.** A removed command counts only if it is a package-manager test script (`npm test`,
  `npm t`, `pnpm -r test`, `pnpm --filter core test`, `yarn test:unit`, ...), `vitest`, `jest`, `mocha` or
  `playwright test` (directly or through `npx`, `pnpm`, `pnpm exec`, `yarn`, `bunx` or `bun x`), `node --test`,
  `bun test`, `deno test`, `pytest`, `python -m pytest`, `python -m unittest`, `tox` or `nox` (directly or through
  `uv`, `poetry`, `pipenv`, `pdm`, `hatch` or `rye run`) or `go test`, alone or in a `&&`/`;` chain. A script run
  another way (`make check`, a shell script, a task runner such as `turbo run test` or `nx test`) is not seen.
- **Moved steps.** A test command removed from one place and added anywhere in the workflow files of the same diff
  counts as moved, even into a job that never runs on pull requests. A test job moved into a reusable workflow
  or a composite action is a removal of its steps; the called workflow is not read.
- **Commands compared by key.** Each test part of a `&&`/`;` chain gets a key, and a removed line is a loss when one of
  its parts has a key that no added line of the diff has. A package-manager script run keys on the script with its
  workspace flags and arguments (`npm run test`, `npm t`, `yarn test` and `pnpm test` are one key, `bun run test` too;
  `pnpm --filter core test` and `pnpm test src/a` are different keys), and a runner keys on its command without the
  launcher (`npx vitest run`, `pnpm exec vitest run` and `vitest run` are one key). A swap of package manager
  therefore passes, and a narrowed run is still a removal. Bare `bun test` starts bun's own runner, not a script, so it
  keeps its text as its key.
- **A test job moved to another workflow file still blocks.** Other workflows are not read: a test command that an
  unchanged line of another workflow runs is not seen (the diff holds no such line), so a job whose tests moved to
  another workflow file, and now run there under another script (`test:lambda` replaced by `test:adapters`), is a
  removal and a `block`, even when the same change removes the old script from `package.json` and renames the test
  files. That is a known false block (one PR in the 600 of the precision corpus). It is kept on purpose: removing the
  job, removing its script and renaming a test file are exactly what a change that stops CI from running its tests
  would do, and nothing the pull request carries may loosen this block. Use the [accept label](../README.md#accept-label)
  for a real move.
- **Triggers by token.** A removed `pull_request` or `pull_request_target` is excused when any added line of the same
  file names either. The `on` key may be quoted (`"on":`). Other filters (`branches`, `paths`) are not judged, and a
  workflow that drops its `pull_request` trigger is a block even when it never ran tests (a release or labeler
  workflow).
- **Matrix by one-line list.** Only a flow list (`[18, 20, 22]`) that shrinks on the same key counts; a block list
  loses no entry here, and `branches`, `paths`, `types` and `runs-on` lists are not read as matrices.
- **Needs policy.** A required-check job renamed and a `paths-ignore` widened over source need the list of required
  checks and the source paths from the app policy; they land with the policy work (E5), not here.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8).

### What TI02 misses

TI02 compares the tests of each JavaScript, TypeScript and Python test file the change modifies at the merge base and at
`HEAD`, from their text, with the test index. It reports a base test with no counterpart left. It is not a judge of
whether a test is still good.

- **A test replaced by a trivial one with the same name.** A test is matched by its full name first, so a test whose
  body is swapped for a trivial one under the same name is not removed as far as TI02 goes. TI05 sees the case where the
  assertions go; a trivial body that still has an assertion, or a weak one, is not seen by either.
- **A deleted test matched by a common leaf name in another touched file.** A test that leaves one file and a test with
  the same leaf name (the last name in its path, as in `works`) that another touched test file gains are taken for a
  move only when the same-name test holds the body: a body-token Jaccard of at least 4/5, or a body that holds at least
  4/5 of the removed body's distinct tokens and every assertion chain it held (body evidence; the first 256 same-name
  tests are tried). A hollow or assertion-less test of the same leaf name clears nothing. A deletion hidden behind a
  same-name test that keeps most of the body is still missed, and so is a deleted test whose body hash matches any new
  test in a touched file. The file has to be touched by the change; a test moved to a file the change does not touch is
  reported.
- **A body that is close enough.** A removed test whose body has a token-set Jaccard of at least 4/5 with a new test of
  the same file is taken for a rename. A rename that also weakens the body slightly passes.
- **A test renamed in place.** Per file and group (the exact names of the enclosing blocks), when as many tests are
  left unmatched as new tests are unused, the i-th of each in line order is a rename in place (a pair, so TI05, TI06 and
  TI07 judge it) when the body tokens have a Jaccard of at least 1/2 and the new body holds at least 3/4 of the old
  body's distinct tokens. A test replaced in the same slot by a different test with mostly shared setup is a pair too, and
  its changed assertion is TI06's, not TI02's. Groups with more or fewer new tests than removed ones are not paired by
  slot.
- **An `.each` table replacing hand-written tests.** A removed test with at least one assertion is cleared by the first
  of the first 256 unpaired new `.each` tests of its file and group (line order) that shares a subject (the function
  called first inside `expect(`, or right after a Python `assert`) and holds every assertion chain the removed test
  held. The `.each` test is listed once under renamed in `testIntegrity.changes`, and the table's rows are not compared,
  so a table that lost a case the hand-written test had passes. One `.each` test may clear several tests.
- **A test moved to another touched file under a new name.** A removed test that nothing in its own file or by exact leaf
  name or body hash matched takes the first unused new test of another touched file (head path, then line) whose body
  tokens have a Jaccard of at least 4/5; else the first whose full-name words have a Jaccard of at least 1/2, whose body
  contains at least 4/5 of the removed test's distinct tokens and which holds every assertion chain it held. A name-only
  move across files therefore needs body containment, and a test moved to a file the change does not touch is reported.
- **A suite rewritten under reworded names: a known false block.** No rule clears or softens a removed test by its name
  alone, because a name is what a change controls most easily: a real test deleted beside a hollow new test with a
  similar name stays a `block`. So a suite rewritten in one describe, whose tests get reworded names and bodies that
  share less than the rename-in-place or cross-file thresholds above, blocks even when nothing was lost (the corpus dry
  run had one such PR). A person who confirms the rewrite clears it with the accept label. Every probe looks at no more
  than 256 candidates.
- **Names read from the text.** A test whose name is computed (a template literal with a substitution, `.each`, `.for`
  or any other expression) is matched by body only and reported as `warn`; two tests with the same full name are
  compared as a multiset, in line order.
- **Go test files** (`_test.go`) are not read, and neither is any other language: only `.ts`, `.tsx`, `.mts`, `.cts`,
  `.js`, `.jsx`, `.mjs`, `.cjs` and `.py` files. A deleted or renamed-away file is TI01's, not TI02's.
- **No run, no resolution.** The tests are parsed, never run, and a test the framework generates (a loop that calls
  `it`, a parametrized Python test) is one block or none. A syntax-error-heavy, oversized or deeply nested file is not
  compared (`TEST_INTEGRITY_INDEX_UNAVAILABLE`). An added test file the index refuses (or that has no text at HEAD,
  or no Python index) holds no test any signal reads: a test cannot be found to have moved into it, and its own
  tests are not checked. The same message names it in a sentence of its own, as a warning in every mode.
- **Caps.** At most 20 findings per file; the matching probes at most 256 candidates per test (section 8).
- **Order of the rules.** Name pairs and phase 1 (4/5), then the rename in place, the `.each` replacement, the exact
  cross-file body hash or leaf name with a body that holds the old one (body evidence) and, last, the cross-file
  similarity. Every threshold is an integer comparison.

### What TI03 misses

TI03 reads the added and removed lines of test files, one line at a time, in JS/TS, Python and Go. The local diff is
`--unified=0`, so there are no context lines. When the test index compared a JS/TS or Python test file at the merge
base and at HEAD, TI03 also reads the test pairs the base-to-head match finds (the pairs TI05 reads, moves and
replacements included): a test that is skipped at head, by its own modifiers or by a `describe`, a test class or a
`pytestmark` whose lines hold it, and was not skipped at base is an existing-test skip, whatever its name became.
Both readings give one finding per line, the stronger one kept.

- **Without the test index, line by line.** When the index cannot run for a file (no test sources, a side that cannot
  be read, a file the index refuses, no Python 3.8 or newer), only the line reading runs, as before: a test renamed to
  a skipped name or wrapped in an added `describe.skip` reads as a skip in a test no removed line opens (`warn`), and
  a test moved into an existing skipped `describe` gives nothing. Go has no test index, so Go is always read line by
  line.
- **No context lines.** A skip is judged from its own line and the lines the diff shows next to it. A Python decorator
  is judged by the added lines directly below it: a `def` or `class` there is a test the change adds (`warn`) unless a
  removed line of the same hunk opened a test of the same name (an edited `def` line); nothing added directly below it
  means it sits on a test the diff does not show, a test that existed. A skip inside a JS/TS or Go test body, or a
  Python one when the Python index did not run, cannot be tied to the test it stops or to the `if` that guards it, so
  it is `warn`. When the Python index ran, an unguarded in-body `pytest.skip()`, `pytest.xfail()` or `self.skipTest()`
  added to a test that exists at base is an existing-test skip and blocks (a deliberate change: it warned before); a
  guarded one stays a conditional `warn`.
- **`pytestmark`.** A `pytestmark = …` assignment at module level, or directly in a test class, is read as a skip of
  every test it covers: one mark, or the first element of a list or tuple on the same line (the Python index reads the
  whole list). A `pytestmark` set in `conftest.py`, through an assignment chain (`m = pytest.mark.skip` then
  `pytestmark = m`) or with `request.node.add_marker` is not read, and the line reading reads a multi-line list from
  its first line only. The line reading counts an added `pytestmark` skip in a file the change modifies as an
  existing-test skip whatever its indentation, so a class-level one added together with a new class blocks too.
- **What the pair reading trusts.** Python skips come from the Python index's decorator table, which also counts a
  bare `@skip`, `@skipIf`, `@expectedFailure` or `@mark.skip` whatever module binds the name. JS/TS constants are read
  only as `skipIf(true)`, `skipIf(false)`, `runIf(true)` and `runIf(false)` on the block's opening line; a Python
  `skipif(True)` stays conditional. A `describe` is matched to its tests by line range, so two sibling `describe`
  blocks opened on one line read as holding each other's tests.
- **Forms at the start of a line.** A form is recognised only at the start of a line after white space, so a one-line
  `if (slow) this.skip()`, a skip written after another statement on the same line and a skip built through a helper
  are missed. A call wrapped over lines is read from its first line only: `it` alone with `.skip(...)` on the next line
  is missed, and `it.skip(` with the name on the next line reads as a skip inside a body (`warn`). Comments and strings are never read as skips.
- **Runner words that are not named.** `test.fixme`, `test.fail` and any other runner word that stops a test but is not
  one of the forms above are not seen. `skipIf` and `runIf` are judged by their literal argument only: a
  condition that is always true under another spelling reads as conditional.
- **Go receivers other than `t`.** Only `t.Skip(`, `t.Skipf(` and `t.SkipNow(` are read; a receiver named `tb`, `b` or
  anything else is missed.
- **Python aliases from top-level imports only.** A Python skip is also read through the names the test file binds with
  its own `import` and `from … import` statements that start at column 0 (`import pytest as pt`, `from pytest import mark
  as m`, `from unittest import skipIf as si`, the parenthesized multi-line form included), so `@pt.mark.skip`,
  `@m.skipif(…)`, `@si(…)` and `sk("r")` are read as the `pytest.mark.skip`, `pytest.mark.skipif`, `unittest.skipIf` and
  `pytest.skip` they name. An alias bound anywhere else is not read: inside an `if`, a `try` or a function, in a
  module docstring, by `from pytest import *`, by an assignment (`pt = pytest`) or after a backslash continuation. A
  name bound twice keeps its last binding, and `import os as pt` after `import pytest as pt` hides the pytest one.
  The text read is the test file's own text in the test sources; `conftest.py` is not followed, and without the text
  (no test sources, or a side that cannot be read) only the literal spellings are read. The literal spelling is always
  tried first, so `@pytest.mark.skip` under `import foo as pytest` still counts; a binding the reader gets wrong can
  only add a match, never take one away.
- **Python forms.** `@unittest.expectedFailure` (and its aliases) is an unconditional skip like `@unittest.skip`, and
  `pytest.xfail(` in a body is read like `pytest.skip(`: a skip inside a body, `warn` unless the Python index ran
  (see "No context lines" above). A skip written through
  `request.node.add_marker(pytest.mark.skip)`, `pytest.mark.skip` assigned to a name and used as `@name`, or a marker
  set in `conftest.py` is not read.
- **A skip moved to another file** reads as added without the test index, because the removed line is looked for in
  the same file only. A rename that edits the skip is judged against the old file's lines. With the index, a test the
  match finds again in another file is judged by its pair.
- **Names by content.** A test is matched by the text of its first argument, so two tests with the same name in a file
  are one, and a name built from an expression (`describe.skip.each(table)`) is compared by that text. A nameless
  `.skip(cond)` is read as conditional.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file, one per line, the unconditional skips of existing tests first, so warn findings never push a block
  finding out. A diff that reaches `check()` already parsed without kept text yields no line reading.

### What TI04 misses

TI04 reads the added and removed lines of JS/TS test files the same way.

- **Forms at the start of a line.** `.only` is recognised only on a test call at the start of a line after white space,
  so a marker after another statement on the same line, or in a call built through a helper, is missed. A bare `fit(`
  at the start of a line is read as the Jasmine `fit`; a test helper that happens to be named `fit` and is called at
  the start of a line fires.
- **JS/TS only.** Python (`pytest -k`, `-m`) and Go (`-run`, `t.Parallel` filters) have no marker in the source that this
  reads, so a Python or Go test file never gives TI04. `.only` written in a file that is not a test file, or in a
  JSON fixture, is not read.
- **No context lines.** A marker that was already there is excused when a removed line of the same file has the same
  name, so an `.only` copied from one test to another of the same name is missed.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file.

### What TI05 misses

TI05 compares the assertion count of each test that has the same full name (or a similar body, in the same file) at the
merge base and at `HEAD`, in JavaScript, TypeScript and Python test files the change modifies.

- **A weakening that keeps the number of assertions.** `toBe(5)` becomes `toBeTruthy()`, an expected value is edited, or a
  matcher that always passes is added: the assertion count is the same, so TI05 sees nothing. TI06 reports the weakening
  of a matcher, a lowered guard, a literal tautology and an assertion moved where it may not run (see "What TI06
  misses"); an edited expected value is TI07's (below).
- **Assertions in helpers outside the test body.** An assertion helper that is defined in another file, imported, or
  called from a hook or setup is not part of the test's count. A test that calls a function whose name starts with
  `expect`, `assert`, `check`, `verify`, `should`, `validate` or `ensure` and has no assertion of its own is reported as
  `warn`, not `block`, and the guess is made from the name alone, even inside a string.
- **A test replaced by a trivial one with the same name** that keeps one assertion. Only the count of assertions is
  compared, and a fewer-but-stronger rewrite is excused when the rest of the body changes too.
- **Assertions dropped together with a rewrite.** TI05 reports fewer assertions only when the rest of the body is
  the base's with assertion statements taken out; a change that drops an assertion and edits anything else passes.
- **Skipped, todo and conditional tests** (`skip`, `todo`, `skipIf`, `runIf`) are not checked; TI03 reports skips added.
- **Go test files** and every other language are not read; the Python count is the interpreter's own reading of
  `assert` statements and the unittest assert methods.
- **Caps.** At most 20 findings per file.

### What TI07 misses

TI07 compares each pair of tests that TI05 compares (the same full name, or a similar body in the same file) at the merge
base and at `HEAD`, in JavaScript, TypeScript and Python test files the change modifies. It warns, in both `block` and
`warn`, when the two bodies differ only in literals inside the expected-value arguments of an assertion and the diff also
changes a source file. It never blocks.

- **The expected value changed together with the input.** `expect(total([2, 3])).toBe(5)` becomes
  `expect(total([2, 4])).toBe(6)`: the subject is edited too, so the two bodies differ outside the expected value and
  TI07 stays quiet. A test that gains or loses an assertion in the same change is not judged either.
- **A literal that grows or shrinks in token count.** `5` becomes `5 + 1`, or `[1]` becomes `[1, 2]`: the two bodies no
  longer have the same tokens outside the literals, so nothing is compared.
- **Expected values built from variables.** `const expected = 5` edited at the top of the test, or a constant imported from
  another file, is not inside an assertion's arguments, so a change to it is not seen. Only literals written in the
  arguments count: strings, template literals without a substitution, numbers, regular expressions, `true`, `false`,
  `null` and `undefined` (in Python: strings, numbers, `True`, `False` and `None`; an f-string is not a literal here).
- **Expected values built from helpers.** `toBe(price("five"))` or `toEqual(buildOrder())` hold no literal to compare.
- **Matchers outside the fixed lists.** Only the Jest and Vitest matchers that take an expected value (`toBe`, `toEqual`,
  `toStrictEqual`, `toMatchObject`, `toHaveLength`, `toContain`, `toMatch`, `toBeCloseTo`, `toThrow`, the
  `toHaveBeenCalledWith` family, the `toBeGreaterThan` and `toBeLessThan` families and the others the code lists), chai's
  `equal`, `equals` and `eql`, node:assert's `equal`, `strictEqual`, `deepEqual`, `deepStrictEqual`, `match` and their
  `not` forms, the unittest `assert*Equal`, comparison and `assertRegex` methods, and the operand after `==` in a pytest
  `assert` are read. Snapshot matchers (`toMatchSnapshot`, `toMatchInlineSnapshot`) are not in the lists, so an edited
  snapshot is not caught here (TI08 reads regenerated snapshots).
- **Custom assertion helpers.** `expectTotal(cart, 5)` is a call like any other: its arguments are not expected values to
  TI07, so editing the 5 is not seen.
- **Bodies at or past the 4000-character cut.** A test body is kept to 4000 characters; when either side of a pair is at
  that cut TI07 skips the pair, because the end of the body is not known.
- **Matched pairs only.** A test that was moved to another file or renamed with another body is not judged, and a test
  with no match is TI02's business. TI07 reads the pairs of the same full name, or of a similar body in the same file.
- **A source change anywhere in the diff counts.** The gate is that the diff changes one JavaScript, TypeScript or Python
  file that is not a test file or a test-config file; the file need not be related to the test. A change to the tests
  alone, a deleted source file, or a change to a runner config gives no signal, so an edited expected value in a change
  that touches no source is not reported.
- **Whitespace and comments.** The test index drops comments and collapses whitespace, and the bodies are then compared
  as tokens: a re-indentation or a comment edit together with an edited expected value still gives the signal.
- **Caps.** At most 20 findings per file, with the rest counted in the "Not listed" sentence of the message.

#### Tests-changed summary

Next to the signal, `check()` writes a summary of the tests the touched test files change, to `testIntegrity.changes` in
`report.json`, and to a collapsed "Tests changed" table in the comment. It is present only when at least one test
changed.

- **What counts.** A test is **added** when it is new at head and matches no base test; **removed** when no test at head
  stands for a base test (the candidates TI02 looks at); **modified** when a test of the same full name in the same file
  has another body or other modifiers (`skip`, `only`, `todo` and the like); **renamed** when a base test is matched to a
  test of another name (a rename in place included), moved to another file, or replaced by an `.each` test (listed once
  however many tests it replaced, and not as added). A removed test sits at its base path and line, the others at head.
- **Caps.** The lists hold at most 200 entries in all, filled in the order removed, modified, renamed, added, each sorted
  by path and line; `truncated` says how many were left out, and the totals and the per-file counts still count every
  test. A name is cut to 120 characters, with control characters turned into spaces. The comment shows one row per test
  file, at most 50 rows (`maxRows`), and then the number of files left out; it holds counts and the file path, never a
  test name. The names are in `report.json` only.
- **Not listed.** Tests of a deleted test file are not in the summary, nor is a file that could not be indexed (it gets
  `TEST_INTEGRITY_INDEX_UNAVAILABLE`, not a row), nor a Go or any other language's test file. With no test sources, with
  the mode `off`, or when the comparison did not run, there is no summary.

### What TI06 misses

TI06 compares each test that has the same full name (or a similar body, in the same file) at the merge base and at
`HEAD`, in JavaScript, TypeScript and Python test files the change modifies, and reports a test that became weaker. It
always gives `warn`, never `block`, and it reads the normalized text of the test body, never the type of a value.

- **Semantic weakening that keeps the matcher.** `toEqual(expectedFromOutput)`, a narrower input, a looser regular
  expression in `toMatch` or an expected value edited to agree with the code all keep the same matcher, so TI06 sees
  nothing. Only a change of the matcher class (strong to weak), a lowered guard, a literal tautology and a move into a
  `try` block with a `catch` or after an early `return` are read.
- **A table, not a judgement.** The strong and weak matchers are a fixed list. **Custom matchers** (`expect.extend`,
  `jest-extended`, a library's own), `toSatisfy`, `toBeGreaterThan` and every matcher not in the list are neutral: a
  change to or from them is not reported. A `.not` form is weak only for `toBeNull`, `toBeUndefined`, `toBeTruthy`,
  `toBeFalsy`, `toThrow` and `toThrowError`.
- **Assertions in helpers.** An assertion inside a helper function that the test calls is not part of the test's
  assertions, so a helper that gets weaker is not seen.
- **Chai-style chains** (`expect(x).to.equal(1)`, `expect(x).to.be.ok`, `x.should.equal(1)`) and other assertion
  libraries' spellings are neutral; only the Jest and Vitest `expect` matchers, the `node:assert` functions and the
  Python forms are classified.
- **Arguments past the 4000-character body cut.** `toThrow`, `toThrowError`, `toHaveProperty` and `toBeInstanceOf` need
  their arguments, which TI06 reads from the normalized body, cut to 4000 characters by the test index. An argument
  past the cut is not read, and the assertion counts as neutral. The argument reader skips string literals but does
  not parse regular expression literals or template substitutions.
- **Equivalent forms of one matcher.** A `toBe`, `toEqual` or `toStrictEqual` that stands for another matcher is
  labelled as that matcher, so a rewrite between the two forms is not a weakening: `expect(typeof x).toBe('string')`
  and `toBeTypeOf('string')` (weak); `expect(x instanceof Y).toBe(true)` and `toBeInstanceOf(Y)` (neutral, weak for
  `Object`); `expect(x.length).toBe(n)` and `toHaveLength(n)` (strong); `expect(!!x).toBe(true)` or
  `Boolean(x)` and `toBeTruthy()` (`toBeFalsy()` against `false`); `expect(x !== null).toBe(true)` and
  `not.toBeNull()`; `expect(x !== undefined).toBe(true)` and `toBeDefined()`. A real weakening still warns:
  `expect(x).toBe(5)` → `toBeTypeOf('number')`.
- **Weak to weak.** `expect(typeof x).toBe('function')` → `expect(x).toBeTruthy()` is a weaker check by meaning, but
  `toBeTypeOf` and `toBeTruthy()` are both weak, so TI06 gives nothing.
- **The subject is read by its text, not parsed.** The subject of `expect(…)` is read as its first 64 and last 96
  characters (the head and the tail), one left-to-right pass with a bracket stack that skips string literals, and the
  call must follow the `expect(…)` directly (a space is allowed): `expect(x).resolves.toBe(…)` keeps its strong label.
  Operator precedence is not modelled, so `a || b instanceof B` reads as an instanceof test of `B`. The i-th chain of
  a matcher takes the i-th call of it in the body, so a `.toBe(` outside an `expect` chain can shift the pairing. A
  chain past the 4000-character body cut has no call to read and counts as neutral, as the argument matchers do.
- **A test matched only to a test in another file.** Only name pairs and same-file body pairs are compared. A test
  that leaves one file and reappears weaker in another file is taken for a move (TI02) and TI06 does not compare the
  two.
- **Skipped, todo and conditional tests** (`skip`, `todo`, `skipIf`, `runIf`) at head are not checked; TI03 reports
  skips added.
- **Guards of unknown size.** An `expect.assertions(n)` whose argument is not a numeric literal makes the guard of
  that side unknown, and no guard reason is given. Python tests carry no guard.
- **Tautologies are literal.** Only a number, a string of at most 200 characters, `true`, `false`, `null` or
  `undefined` (`True`, `False`, `None` in Python) compared with the same text counts; `expect(x).toBe(x)` does not.
- **Go test files** and every other language are not read.
- **Caps.** At most 20 findings per file.

### What TI12 misses

TI12 reports a mock that is new at head when its specifier names a source file the same change adds, modifies or
renames, in JavaScript, TypeScript and Python test files. It reads the module specifier as written; it does not run
the resolver of a bundler or of the interpreter.

- **Bare specifiers.** `vi.mock("axios")` and every specifier that does not start with `./` or `../` is not resolved,
  so a package of the repository imported by its name is missed.
- **Alias specifiers.** `@/cart`, `~/cart`, `#cart` and any path alias or `paths` mapping from `tsconfig.json` or the
  runner's config are not resolved.
- **Mocks in setup files.** A mock in a setup file the runner loads, or in a file the diff does not show as a test
  file, is not read, and neither is a mock in a test file that the change does not touch.
- **Non-string targets.** `patch.object(module, "name")`, `mock.patch.object` and every call whose target is not a
  string literal (a variable, a formatted string, a class) are not resolved: the `patch.object` forms are never
  resolved.
- **`monkeypatch.setattr` object forms.** `monkeypatch.setattr(module, "name", value)` is an object form, and TI12
  cannot tell it from the string form with the index it has, so it resolves only when the dotted name happens to match
  a changed path.
- **Mocks moved from a deleted test file.** The mocks of deleted test files are not read. TI12 excuses a mock only when
  the same compared file held it at base or another compared test file lost it, so a mock that moves from a deleted
  test file into a test file reads as new and is reported. Deleted test files are TI01's.
- **Python layout guesses.** A dotted name resolves to `P.py`, `P/__init__.py`, `src/P.py` or `src/P/__init__.py`
  for a module prefix `P`; a package under another source root (`lib/`, `python/`) is not found.
- **A source file with a different spelling.** A specifier with a runtime extension the candidates do not try (`.json`,
  `.vue`) is not resolved.
- **Caps.** At most 20 findings per file.
- **One measured sample.** On the precision corpus TI12 gave one finding, and it was wrong (0 of 1: a mock that follows
  a moved module). One row is too small to judge the signal, so it stays `warn` (see
  [PRECISION.md](./PRECISION.md#official-results-v030-2026-10-26)).

### What TI09 misses

TI09 compares a fixed list of settings of the test-runner config files the change touches (`vitest.config.*`,
`vite.config.*`, `vitest.workspace.*`, `jest.config.*`, the `jest` key of `package.json`, `playwright.config.*`,
`.mocharc.js`, `.mocharc.cjs`, `.mocharc.json`, `.mocharc.yml`, `.mocharc.yaml`, `pytest.ini`, `tox.ini`, `setup.cfg` and
`pyproject.toml`) at the merge base and at `HEAD`. It parses the text and never runs or imports it.

- **Computed configs.** A value that is a call, an environment read, a template with substitutions or a binding that
  is not a top-level `const` is opaque: the setting is compared by its normalized text, and a changed opaque value
  gives at most a `warn` ("cannot be compared"), because TI09 cannot say whether it loosens anything. A config whose
  default export is a call to anything other than `defineConfig`, `defineProject`, `defineWorkspace` or `mergeConfig`
  is not found at all. A modified or renamed config whose settings were read at base and that is not found at head
  (an IIFE or any other opaque wrapper) gives one finding for `(config)` at the mode's level (`block` in mode `block`),
  so a one-line wrapper cannot turn a narrowed setting into a warning; nothing in the head is compared then. An added
  config that is not found, and a config not found or not read at base, give nothing.
- **Shared config packages and imports.** An imported base config, a spread (`...shared`) and a
  `mergeConfig(base, …)` argument that is not an object literal are never resolved, so a setting that lives there is not
  seen. A key that an open object (a spread, a shorthand property, a `mergeConfig` result) may set is `warn` when it
  was set at base and is absent at head.
- **CLI flags in CI workflows.** `vitest run --exclude …`, `pytest -k …` and the like in a workflow or a script are not
  read here; TI10 (the scripts in `package.json`) and TI11 (workflows) cover what they cover.
- **Deleted config files and removed sections.** A deleted file is never read. A removed `jest` key, a removed
  `[pytest]` section or `[tool.pytest.ini_options]` table, and a removed `test` key of a vite config give nothing: the
  runner's defaults apply, and TI09 does not model them. For `pyproject.toml` both the `[tool.pytest]` and the
  `[tool.pytest.ini_options]` table count: a change from a file that has either one to a file that has neither gives
  nothing.
- **pytest's native `[tool.pytest]` table.** `pyproject.toml` is read for pytest 9's native `[tool.pytest]` table
  beside `[tool.pytest.ini_options]`, by the same rules. The headers are matched whole (`[tool.pytestx]`,
  `[tool.pytest.foo]` and `[[tool.pytest]]` are other tables and give nothing), and a quoted or dotted key in a header
  is not read. When a file holds both tables their entries are merged into one, and the native value wins over the
  `ini_options` one of the same key, whatever pytest itself does with a file that has both (TI09 does not model it).
  A table that cannot be read is refused like the other config texts (`too-large`, `invalid-toml`).
- **Playwright per-project settings.** Only the top-level keys are read. `projects[].retries`, `projects[].grep`,
  `projects[].testMatch` and everything under `use` are not.
- **Vitest and jest projects are matched by identity.** The object projects of a `projects` list are matched by name
  (vitest `test.name`, a string or the `label` of an object; jest `displayName`, a string or its `name`), or by
  position for a project renamed in place, and only their test-list keys are compared: vitest `test.include` and
  `test.exclude`, jest `testMatch`, `testRegex` and `testPathIgnorePatterns`. A reorder, a changed `setupFiles`,
  `extends`, `transform` or any other key, and an `include` added where the base had none give nothing. A project
  removed at head is narrowed (a `block`), or a `warn` when the head gains an opaque entry. Entries that are not objects
  (glob strings, `defineProject(…)` calls) are compared as a glob list. A project that is renamed and reordered at the
  same time is read as removed.
- **Tool defaults.** A key that is removed, or that is set where it was unset, is not judged against the tool's default
  (an unset list is read as empty only to decide that a gained exclude entry is new). A threshold that is removed is
  reported as removed; a list that is narrowed from an unset base is not.
- **`.mocharc.jsonc` and `conftest.py`.** They are test-config names for the sources but TI09 reads neither, nor a bare
  `.mocharc`. A pytest option set in `conftest.py`, an environment variable such as `PYTEST_ADDOPTS` or `JEST_*`, and a
  config named by a flag (`--config`, `-c`) are not seen.
- **The INI and YAML subsets.** `pytest.ini`, `tox.ini` and `setup.cfg` are read by section only: `key = value` or
  `key: value`, with indented continuation lines; an inline `#` after a value is kept in the value (pytest's own reader
  does the same). `.mocharc.yml` is read as flat top-level keys: a nested mapping, a block scalar or an anchor makes
  only that key opaque, and a top-level line that is none of these refuses the file (`invalid-yaml`). The TOML table is
  read for strings, numbers, booleans and arrays of these; an inline table or a multi-line string is opaque.
- **Build and dependency entries are excused.** A glob or regex added to an exclude or ignore list does not count as
  widening when it names `node_modules`, `dist`, `build`, `coverage`, `.git`, `.venv`, `venv`, `__pycache__`, `.tox`,
  `.nox`, `.cache`, `.next`, `.nuxt`, `.eggs`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.nyc_output`, `.turbo` or
  `.svelte-kit` (after `<rootDir>`, a leading `./`, `^`, `/` or a leading `**/` and a trailing `$`, `/`, `/**` or `/*`
  are stripped), or declaration files (`*.d.ts`). `-p no:cacheprovider` in `addopts` is excused the same way.
- **Retries and timeouts are warnings only.** A raised `retry`, `retries`, `testTimeout`, `hookTimeout` or mocha
  `timeout` is `warn` in every mode, because a longer timeout or a retry does not by itself hide a failure: a timeout
  counts as raised when it is at least ten times the base value (or at least 50000 ms when it was unset, or `0` in
  mocha). Glob comparison covers one level of `{a,b}` braces (at most 64 alternatives) and the glob subset of
  `exclude`; a regex list is compared by equality only, so a regex rewritten to match the same files is a widening.
- **Caps.** At most 20 findings per file; a config of more than 524288 characters, or a syntax tree deeper than 1000, is
  not read (`too-large`, `too-deep`) and is named in `TEST_INTEGRITY_INDEX_UNAVAILABLE`. When such a head (or any
  head that cannot be read or was dropped) follows a base whose settings were read, it also gives one `(config)`
  finding at the mode's level, so padding the config past a cap does not dodge TI09.

### What TI10 misses

TI10 reads the added and removed lines of a modified or renamed `package.json`, with no context lines and no JSON
parser.

- **No context lines.** The diff is read with `--unified=0`, so any line of the form `"test…": "…"` is read as a script,
  even a `test` key outside `scripts` (a config block, a nested object) or one the line shows nothing about.
- **A script split over lines.** A script line is one `"key": "value"` pair. A value continued on the next line, a
  multi-line value, a one-line object and a key written over several lines are not read.
- **An added or deleted `package.json` gives nothing.** A new file has no earlier script to compare with, and a deleted
  one has no added line; only a modified or renamed `package.json` is read.
- **Other weakening forms are not named.** `|| true`, `|| :`, `; true`, `; :`, `echo` or `exit 0` as a command,
  `--passWithNoTests`, `--testPathPattern`, `-t` and `--testNamePattern` are caught; `--bail 0`, `--silent`,
  `--if-present`, a wrapper script that swallows the exit code, `--test-name-pattern` of `node --test`, a changed `test`
  command in `pyproject.toml`, a Makefile or tox are not; neither are `node -e "process.exit(0)"` or any other program
  that exits 0 without running the tests, a positional path filter (`vitest run src/one.test.ts`), `--dir` or
  `--project`. A lone `true` or `:` as the whole script, or before `||`, is read as `exit 0`. `exit 0` counts only as a
  command at the start, after `||` or after `;`. `echo` counts there too, and only when no `&&`, `|`, `&` or `;` follows it, so a banner such as
  `echo start && vitest run` is not a finding. `-t` is not a name filter in a script that runs `mocha`, where it is
  `--timeout`.
- **A weakening that was already there is excused by key.** A removed line of the same key with the same form accounts
  for the added one, so moving `|| true` to another command of the same script is missed.
- **`--passWithNoTests` is excused only when no tracked file is a test file.** An empty list of tracked files (git
  failed) does not excuse it, and a diff that deletes a test file does not either.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file. A diff that reaches `check()` already parsed without kept text yields no TI10.

### What TI13 misses

TI13 reads the added and removed lines of JS/TS and Python source files that are not test files.

- **Other tools' markers.** Only the Istanbul, V8 and C8 ignore hints in a comment and the coverage.py no-cover pragma
  (`# pragma: no cover`, `#pragma nocover` and the other spellings its default pattern reads) are read. `node:coverage` hints, `# pragma: no branch`, a custom `exclude_lines` pattern, `.coveragerc` and `.nycrc`
  settings and an exclusion in a config file are not.
- **Markers in test files.** A file that is a test file by name (section 1) gives nothing, and so does any file that is
  not JS/TS or Python.
- **A marker inside a string fires,** because the scan sees a comment start in the text of the line, not the syntax. A
  marker on a later line of a block comment (without its own comment start) is missed.
- **Moves and one-to-one matching.** A removed marker of the same text accounts for one added marker of the same file; a
  marker moved to another file reads as added. The text is compared after lower-casing and collapsing white space
  (for the Python pragma, after removing white space and the colon, so `no cover` and `nocover` are one marker).
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file. A diff that reaches `check()` already parsed without kept text yields no TI13.

### What TI08 misses

TI08 reads the status and the added lines of snapshot files, the added and removed lines of JS/TS test files, the
`test*` scripts of `package.json` and the pytest config files. It is a `warn` signal and never blocks.

- **An inline rewrite that changes only the body.** The count compares the lines that hold the inline-snapshot call. A
  rewrite that changes only the body lines (the template literal) and not the call line is not counted.
- **A renamed snapshot whose hunks only remove lines.** A renamed snapshot file counts only when it also has added lines,
  so a rename that removes lines is missed, and so is a pure rename.
- **10 or fewer snapshot files, and added snapshot files.** The mass-change rule needs more than 10 changed files, and a
  new snapshot file never counts.
- **Snapshot files by name only.** A `__snapshots__` directory, `.snap` and `.ambr` are read. `__image_snapshots__` and
  other extensions are not.
- **Other inline forms.** `toThrowErrorMatchingInlineSnapshot(` and Python inline snapshots are not read.
- **Update flags set elsewhere.** A flag passed on the command line, through an environment variable or a wrapper
  script is not seen, and TI10's limits on script lines apply (one `"key": "value"` pair per line; only keys that start
  with `test`; a `-u` in a mocha script is not a snapshot flag).
- **A pytest config word glued to other text.** The word must stand alone between white space, so a flag inside a quoted
  list or glued to other characters is missed, and a removed line that holds the word anywhere in the file excuses every
  added one.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 flag signals are
  given per file. A diff that reaches `check()` already parsed without kept text yields no text-based TI08 finding; the
  mass-change rule still works, as it reads only the status and the added lines.

### What TI15 misses

TI15 reads the added lines of JS/TS and Python test files and of JS/TS and Python source files that are not test files.
It is an `info` signal: it never blocks or warns, because on the precision corpus 0 of 30 sampled findings were a real
special case (see [PRECISION.md](./PRECISION.md#official-results-v030-2026-10-26)).

- **Both sides must be added in this diff.** A test that already holds the value, or a condition that was there before,
  gives nothing.
- **The `hard-coded-answer` form.** A change that adds no test line has no test literal to match, and the numbers in it
  are one digit (see the Skylos list below).
- **Short and common literals.** A string under 6 characters (UTF-16 code units), a number under 4 significant digits
  and the stop-list (`true`, `false`, `null`, `none`, `undefined`, `test`, `error`, `default`, `get`, `post`, `put`,
  `patch`, `delete`, `head`, `options`, `utf-8`, `utf8`, and the `typeof` results `string`, `number`, `boolean`,
  `object`, `function`, `symbol`, `bigint`) are not read. A real special case with a short value (`"vip"`, `42`) is
  missed.
- **One package root.** A test literal matches a source condition only within the same package: the root of a path is
  its nearest directory that holds a `package.json` or `pyproject.toml` (in the tracked files or added by the diff).
  With no manifest at all, a path under `packages/` or `apps/` takes its first two segments as its root. A shared
  literal between two packages is not seen, and a monorepo with no manifest outside `packages/` and `apps/` is one
  root.
- **Excluded directories.** A test file or a source file with a directory segment named `examples`, `benchmarks`,
  `bench`, `docs` or `fixtures` is left out (the file name does not count, so `src/examples.ts` is read). A special
  case in such a directory is missed.
- **Template literals with `${`** are skipped.
- **Other comparisons.** Only `===`, `!==`, `==`, `!=`, a `case` label and a Python `in (...)` group are read.
  `includes`, `startsWith`, `Set.has`, `<` and a regular expression are not.
- **Literals are compared as written.** Differently escaped forms of one value differ, the match is case-sensitive, and a
  string never equals a number.
- **Literals in comments are read,** because the scan does not understand comments or regular expressions. A quote in a
  comment can open a literal, and an unclosed quote ends the scan of its line.
- **Numbers need 4 significant digits.** A status code such as `404` or a number such as `200` or `1000` is not read
  (trailing zeros of a whole number do not count); `1234` and `0.1255` are.
- **The detail names the literal's kind and length, never its text.** A matched value can be a secret
  (`if (key === "<token>")`), and the report leaves the job, so a reviewer finds the value at the source line the
  finding names (`a 12-character string literal`, with the source `path:line` and the test file's path).
- **Go and other languages** give nothing on either side.
- **10 per change.** The first 10 findings of a change, ordered by source path, then line, then detail, are signals;
  the rest are counted per source path, and the message ends with how many more there are in each file.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8). A diff that reaches `check()`
  already parsed without kept text yields no TI15.

### What TI16 misses

TI16 reads the added and removed lines of JS/TS and Python test files. It gives `info` findings only, which never block
and leave the verdict at `pass`.

- **Other tools' markers.** Only the ESLint, Oxlint and Biome comments, the TypeScript `@ts-` comments, and the Python
  `type`, `noqa`, `pylint` and `pyright` comments are read. `prettier-ignore` and `jshint` are not; `istanbul` hints
  belong to TI13.
- **Suppressions in config.** An ESLint override for test globs, `per-file-ignores` and `tsconfig` options are not read.
- **Markers in non-test files** give nothing, and neither do Go test files.
- **A comment opener inside a string fires,** because the scan sees the characters of the line, not the syntax. A marker
  on a later line of a block comment is missed.
- **One finding per file,** at the first fresh suppression, with the count in its detail.
- **Moves.** A removed suppression with the same text (white space collapsed) accounts for one added one in the same
  file; a suppression moved to another file reads as added.
- **Info only.** The finding does not change the verdict and cannot fail the check in any mode.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8). A diff that reaches `check()`
  already parsed without kept text yields no TI16.

### What the accept label misses

The accept label (`pharn/accepted`, or the `accept-label` input) records a reviewer's sign-off on test-integrity block
findings. It is the Action's alone; the CLI never honours it.

- **Not tied to a commit.** The sign-off is on the pull request as a whole. The label stays after a later push, so
  findings added by a new commit are accepted too until someone removes the label. Nothing compares the commit the
  reviewer looked at with the one that is checked.
- **Over 1,000 events are not read.** The issue events are read in at most 10 pages of 100. A pull request whose event
  list does not end within them (more than 1,000 events) is not read, and the label is ignored with
  `TEST_INTEGRITY_ACCEPT_IGNORED`.
- **No permission check on the applier.** Any user account that can label the pull request and is not the author counts,
  whether or not it may approve or merge. A bot never counts, so a team that labels through an app has no sign-off by
  that route, and a user acting through an app's token is read as the app.
- **Pull request runs only.** A `merge_group` or `push` run, and `pull_request_target`, never ask, so a block there
  stays a block even for a pull request that carries the label.
- **Only the newest event decides.** An earlier sign-off by another reviewer does not count once the author or a bot has
  applied the label again.

### What the tests-exercise check misses

The tests-exercise check (`TESTS_NOT_EXERCISING_CHANGES`, A8 step 1) asks, for each changed JavaScript or TypeScript
source file, whether a JS/TS test file the change adds or modifies imports it directly and keeps or raises its
assertion count. It reads only the touched test files' text that the signals above already read; it reads no source
file and runs no test. It is a warning in every mode and never fails the check.

- **No per-test coverage.** lcov and Cobertura give coverage summed over every test, so the check cannot say which test
  ran, or asserted on, a changed line. It judges by imports alone: a test that imports the file but never calls the
  changed function counts as exercising it, and a test that reaches the changed code through other files does not.
  Per-test coverage (A8 step 2) is a separate, report-only experiment and is not used.
- **Direct imports only.** A source file counts only when a changed test file imports it itself. A file reached
  through another source file (a re-export from an `index.ts`, a helper that imports it) is not followed, because the
  check does not read source files.
- **Relative specifiers only.** `./` and `../` specifiers are resolved against the tracked files and the diff's new
  paths: the path itself, its TypeScript twin for a `.js`, `.jsx`, `.mjs` or `.cjs` spelling, then the path with each
  of the eight JS/TS extensions (TypeScript first), then its `/index` file. Bare specifiers, tsconfig `paths` aliases
  (`@/cart`, `~/cart`), `#` subpath imports, workspace packages (`@scope/pkg`) and absolute paths are not resolved, so a
  test that imports its subject through one of them does not count; a monorepo whose tests import their package by
  name sees the warning for every changed file.
- **Which imports count.** Static imports (side-effect imports included), `export … from`, `import x = require(…)`,
  `require` with one string literal and dynamic `import` of a string literal count. Type-only imports and exports
  (`import type`, or named bindings that are all `type`) do not, nor does a mock path (`vi.mock`, `vi.doMock`,
  `jest.mock`, `jest.doMock`, or a dynamic import passed straight to one), nor a computed specifier. At most 1000
  distinct specifiers are kept per test file.
- **Which changes are asked.** Only added, modified or renamed JS/TS files with at least one added line. Not asked:
  test files (by the test globs of TI01), declaration files (`.d.ts`, `.d.mts`, `.d.cts`), config files (a dotfile, a
  basename with `.config.` in it, or a test-runner config), lockfiles, snapshots, `*.generated.*`, files under `dist/`,
  `vendor/` or `node_modules/`, minified files (`*.min.*`), files matched by `coverage.exclude`, binary entries, deleted
  files, renames without edits and changes that only remove lines. Python, Go and every other language are not
  checked. A source file that is really a test helper outside a test directory is asked like any other.
- **Which tests count.** An added JS/TS test file with at least one assertion at head, or a modified test file (or one
  renamed between test paths) whose diff adds or removes a line and whose head has at least one assertion and no fewer
  than its base, counting the assertions of its tests (an assertion in a hook does not count). A test file the test
  index refused, or that was not read (a drop reason of section 8, the 200-file cap included), gives no evidence, so its
  sources are reported as not exercised; the file itself is named in `TEST_INTEGRITY_INDEX_UNAVAILABLE`. A Python test
  file gives no evidence.
- **When it is silent.** In mode `off`, without a diff, without test sources (a GitHub compare API diff, PR-number
  mode), when the head side of the sources could not be read, or when the touched test files were not compared
  because a side could not be read.
- **Caps.** The message names the first 10 paths in code-unit order, then `+N more`; `testIntegrity.exercise` lists at
  most 200 paths and counts the rest in `truncated`; the comment lists at most 50 (`maxRows`).

## What test integrity does not catch

The test-integrity signals that ship today (TI01, TI02, TI03, TI04, TI05, TI06, TI07, TI08, TI09, TI10, TI11, TI12,
TI13, TI14, TI15 and TI16) read the added and removed lines of the diff, in files they recognise by name; TI02, TI05,
TI06, TI07 and TI12 also read the text of the JavaScript, TypeScript and Python test files the change modifies, and TI09
the text of the test-runner config files it touches, at the merge base and at `HEAD`. They do not run tests or read a file that the diff does not touch, and they judge the strength of an
assertion only from a fixed table of matchers (TI06). The accept label records that a reviewer who is not the author
signed off a block finding. It cannot show that the reviewer read the tests, and it never adds a check. What each signal
misses is listed under its own "What TIxx misses" heading above, and the accept label's limits under "What the accept
label misses". A file whose changed lines run past 5000 is read only up to that point; the
report names it with `TEST_INTEGRITY_TEXT_TRUNCATED` (section 8).

The benchmark for what is not seen is Skylos's list of nine ways to hide a failing test. The nine cases are reproduced
in vitest under `fixtures/skylos-nine/` and pinned by tests. The signals of this release catch **7 of 9**.

The same nine are reproduced for pytest under `fixtures/skylos-nine-pytest/`, where the signals catch **8 of 9**; the
case-by-case table is in [PRECISION.md](./PRECISION.md#3-skylos-nine-what-pharn-ci-catches). The lists below are the
vitest result.

Caught:

- `deleted-test` — caught by TI01: the test file is deleted, and its removed lines define tests.
- `added-skip` — caught by TI03: `it(` becomes `it.skip(` on a test the diff shows existed.
- `emptied-assertion` — caught by TI05: the `expect(...)` call is replaced by a bare call, so the test still runs and
  asserts nothing; the test had an assertion at base and has none at head.
- `deselect-setting` — caught by TI09: the runner's `include` list is narrowed in `vitest.config.ts`, so the test file
  is never picked up; TI09 compares the config at the merge base and at `HEAD` and reports `test.include narrowed`.
- `replaced-test` — caught by TI02: a test is replaced by one with another name and a different body, so no test file is
  deleted and nothing is skipped, but no test of the old name or a similar body is left.
- `loosened-assertion` — caught by TI06: `toBe(5)` becomes `toBeTruthy()`, so the test still runs and asserts as many
  things, but the strong matcher is now a weak one. TI06 warns and never blocks.
- `edited-expected-value` — caught by TI07: `toBe(5)` becomes `toBe(6)` in the same test, in a change that also edits a
  source file, so the test agrees with the code. TI07 warns and never blocks; it does not say that the new value is
  wrong.

Not caught. Each of these names the signal meant for it: TI15 exists and misses its case, and TI17 is only a
proposal:

- `hard-coded-answer` — missed; planned: TI15. The source returns the expected value for the test's input. TI15 now
  exists and still misses it, because the change adds no test line to match against and its numbers are one digit.
- `always-true-matcher` — missed; planned: TI17, which is a proposal and not a signal in the test-integrity spec yet.
  A custom matcher that always passes replaces `toBe(5)`. See "TI17 proposal" below.

Other ways a change can weaken tests without being seen:

- A test replaced by a new test with the **same name** and a **trivial body**. TI02 misses it when the name stays, and
  TI05 catches only the case where the assertions go (or some go with the rest of the body unchanged).
- Semantic weakening that keeps the matcher, such as `toEqual(expectedFromOutput)`, where the expected value is read
  back from the code under test.
- A **mock** introduced in a **setup file** that the diff does not show as a test file, so a test passes against a
  stand-in.

### TI17 proposal (not implemented)

TI17 is a proposal for the always-true matcher, which no signal is built for (TI06 sees only a changed matcher, not a
matcher that always passes). It is not implemented, it is not in the
report schema, and nothing in the Action or the CLI produces it. It would detect three things:

1. An `expect.extend` matcher defined in the diff whose `pass` is constant true.
2. A Python helper defined in the diff that returns a constant `True` and is used in an `assert`.
3. `expect.anything()` or `mock.ANY` replacing a concrete expected value.

The planned severity is `warn`: each of these can be deliberate, so TI17 would ask for a look and never block.

The cases it would ship with: must-trigger: the vitest `always-true-matcher` (a matcher whose `pass` is constant true
replaces `toBe(5)`) and the pytest `always-true-matcher-any` (`== 5` becomes `== ANY`). must-not-trigger: a matcher
whose `pass` compares its argument, and `expect.anything()` in the argument list of a call matcher such as
`toHaveBeenCalledWith`, where it stands for one argument the test does not care about.

It would miss a matcher or helper defined outside the diff, and a constant computed indirectly, for example through a
variable or a function call.

## Python parity

The Python column below is what the signals do for pytest and unittest test files today, each cell grounded in a fixture
under `fixtures/test-integrity/` or `fixtures/py-index/` that a test pins. `caught` means a must-trigger case and a
must-not-trigger case exist; it does not mean every spelling is seen (see the Python misses after the table).

| Signal | JS/TS | Python |
| --- | --- | --- |
| TI01 deleted test file | caught — `block-code-stays` | caught — `block-root-tests` and `pass-init-py` |
| TI02 removed test | caught — `block-removed-it` | caught — `block-pytest-removed`, `block-unittest-method-removed`, and through aliases `block-pytest-alias-marked-removed` |
| TI03 added skip | caught — `block-it-skip-existing` | caught — `block-pytest-decorator`, the `*-alias-*` cases, `@unittest.expectedFailure` and `pytest.xfail(` |
| TI04 focused run | caught — `block-it-only` | not applicable — pytest has no `.only` |
| TI05 emptied test | caught — `block-emptied` | caught — `block-pytest-emptied`, `block-pytest-alias-raises-removed`, `pass-pytest-alias-emptied-skipped` |
| TI06 weakened assertion | caught — `warn-assert-ok` | caught — `warn-py-assert-truthy`, `warn-pytest-alias-approx-truthy` |
| TI07 expected value edited | caught — `warn-tobe-number` | caught — `warn-pytest-eq` and `warn-unittest-assertequal`, through the Python index |
| TI08 snapshot and update flags | caught — snapshot files and `test*` scripts | caught — the pytest config files (`pytest.ini`, `tox.ini`, `setup.cfg`, `pyproject.toml`) |
| TI09 runner config loosened | caught — vitest, jest, mocha and playwright configs | caught — `block-pyproject-testpaths-narrowed`, `block-pytest-native-*` for the `[tool.pytest]` table |
| TI10 test script weakened | caught — `package.json` scripts | missed — only `package.json` scripts are read, not `tox.ini` commands or a Makefile |
| TI11 test step removed from CI | caught — workflow commands | caught — `pytest`, `python -m pytest`, `python -m unittest`, `tox` and `nox` commands in workflows |
| TI12 module under test mocked | caught — `vi.mock` and `jest.mock` of the module under test | caught — `patch` and `mock.patch` of it, through the Python index |
| TI13 coverage exclusion | caught — Istanbul, V8 and C8 hints | caught — `block-pragma-*` and `pass-pragma-*` for `# pragma: no cover` |
| TI14 pharn-ci config loosened | caught — the config file | not applicable — it reads the pharn-ci config, not test code |
| TI15 test value hard-coded | caught — JS/TS test and source files | caught — Python test and source files |
| TI16 suppression added | caught — ESLint, TypeScript and Biome comments | caught — `noqa`, `type`, `pylint` and `pyright` comments |

**Python misses.** What the Python column does not see:

- `monkeypatch.setattr` object forms are read only when the object is a dotted name and the attribute a string
  literal; `monkeypatch.setattr(make_obj(), name, …)` is not, and an aliased mock callee (`from unittest import mock as mk`, then
  `mk.patch(…)`) is read as written, so TI12 does not see it. The assertion, marker and fixture names of TI02, TI05 and
  TI06 are resolved through top-level imports; mock callees are not.
- `conftest.py` is a test-config name for the sources but nothing in it is read: a marker, a fixture or an option set
  there is not seen, and neither is `PYTEST_ADDOPTS` or a `-c` config flag.
- `request.node.add_marker(pytest.mark.skip)` and a marker kept in a variable (`sm = pytest.mark.skip`, `@sm`) are not
  read as skips.
- An alias is read only when it is bound by a top-level `import` or `from … import` statement at column 0. One bound
  inside an `if`, a `try` or a function, in a docstring, by a backslash continuation, or by `from pytest import *`
  (`import *` binds nothing) is not. A reassignment after the import (`pt = pytest`) is not followed, and a later
  top-level import of the same name replaces the earlier binding, so `import os as pt` after `import pytest as pt` hides
  pytest.
- `[tool.pytest]` and `[tool.pytest.ini_options]` in one `pyproject.toml` are merged into one table in which the native
  value wins, which is not necessarily what pytest does; a header written with a quoted or dotted key is not read.
- Results depend on the runner's Python. Test files are parsed by the runner's own `python3` (or `python`), so a file
  that uses syntax newer than that interpreter (for example a `match` statement on Python 3.8 or 3.9) may not parse
  there; it is then named in `TEST_INTEGRITY_INDEX_UNAVAILABLE` (`warn`) and not compared. Pin the Python version
  in the workflow to get the same result on every runner.

## 2. When an input is missing

- **A missing input fails only with a threshold.** `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`,
  `COVERAGE_FORMAT_UNSUPPORTED`, `COVERAGE_PATHS_UNMATCHED` and `DIFF_UNAVAILABLE` are errors, and the verdict is `fail`, when a
  threshold is set (0 included): a gate that cannot measure fails closed. Without a threshold they
  are warnings. `DIFF_UNAVAILABLE` is also an error in `test-integrity: block`, threshold or not: block
  asked for a test-integrity gate, and a gate that cannot see the change fails closed.
- **`DIFF_UNAVAILABLE` has several causes.** It is reported when there is no base to diff against (a
  push without a previous commit, or no `base-ref` outside a pull request or merge queue), when
  neither local git nor the GitHub API can produce the diff (for example a shallow checkout and an
  API error), when the diff is over the size limit, and when a `pull_request_target` run checked out
  the base branch (that run is refused, not measured: checking out the PR head to measure it would
  run fork code with a write token; see `SECURITY.md`). It is also reported when the base is HEAD or a
  descendant of it (`base-ref: HEAD`, the run's own sha, or the CLI's `--base HEAD`): the diff is empty and
  nothing would be measured, so it is not a `NO_COVERABLE_CHANGES` pass.
  Use `fetch-depth: 0` and a `pull_request` trigger and this does not happen in practice. The GitHub
  compare API is not an equivalent of `fetch-depth: 0`: its diff carries no readable test text, so
  the signals that compare test text do not run on it. A local `git diff` that fails against a base
  that is in the checkout fails the step in every mode, and the compare API is not tried. A
  `base-ref` you set that is found neither in the checkout nor through the GitHub API is not
  `DIFF_UNAVAILABLE`: it fails the step, like a bad `--base` in the CLI.
- **Test integrity in `block` fails closed on an unreadable change, with these limits.**
  `TEST_INTEGRITY_INDEX_UNAVAILABLE` is an error in mode `block` only when TI02 and TI05, or TI09, did
  not run at all (the test text could not be read and a test file or a test-runner config is
  modified). The per-file form, where some touched files could not be compared or some added test
  files could not be read, stays a warning in block. With no coverage file and no diff, block reports the coverage problem (a warning without a
  threshold). A7 and P02–P07 need a local diff (`fetch-depth: 0`). Their "did not run" message is
  a warning, except that `POLICY_SETTINGS_INVALID` for unread settings is an error under a required
  app policy or a policy that lists `required_permissions_deny` or `required_hooks` at block (P03,
  P06): a demand that cannot be checked is not met, so a shallow checkout or `pr-number` mode fails
  the step there. In `pr-number` mode the test text is never available, so block fails there when a
  test file or a test-runner config is modified; use `test-integrity: warn` for that flow.
- **`fail-on-verdict: false` makes the step report, not gate.** As its old name `fail-on-threshold` did not say,
  it covers every cause of a `fail` verdict: diff coverage, test-integrity blocks and org policy violations and
  errors, a required policy included. The verdict and outputs are still set. The old name is still read (with a
  deprecation warning) when `fail-on-verdict` is not set.

## 3. Coverage formats

- **lcov and Cobertura, in the Action and the CLI.** Both read the format you name (`lcov`,
  `cobertura`) or, with `auto` (the default), detect it from the start of the file. Clover and
  JaCoCo native XML are not supported; other formats are on the roadmap.
- **Detection reads only the first 1 KiB.** After an optional byte order mark and leading
  whitespace, a file that starts with `TN:` or `SF:` is lcov. XML is Cobertura when its root
  element is named `coverage`, the root has no `clover` attribute, and its first child, if the
  window shows one, is not `project` (that is Clover). The XML declaration, comments and DOCTYPE
  before the root are skipped. A root start tag that does not end within the first 1 KiB makes
  the file unknown, so a real Cobertura report with a very long prolog needs
  `coverage-format: cobertura`. A file of only whitespace is empty.
- **Unknown is not guessed.** Under `auto`, a file that is neither lcov nor Cobertura (Clover,
  JaCoCo native XML, any other text) is `COVERAGE_FORMAT_UNSUPPORTED`, an error with a
  threshold. An empty file is `COVERAGE_FILE_EMPTY`. Naming a format skips detection: `cobertura`
  on a Clover or JaCoCo native file reads no records and is `COVERAGE_FILE_EMPTY`.
- **Malformed lcov lines are skipped and counted.** Invalid or orphan `DA` records are left out of
  diff coverage, and the report carries one `COVERAGE_LINES_SKIPPED` message (`info`, so the verdict
  does not change) that gives how many were skipped, never their line numbers or file names. The
  message is only on reports where diff coverage was computed, not on the ones that end early (a
  missing or empty file, an unmatched path, no diff). A file (`SF`) with no valid `DA` line is
  absent from the map, as in Cobertura, and a report with no valid `DA` line at all (a crashed or
  truncated reporter) is `COVERAGE_FILE_EMPTY`.
- **Malformed Cobertura lines are skipped and counted too.** A `<line>` whose `number` is not an
  integer >= 1, or whose `hits` is present but not a finite number >= 0, is dropped (a missing
  `hits` counts as 0) and counted in the same `COVERAGE_LINES_SKIPPED` message. A file with no valid
  line is absent from the map, and a report with no valid line at all is `COVERAGE_FILE_EMPTY`.
- **Cobertura methods, branches and rates are ignored.** Only class-level `<line>` records count.
  A `<line>` inside `<methods>`, the `branch` and `condition-coverage` attributes, and every
  `line-rate` or `branch-rate` are not read, so branch coverage never affects the verdict.
- **Cobertura merges by maximum, lcov by sum.** One file repeated across classes (JaCoCo inner
  classes) or packages (a shared source) keeps the highest hit count per line, because Cobertura
  repeats a file's lines and summing would double-count them. Repeated lcov records are summed.
- **Hit counts are summed across coverage files.** When several coverage files list the same
  line, their hits are added, so a line covered in any of them is covered. This is also true of
  two Cobertura files, whose own repeated lines inside one file still merge by maximum. Two
  reports of the same test run have their hits counted twice, which changes the hit counts but
  not whether a line is covered.
- **Several coverage files and globs.** `coverage-file`, `--coverage` and `coverage.file` take
  several entries, each a path or a glob (`*`, `**`, `?`; the exclusion subset). `auto` detects
  the format of each file; an explicit format applies to all of them, so a Cobertura file read as
  lcov is `COVERAGE_FILE_EMPTY` naming it. The report names `diffCoverage.format` only when every
  file has the same format. The first bad file, in entry order and path order within a glob, is
  the one reported. An entry containing `[`, `]`, `{` or `}` is rejected as unsupported glob
  syntax even without `*` or `?`, so a literal coverage path with one of those characters is a
  usage error. The walk goes down from the base, skips `.git` and `node_modules` unless the
  pattern names them, never follows a symbolic link, and stops at 1,000 matched files or 100,000
  visited directory entries per run. A glob that finds nothing is `COVERAGE_FILE_MISSING`.
- **The first usable `<source>` wins.** A relative `filename` is joined to the report's sources in
  order and the first join that lies under the repo root is used. pharn-ci reads no files, so it
  cannot tell which source actually holds the file; with several sources under the root, the
  first can be wrong. An absolute `filename` is never joined. With no usable source, the
  filename is used as written, normalized.
- **The XML reader is minimal.** It skips comments, CDATA, processing instructions and DOCTYPE
  declarations (no entity or DTD expansion), decodes only the five predefined and numeric
  character references, and ignores namespace-prefixed element names. Text inside CDATA, such
  as a source path written as CDATA, is not read.

## 4. Agent setup inventory

- **It is an inventory, not a review.** pharn-ci lists agent setup files; the inventory itself reads
  none of them. Check A7 reads the machine-readable kinds for committed secrets
  ([Secrets in agent configs](#secrets-in-agent-configs)). Under an org policy, P07 reads the instruction kinds
  ([What P07 misses](#what-p07-misses)). It does not validate their syntax, judge their
  content, or check them for prompt injection.
- **Only tracked files are seen.** The list comes from `git ls-files`, so untracked or ignored
  files (a typical `.claude/settings.local.json`) are not listed.
- **The kinds detected are fixed (34):** `claude-md`, `claude-local-md`, `agents-md`, `gemini-md`,
  `claude-settings`, `claude-settings-local`, `claude-skill`, `claude-hook`, `claude-agent`,
  `claude-command`, `claude-rule`, `cursor-rules`, `cursor-mcp`, `copilot-instructions`,
  `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`, `vscode-mcp`, `codex-config`,
  `windsurf-rules`, `cline-rules`, `mcp-config`, `aider-config`, `conventions-md`,
  `continue-rules`, `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`,
  `augment-rules`, `kiro-steering`, `goosehints`, `opencode-config` and `gemini-settings`.
- **Nested directories:** `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md` and
  `.goosehints` match anywhere in the tree, as do files under `.claude/skills/`, `.claude/hooks/`,
  `.claude/agents/`, `.claude/commands/`, `.claude/rules/` and `.cursor/rules/`. Everything else
  matches at the repo root only: `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`,
  `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`,
  `.cursorrules`, `.windsurfrules`, `.windsurf/rules/`, `.clinerules`, everything under `.github/`,
  `.aider.conf.yml`, `CONVENTIONS.md`, `.continue/rules/`, `.continuerules`, `.roorules`,
  `.roorules-<mode>`, `.roo/rules/`, `.roo/rules-<mode>/`, `.amazonq/rules/`,
  `.junie/guidelines.md`, `.rules`, `.augment/rules/`, `.augment-guidelines`, `.kiro/steering/`,
  `opencode.json`, `opencode.jsonc` and `.gemini/settings.json`.
- **Deliberately not detected:**
  - Sourcegraph Cody: its repo rules were experimental, and the product is being wound down.
  - User-level and global configuration, such as files in a home directory.
  - OpenCode's `.opencode/` directory and Gemini CLI's `.gemini/commands/`.
  - Nested copies of the root-only kinds, such as `packages/app/.rules`, `packages/app/.mcp.json`
    and `packages/app/.claude/settings.json`.
  - Placeholders under a directory kind: a dot-file (`.gitkeep`) or a README (any case, with or
    without an extension) in `.claude/skills/`, `.github/agents/`, `.roo/rules/` and the other
    directories above is not listed, and does not fall through to a file-name kind.
  - Anything with a `node_modules` directory in its path. A vendored copy of agent setup files
    under another name (such as `third_party/`) is still counted, since pharn-ci cannot tell a
    vendored copy from the repo's own.
  - Files that a config names (for example the `read` list in `.aider.conf.yml`): pharn-ci never
    follows a path a setup file names.
  - Other tools that also read an existing kind: only `agents-md` credits several tools.
- **Precedence:** a path is classified by the first matching rule, and rules tied to a directory
  or full path come before the file-name rules. So `.claude/agents/CLAUDE.md` is a `claude-agent`,
  not a `claude-md`.
- **Empty files are reported from `HEAD`.** `AGENT_SETUP_FILE_EMPTY` (`warn`) comes from the file
  sizes in `git ls-tree -r -l HEAD`, while the inventory comes from `git ls-files`. A file that is
  staged or changed but not committed has its `HEAD` size, or none. Only size 0 counts: a file
  with only whitespace or a comment is not reported. When `git ls-tree` fails, no empty file is
  reported (the CLI notes it on stderr, the Action warns) and the rest of the report is unchanged.
  In the Action's PR-number mode the checkout is not the PR, so no sizes are read and no empty
  file is reported.
- **Expected tools are judged by kind, not by content.** A tool in `setup.expect` counts as present
  when any setup kind it reads exists; for example `AGENTS.md` satisfies amp, codex, copilot, cursor,
  jules, opencode and zed. The kind comes from the path alone, so an unrelated file still
  counts (an empty one gets `AGENT_SETUP_FILE_EMPTY`).
- **The summary is derived.** `agentSetup.summary` holds counts per kind and the tools those kinds
  belong to, from a fixed list. It is computed from the file list and says nothing about content.

## Secrets in agent configs

Check A7 (`AGENT_CONFIG_SECRET_*`) reads the committed text of the machine-readable agent setup kinds at `HEAD` and looks
for ten shapes of secret by prefix and position. It is a heuristic, not a secret manager. What it misses:

- **Markdown kinds are not read.** `CLAUDE.md`, `AGENTS.md`, the rules, skills, agents and commands are never scanned,
  and neither is a `.md` file under `.continue/rules/`.
- **`.env` files and other files are not read.** `.env*` files, `.continue/config.*` and every file the inventory does
  not list are outside the scan, as is any custom format a tool reads from another path.
- **Only the listed kinds and paths.** A nested copy of a root-only kind (`packages/app/.mcp.json`) is not an agent
  setup file, so it is not scanned.
- **Shapes, not provider checks.** A key is recognized by its prefix and length, or by a secret-named key with a long,
  high-entropy value. Nothing asks the provider whether a key is live (no network call), so a revoked or made-up key is
  reported, and a key of a provider or format not in the ten shapes is missed.
- **Low-entropy passwords are missed.** S10 needs 20 characters and 3.5 bits of entropy per character; `hunter2` is
  not reported by S10 (S11 may name it when the file also loads other secrets from the environment).
- **Encoded or split values are missed.** A base64-wrapped value, a secret split across two strings or lines, a value
  built from variables, and a secret in a key that is not named like one are not seen.
- **Keys in file names are not read.** A secret in a path or a file name is outside the scan.
- **Bare values stop at a space.** A header such as `Authorization: Bearer <value>` without quotes is read as the word
  `Bearer`; quote it, or the scheme word hides the value from S10.
- **The files must be committed text.** A file over 512 KiB, a binary file, a path git cannot read safely, or one past the
  caps (200 files, 16 MiB) is named in `AGENT_CONFIG_SECRET_UNSCANNED` and not read.
- **The Action reads the checkout's `HEAD`.** With a diff from the local checkout that is the pull request head; in
  PR-number mode or with a compare-API diff it may not be, so nothing is read and the report says so.
- **An embedding with no batch git runner scans nothing.** The CLI and the Action gather the sources only when their
  deps carry a batch git runner (`gitBatch`); a program that calls `check()` itself passes `agentConfigSources` or gets
  no A7 message.
- **A finding is not a removal.** A secret already in git history stays there after the file is fixed; revoke it.

## Stale agent instructions

SI01 to SI04 (`SETUP_STALE_*`) compare the commands and paths the agent instruction files name with the tracked files,
the root `package.json` and the root `Makefile`. They are a heuristic at `warn` (SI04 `info`), not a review of the
instructions, and they never fail the check. What they miss:

- **Prose without backticks is never read.** "Run the build script" or a path written in a sentence names nothing; only
  inline code spans, shell-fenced (or unmarked) blocks, Markdown link targets and `@path` imports count. HTML links
  (`<a href>`, `<img src>`) and reference-style links used before their definition line are not read.
- **Only root scripts and targets.** SI01 compares commands with the root `package.json` scripts and the root `Makefile`
  targets, and only for instruction files that apply to the whole repository. A nested `package.json` in a monorepo,
  scripts defined in a workspace package, a non-root `Makefile`, a `Taskfile`, a `justfile`, `turbo` or `nx` tasks,
  `composer`, `cargo`, `poetry` and `npx` commands are not compared. A command with a workspace flag (`--filter`, `-w`,
  `-r`, `--prefix`, `-C`) or after a `cd` is skipped.
- **Builtins and binaries are guessed.** pnpm's and yarn's own commands and a fixed list of common binaries
  (`tsc`, `eslint`, `vitest`, ...) plus every dependency name are never called missing scripts, so `pnpm misspelled`
  is reported only when it is none of those. `npm run x`, `bun run x`, `pnpm run x` and `yarn run x` always name a
  script. A `Makefile` with an `include`, a pattern rule (`%`) or a target built from a variable is not judged.
- **Script names with unusual characters are skipped.** A script or target with a character outside letters, digits and
  `. _ - + / : @` is not compared, and a path with a space or a non-ASCII character is not read.
- **Paths are matched by name, not by meaning.** A token counts as present when it is a tracked file or directory from
  the root or from the instruction file's directory, or the end of any tracked path (`src/check.ts` matches
  `packages/core/src/check.ts`), so a stale path that happens to exist elsewhere is missed, and a bare file name is
  present when any tracked file has it.
- **Untracked on purpose is not stale.** Paths under `node_modules`, `dist`, `build`, `out`, `coverage`, `target` and
  other build-output or cache directories, `.env` files, names with `.local`, paths through a dot directory that is not
  tracked (`pharn/.run/x`), extensionless tokens whose first segment is not a tracked entry or is a dependency name
  (`next/link`, `owner/repo`) and files a tool creates later are never reported, even when an instruction tells the
  agent to read them.
- **Examples and negations are word heuristics.** A fenced block in any language but a shell is an example and is not
  read; an indented block, an HTML comment and frontmatter are not read; a line or a section under a heading with
  `not`, `never`, `don't`, `avoid`, `instead`, `deprecated`, `removed`, `legacy`, `example` or a similar word is
  skipped. A legacy name in a line without such a word ("equivalent to `middleware.ts`") is still read.
- **Diff-aware by design.** A stale token in an instruction file the change does not touch is reported only when the
  change deletes or renames the path or file it names, or removes the script or target from the root manifest. A
  repository whose instructions went stale over many past pull requests shows nothing until one of those files is
  edited. Without a diff nothing is checked.
- **SI04 needs history and is coarse.** The instruction file's last commit is read with `git log -1 --format=%ct`; on a
  shallow checkout (the `actions/checkout` default) every file's last commit is HEAD, so SI04 is silent; use
  `fetch-depth: 0`. A file is old after 90 days, a fixed value. Only exact paths count as named, and at most 20
  instruction files are timed. An old file that still describes the code is reported all the same (`info`).
- **Caps.** At most 50 instruction files (in path order), the first 256 KiB of each and 2000 tokens per file are read;
  the root `package.json` and `Makefile` are read up to 512 KiB. At most 20 findings per file and signal and 100 in
  all are listed; the messages count the rest. The tracked files are read from `git ls-files`.
- **The Action reads only with a local diff.** In PR-number mode, with a compare-API diff or without a batch git
  runner nothing is read and nothing is reported. A failed read of the instruction files writes one log line and
  reports nothing; a failed manifest read leaves SI01 out, a failed `git log` leaves SI04 out.
- **The org policy does not set these levels yet.** `test_integrity.signals` and the policy rules do not name SI01 to
  SI04, so a policy cannot raise them to `error`.

## Prompt-injection scan

The prompt-injection scan (PI01 to PI05, `INJECTION_*`) reads the added lines of the diff and the changed paths. It is
a text filter for content aimed at the next agent, not a judgement of what a text means. What it misses:

- **Only added lines.** Text already in the repository, in a removed line or in an unchanged line next to a change is
  not read. An HTML comment opened in an unchanged line is not seen as a comment (PI03 still reads the added lines in
  it); one opened in an added line is followed only across consecutive added lines.
- **One line at a time.** An instruction split across two lines, two files or two pull requests, and a phrase broken
  by punctuation or markup (`ignore *previous* instructions`), is not matched. Zero-width characters inside a phrase
  are dropped before matching (and are PI01 findings themselves).
- **A short, fixed phrase list.** PH01 to PH32 are well-known wordings. A paraphrase, another language, a synonym or a
  new jailbreak is missed until the list (or an app policy's `injection.phrases`) names it. PH13 and PH14 (the persona
  switch: *you are now* followed by *a* or *an*) also match an ordinary sentence that tells a reader their new role,
  which is a `warn` to dismiss.
- **No decoding.** Text in base64, hex, ROT13, URL encoding, HTML entities (`&#x202E;`), JSON escapes (a backslash, `u` and four hex digits) or
  any other encoding is not decoded; PI04 only flags a long base64 or hex run, and only in agent instruction files.
- **No homoglyphs or confusables.** A Cyrillic `а` in place of a Latin `a`, full-width letters, or mixed-script names
  are not flagged; only the listed invisible and bidirectional characters are.
- **Not every invisible character.** The Hangul fillers, U+034F combining grapheme joiner, the variation selectors
  outside emoji, U+2028 and U+2029, and other default-ignorable code points are not on PI01's list. ZWJ and ZWNJ pass
  between two letters or marks of any non-Latin script and between emoji parts, so one hidden there is missed;
  directional marks pass on any line that holds a right-to-left letter.
- **Images, binaries and generated files.** Text inside an image, a PDF, an archive, a notebook's output or a file the
  diff shows as binary is not read.
- **Hidden Markdown is a short list.** PI02 reads HTML comments, reference definitions and quoted link titles. Image alt
  text, `<details>` blocks, HTML attributes, CSS that hides text, white-on-white text, zero-size fonts and footnotes
  are not treated as hidden; their text is still read by PI03.
- **Exempt paths are not read.** Test files (`*.test.*`, `*.spec.*`), `fixtures/`, `__fixtures__/` and `testdata/` are
  never read, `test/` directories and locale files are not read for phrases, and an app policy can exempt more. A
  pull request can put content in an exempt path; an agent that reads it is not warned.
- **Vendored directories by name.** PI05 knows six directory names and the inventory's instruction kinds; an
  instruction file under another vendoring layout (`external/`, `deps/`, a git submodule) is not flagged, and a modified
  one in a vendored directory is not either (only added or renamed-in files).
- **Caps.** The scan keeps the first 50,000 added lines of a file and 8,000,000 characters of added text across the
  diff, in diff order: a file past either cap is named in `INJECTION_TEXT_TRUNCATED` (`warn`) and a finding past the
  cut is not seen. At most 20 findings per signal and file and 200 in all are listed; the messages count the rest.
  At most 100 of an app policy's phrases are matched.
- **A pre-parsed diff must carry the text.** A program that calls `check()` with a diff it parsed itself gets no
  findings unless it parsed with `readDiffChunks` or the reader's `keepAddedText` option.
- **A finding is not a removal.** An instruction that already reached an agent's context, a cache or a fork stays
  there after the line is removed.

## Flaky tests and JUnit results

The JUnit reader (`junit-paths`, `--junit`) and the quarantine (the app's list, the CLI's `--quarantine-file`) report
what the test runner wrote. They do not detect flakiness themselves; that needs the history of many runs on pharn.dev.
What they miss:

- **The files are the pull request's.** Its own tests write them, so they say what the tests chose to write: a test
  reported as passed, a renamed test, a file not written. pharn-ci never fails or passes a check on test results, so
  this changes only the Flaky section, the uploaded history and the exit code of `pharn-ci test` (THREAT-MODEL residual
  42).
- **A subset of JUnit.** `<testsuites>`, `<testsuite>` (nested) and `<testcase>` with `<failure>`, `<error>` and
  `<skipped>`. Surefire's `<flakyFailure>` and `<rerunFailure>` are ignored, so a test that passed on a rerun counts as
  passed and its earlier failures are not counted; a test listed once per retry (some runners write each attempt) counts
  once per entry. `<properties>`, `<system-out>`, `<system-err>`, attachments and the `tests`/`failures` attributes of a
  suite are not read; the counts come from the test cases.
- **Strict about structure.** A file with a DOCTYPE or any other `<!` declaration, an element left open (a runner that
  crashed mid-write), an end tag that closes the wrong element, a second root, a root other than `testsuites` or
  `testsuite`, or nesting deeper than 256 is refused whole (`JUNIT_INVALID`), even when most of it would read. An
  undefined entity such as `&nbsp;` is kept as written, not refused.
- **Caps.** The first 50 files in pattern order (each pattern's matches sorted), 25 MiB of text in all, and 20,000 test
  cases; the file that crosses 25 MiB and every later file are left out, and a failure message is kept to 8192 UTF-16
  code units while reading. Over a cap the results are partial and `JUNIT_TOO_LARGE` says so. The glob walk shares the
  coverage walk's limits; past them the search stops and some files may not be found.
- **Ids are exact.** A quarantine id matches only a test id spelled exactly the same (see the README, Test id): a test
  renamed, moved to another class or file, parameterized with a new value, or cut past 500 code units with another hash
  does not match. Two tests with the same class name and name are one id. Unicode is compared as written, without
  normalization; zero-width and bidirectional characters stay in an id.
- **No message in the report.** Failure messages go only into the upload's `junit/results.xml`, redacted and cut; a
  secret of a shape the redaction does not know goes with it (Upload to pharn.dev). The 8192-unit read cut comes before
  redaction, so a secret that starts within the kept text and runs past it is cut, not redacted; the 2 KB cut after
  redaction keeps only the first 2048 bytes, so this needs a message whose earlier text redaction shortened by more than
  6000 units.
- **The CLI wrapper.** `pharn-ci test` runs the command without a shell, so `npm test && x`, shell globs and variables
  are not expanded (wrap them in `sh -c '…'` yourself); on Windows a `.cmd` shim such as `npm` must be named as
  `npm.cmd`. It exits `0` only when every matched file was read whole and every failed test is quarantined; a failure
  outside the tests (a build error with no JUnit, a crash before the report was written) keeps the command's code. A
  signal's exit code is `128 + n` as the shell reports it. `junit-include-output` is not shipped: no output is ever read
  or sent.

## Dependency safety

Dependency safety (D01 to D05, `DEPENDENCY_*`) reads the manifests and lockfiles a change touches, at the merge base
and at HEAD, and with lookups on asks the public registries about the packages the change adds. It checks where code
comes from and how new it is, not what it does. What it misses:

- **Only npm and Python.** `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml` (lockfile
  versions 5 to 9), `yarn.lock` (classic and berry), requirements files, `pyproject.toml`, `poetry.lock` and `uv.lock`.
  Go (`go.mod`, `go.sum`), Cargo, Bundler, Composer, Maven, Gradle, NuGet, `Pipfile.lock`, `setup.py`, `setup.cfg`,
  `environment.yml` and `bun.lockb` are not read.
- **Only what is added or changed.** A dependency already in the base is never judged again, however old its risk; a
  version change of an existing package is not looked up (the package was there before). Removed dependencies are only
  counted for D04's "the lockfile did not change" case.
- **Declared sources only.** A registry set outside the lockfile (`.npmrc`, `.yarnrc.yml`, pip configuration,
  `PIP_INDEX_URL`) is not seen. pnpm records no registry host for a registry package, so a private registry configured
  in `.npmrc` is invisible to D05 there; a yarn berry `npm:` resolution is trusted as the configured registry. A
  private registry or mirror that a lockfile does record (Artifactory, Verdaccio, GitHub Packages, a private PyPI
  index) is reported as off the registry (D05): private registries are not supported unless they are on the allowed
  list (a later version may take a policy list with a token).
- **Allowed hosts are exact.** `registry.npmjs.org`, `registry.yarnpkg.com`, `pypi.org` and `files.pythonhosted.org`,
  https only, no user name, password or port. `http://registry.npmjs.org`, a CDN mirror or a regional registry is D05.
- **D04 compares, it does not resolve.** It needs the lockfile to record the manifest's spec as written
  (package-lock.json v2+ and pnpm importers, yarn headers) or, for poetry and uv, the package name. package-lock.json
  v1 records no specifiers, so only "the lockfile did not change" is judged there. A lockfile in an ancestor directory
  counts only when it lists the manifest's directory as an importer (package-lock.json v2+, pnpm) or workspace (yarn
  berry); a classic `yarn.lock` at a workspace root is not matched to a member's `package.json`. For Python, only a
  `poetry.lock` or `uv.lock` beside the `pyproject.toml` counts; requirements files have no lockfile. A lockfile-only
  change fires D04 only when an entry keeps its key and version but its hash of the same algorithm changes (a
  Dependabot-style refresh changes versions and passes); a direct dependency moved to a version outside its declared
  range is not detected (no semver resolution). Python lockfile hashes are not compared.
- **Requirements files.** `-r` and `-c` includes are not followed; environment variables in a line are not expanded; a
  local directory (`-e .`, `./pkg`) is not a dependency, only a local archive (`.whl`, `.tar.gz`, `.zip`) is.
- **Caps.** A manifest or lockfile over 5 MiB, past 100 files or 32 MiB a side is not read and is named in
  `dependencies.unread` (`DEPENDENCY_CHECK_INCOMPLETE`, warn), never guessed; a TOML syntax error makes the whole file
  unread. At most 200 findings are listed (`truncated` counts the rest).
- **Lookups (D01 to D03) are opt-in, Action-only and fail-open.** Scoped npm names (`@scope/x`) are never looked up, so
  a slopsquatted scoped name is not caught; nor are `workspace:`, git, URL and path specs, or names a touched lockfile
  resolves off the registries. At most 50 packages, 4 at once, 5 s each and 60 s per run; a timeout, an error status, a
  redirect, a body that is not JSON or the cap leaves the package unchecked (`DEPENDENCY_LOOKUP_UNAVAILABLE`). A registry
  document over 2 MiB counts as an established package (only long histories are that large), so D02 is not judged for
  it. D02 compares the first publish with the head commit's time, which a commit can set; with no readable commit time
  D02 is not judged. D03 is npm only (PyPI has no first-party download count), and a package with no download count yet
  (a 404 from the downloads API) is not judged. A malicious version of an established, popular package passes D01 to
  D03. The CLI never looks up.
- **No per-signal severities.** D01, D04 and D05 always block and D02 and D03 always warn; the org policy cannot change
  a dependency signal's severity yet (it can turn the whole check on, and raise the minimums).

## Fix hints

Every message and finding of the report carries an optional `fix` object (README, Fix hints). What it does not do:

- **Hints are generic.** There is one kind and one sentence per message code and one per signal id, from two fixed
  tables. A hint never looks at the code, the diff, the test or the package, so it cannot tell a finding that is a
  real problem from one that is meant; it says only what kind of change fixes the finding when it is real.
- **A hint never proves that the fix was made or was right.** Never prove: the report names no change a pull request
  made in answer to a hint, and the next run's report is the only check of the fix.
- **Only the finding's own path or `path:line` is in `target`.** The finding already names it. A message has no
  `target`, so a message that names several files points at none.
- **D04 asks for a review, not a revert.** A lockfile that drifts from its manifest may be a real change, so D04 is
  `request-review`; the hint also says to regenerate the lockfile with the package manager.
- **`none` is a kind, not a gap.** The operational messages (a coverage file that is missing, a policy that could not be
  fetched, a JUnit file that was refused) and the signals no code change fixes (SI01 to SI04 and the policy rules P01,
  P07 and P10) have kind `none`; the hint still says what to check.
- **P12 has no hint.** The schema allows the id, but core produces no P12 finding, so there is no entry for it.
- **A report that did not go through `check()` has fewer hints.** The accept label and the upload outcome add `fix` to the
  messages they create or rebuild and leave the others as they were.

## Org policy

The org policy (`policy: auto`, `required` or `file:<path>`; see the README, Org policy) is fetched, validated and
applied once per run. What it does not do:

- **No persistent ETag cache.** The app's response carries an ETag, but a GitHub-hosted runner starts empty and the
  Action keeps no state between runs (no backend, no cache of its own), so every run asks again and no `If-None-Match`
  is sent. A run that cannot reach the app has no cached copy to fall back on: it runs with the workflow inputs and
  `.pharn/ci.yml` and reports `POLICY_UNAVAILABLE`, or fails under `policy: required`.
- **No connect timeout of its own.** Each attempt has one timeout for the whole request, response body included
  (10 s); there is no separate 5 s connect timeout, so a host that accepts the connection and then stalls costs the
  full timeout, and with the one retry a failing request can take about 21 s.
- **Fork pull requests and jobs without `id-token: write` get no policy.** GitHub gives a fork pull request no OIDC
  token, and a job that does not grant `id-token: write` has none. Under `policy: auto` that is silent apart from one
  info line, and the check runs without the policy; `policy: required` makes it a failing check. The OIDC token is also
  the only identity the app sees, so a repository the app does not know gets no policy (`204` or `404`).
- **A `file:` policy can only tighten.** The pull request carries the file, so pharn-ci applies a threshold, mode,
  `setup.require`, `setup.expect` and signal severities only upwards, and never its exclusions, root, accept label or
  `policy.required`. Because of that, a `file:` document and the same document served by the app give the same
  effective settings only when it is a tightening-only document and no lower layer holds a value above it that the
  app would have named: an app value above a lower layer's is recorded as `looser`, while the same file value above it
  is not, so the two reports then differ by one `POLICY_OVERRIDE_IGNORED` message.
- **The `policy` and `app-url` inputs are the workflow's.** A pull request that edits the workflow can set them
  (THREAT-MODEL, items 22 and 24).
- **Only some keys are applied.** The `setup` lists are applied: `forbidden_files` feeds P08, `forbidden_permissions`,
  `required_permissions_deny`, `allowed_mcp_servers`, `forbidden_mcp_servers` and `required_hooks` feed P02 to P06,
  and `setup.consistency` feeds P07. `policy.rules` applies to P01 to P09, P11, P13 and P14 (P10 cannot be overridden).
  Of `agents`, only `agents.labels`, `agents.extra_logins`, `agents.protected_paths`, `agents.protected_paths_mode`,
  `agents.max_files` and `agents.max_changed_lines` are applied (the first two add to the detection, the next two feed
  P11, the last two P14); `flaky.quarantine` decides whether the app's quarantine list applies to the JUnit results;
  `dependencies` and the other `agents` keys are validated and carried in the document, not applied yet.
- **What P09 sees, and what it misses.** P09 sees four kinds of edit in the diff: (1) the `file:` policy file itself,
  edited or renamed away; (2) the config in use, while `.pharn/ci.yml` holds a setting looser than the policy; (3) a
  file under `.github/workflows/`, while a workflow input is looser than the policy; (4) `.claude/settings.json` or
  `.claude/settings.local.json` and `.mcp.json`, `.cursor/mcp.json` or `.vscode/mcp.json`, at the root or nested. It
  cannot see a pull request that edits the workflow to `policy: never`, removes the pharn-ci step or changes
  `app-url`: the Action then does not run or does not ask for the policy, so nothing is checked against it. TI11 and
  `CONFIG_CHANGED_IN_DIFF` flag such a workflow edit. Class 4 is judged when the files were read: a block when the
  edited file fails P02 to P06 or could not be checked, a warn when it only warns or supplies a required deny rule or
  hook, info when it complies; it stays a warn (direction not judged) when they were not read.

### What P01 misses

- **Only the policy's own requirement counts.** P01 fires for `setup.require` and `setup.expect` in the policy
  document. The same requirement from the `require-agent-setup` input or `.pharn/ci.yml` is checked by the setup scan,
  not by P01.
- **Presence, not content.** A file counts when the inventory lists it: tracked in `HEAD`, by path. An empty file
  counts (it gets `AGENT_SETUP_FILE_EMPTY`), and what a file says is never read.
- **Unknown names are skipped.** A tool name in `setup.expect` that is not on the fixed agent tool list gives no
  finding (the policy validator rejects one in a served or `file:` policy first).
- **Tracked files only.** A file that is not committed, or that `git ls-files` could not list, is not seen.

### What P02–P06 miss

P02 to P06 read the committed agent settings and MCP files in policy mode. They do not see:

- **Settings and hooks outside the repository:** `~/.claude`, managed settings, plugins and the frontmatter of skills
  and subagents can allow, hook or connect what the policy forbids; only the tracked files of the repository are read.
- **Untracked files:** an untracked `settings.local.json` is not read, and a subdirectory Claude Code is started in
  without its own `.claude/` is judged by no unit of its own.
- **What a command does:** rules are compared with rules, never with what a command or a server does. A regex hook
  matcher is never evaluated (two matchers are compared as plain `A|B` lists, otherwise by string equality), and a
  partial overlap neither direction can prove is not flagged: `Bash(git *)` against `Bash(* --force)`, in either order.
- **Two readings:** an allow rule is read broad and a deny rule narrow (grammar rows 15, 27, 38, 46 and 48 are decided by
  it), so a `Write` allow rule overlaps a forbidden `Edit(…)` entry but a `Write` deny rule does not satisfy a required
  one.
- **JSON and JSONC:** the settings files and `.mcp.json` are read as strict JSON, `.cursor/mcp.json` and
  `.vscode/mcp.json` as JSONC (comments and one trailing comma); a file that does not parse is `POLICY_SETTINGS_INVALID`.
- **`defaultMode`:** `bypassPermissions` and `auto` are flagged whatever the Claude Code version.
- **Sandboxing is the boundary.** None of this stops a command from doing what a rule's text did not name.

### What P08 misses

P08 matches the tracked paths of the repository against `setup.forbidden_files`. It does not see:

- **Tracked files only.** The paths come from `git ls-files` of the checkout (in PR-number mode, from the git tree of
  the pull request head through the GitHub API). An untracked or git-ignored file, a file the job creates and a file
  outside the repository are not listed, and a submodule is one path (its gitlink): the files inside it are not.
- **Paths only.** A file is never read, so a forbidden value inside a file with an allowed name is not P08's (check A7
  reads the machine-readable agent config files for committed secrets). A tracked symlink is matched by its own path;
  its target is not followed.
- **The globs of `coverage.exclude`.** Matching is case-sensitive and anchored at the repository root, with no dotfile
  rule: `*.pem` matches a file at the root only, `**/*.pem` one in any directory, and neither matches `key.PEM`.
- **The whole tree, not the diff.** Every tracked path that matches is a violation, files the pull request did not
  touch included, so a pattern added to the policy blocks every pull request until the file is removed.
- **A failed listing.** When `git ls-files` (or the tree request in PR-number mode) fails, the Action step fails and
  the CLI exits 2: no report is built on an empty file list. A tree the GitHub API truncates (a very large
  repository) lists part of the repository, with a warning.
- **At most 50 violations are listed.** The `POLICY_P08` text counts the rest.

### What P11 misses

- **Only agent PRs that identify themselves.** P11 runs for a pull request the detection counts as an agent PR (§9). An
  agent that commits through a person's account with no trailer, label or known login is judged as a person's.
- **Paths only.** The globs are the ones of `coverage.exclude`; P11 matches the path of each diff entry (and a rename's
  old path), never what changed in the file.
- **A `file:` policy always blocks.** A lower `protected_paths_mode` or `policy.rules.P11` is named in
  `POLICY_OVERRIDE_IGNORED` and not applied, because the pull request carries the file.
- **The CLI has no pull request.** It gathers no agent PR facts, so P11 never fires there.
- **At most 50 violations are listed.** The rest are counted in the `POLICY_P11` text, which names up to 20 paths.
- **The merge-base read needs a local diff.** The `file:` policy is read at the merge base only for a diff from the
  local checkout. PR-number mode and the compare API fail closed: an edited policy file then makes the pull request an
  agent PR (`policy-lists-unreadable`).
- **Dependabot and Renovate count as agent PRs.** Protecting `package.json` or a lockfile blocks their updates: do not
  protect files those bots must update.
- **Other `agents` keys are not applied.** `require_human_approval` (rule P12) is validated and carried, not applied by
  this release. `max_files` and `max_changed_lines` feed P14 (below).

### What P14 misses

P14 caps the size of one agent pull request. It is opt-in (no cap is set by default) and counts the diff, not the work.
What it misses:

- **An agent can split the work across many pull requests.** Each is judged alone; nothing adds up the pull requests
  of one task, one agent or one day.
- **Lines are counted from the diff, not by semantic size.** Added plus removed lines, as `git diff` shows them: a
  reformat or a moved block counts in full, a one-line change that is hard to review counts as one line, and a binary
  file counts as a file with no lines. A rename counts once, by its edited lines only.
- **Only the fixed list of generated files is left out.** Lockfiles of the managers the README names, snapshots
  (`__snapshots__/`, `*.snap`) and `*.generated.*` files. Any other generated file (a protobuf stub, a vendored
  bundle, a migration a tool wrote) counts unless `coverage.exclude` matches it.
- **`coverage.exclude` is not used when the pull request edits the config in use or a workflow,** unless the app policy
  sets the exclusions; then every file those patterns would have left out counts, and a pull request that only
  reformats its config can go over the cap. Without such an edit, exclusions the workflow inputs or `.pharn/ci.yml` set
  apply, and a repository whose config already excludes wide paths counts less.
- **Only agent PRs that identify themselves.** As for P11 (§9): an agent that commits through a person's account with
  no trailer, label or known login is judged as a person's, and the CLI, which has no pull request, never runs P14.
- **An unreadable merge base fails closed only while the file still sets a cap.** When the merge-base `file:` policy
  cannot be read (PR-number mode, a compare-API diff), a pull request that edits the file and removes every cap is not
  checked, the same gap P11 has for removed protected paths; the pull request still counts as an agent PR.

### What P07 misses

P07 compares what the agent instruction files of one directory tell an agent to run. It is a heuristic at `warn`, not a
review of the instructions. What it misses:

- **Prose is never read.** Only inline code spans and shell blocks count. "We use pnpm" in a sentence declares nothing,
  and neither does `pytest` or any other tool outside `npm`, `pnpm`, `yarn`, `bun`, `vitest` and `jest`: a Python
  package's files are never compared on their own tools.
- **Same-directory scope only.** A file is compared with the other instruction files of its own directory (a nested
  `.cursor/rules/` or `.claude/rules/` belongs to the directory that holds it; every other kind belongs to the root).
  A root file and a nested `AGENTS.md` that name different tools do not contradict.
- **Tools in indented, non-shell or multi-line code are missed.** An indented code block, a `json`, `python` or other
  non-shell fence, a command split over several lines and a command in a console line without a prompt declare nothing.
- **Negation is a word heuristic.** A span after a cue word ("don't", "instead of", "never"), before "is not" or
  "isn't", or under a heading with such a word is skipped. A list continuation (``Don't use `npm` or `yarn` ``) negates
  only the first span, and a file that names pnpm among others never contradicts a pnpm file.
- **Pattern-scoped files are skipped.** A file limited to path patterns (`globs`, `applyTo`, `paths` or
  `fileMatchPattern` in its frontmatter, other than every file) is not compared; agent-requested and manual rules count.
- **Skills, commands, agents and prompts are not read.** Only the instruction kinds are.
- **`npx` and `bunx` and global installs declare nothing.** `npm i -g x` names no package manager, and `pnpm --filter x
  vitest` is missed because the runner is not the first argument.
- **A file that contradicts itself is not reported.** Only two files of one directory can contradict.
- **A tracked symlink is read as its link text.** Nothing is followed.
- **Caps.** At most 200 files, 512 KiB each and 16 MiB in all are read. A file dropped past a cap, as binary, as too
  large or at an unsafe path is one path-less violation at P07's severity, because a pull request can cause it; a path
  that is not a file at `HEAD` is `info`. At most 50 violations are listed (the rest are counted), and the message names
  up to 20 files.
- **The Action reads only with a local diff.** In PR-number mode and with a compare-API diff the checkout may not be the
  pull request head, so nothing is read and one `info` violation says so.
- **P07 runs only under a policy.** With no policy, `policy: never`, an unavailable policy or P07 switched off, no
  instruction file is read. A `file:` policy never lowers it below `warn`.

### What P13 misses

P13 compares the structure of four kinds of file between the merge base and HEAD for an agent pull request. It is a
text guard on what the files declare, not a sandbox. What it misses:

- **Only agent PRs that identify themselves.** As for P11 (§9): an agent that commits through a person's account with
  no trailer, label or known login is judged as a person's, and a person's pull request is never subject to P13.
- **Powers widened through code a file calls.** A hook that runs `node .claude/hooks/guard.cjs` keeps its command when
  the script is rewritten to do nothing; an MCP server whose `command` stays the same runs whatever the package or
  script it starts now does; a workflow step that runs a repository script keeps its line. Protect those scripts with
  P11's `agents.protected_paths` or CODEOWNERS.
- **Settings the repository does not track.** An untracked `.claude/settings.local.json`, user-level
  `~/.claude/settings.json`, managed settings and other tools' settings formats are never read.
- **Only the named keys.** A settings change to `env`, `apiKeyHelper`, `model`, `permissions.ask` or any key not listed
  in the README, and an MCP change to `env` or `headers`, is not a widening. An MCP server's name is its identity: a
  server renamed is one added.
- **Workflows are read line by line, not as YAML.** The reader follows block mappings; a file with an anchor, alias,
  merge key or tag, tab indentation, a second document, `jobs` or a job written as a flow mapping, or a U+0085, U+2028
  or U+2029 anywhere (a YAML 1.1 parser breaks lines there, this reader does not) cannot be compared and is one
  violation (fail closed). A multi-line flow list or quoted scalar that spells a key is read as written.
  Secret references are counted anywhere in the text, comments and run scripts included, and a `pull_request_target`
  outside comments and block scalars counts as the trigger, so a mention can count (the cost falls on agent PRs only).
- **What a workflow does elsewhere.** A reusable workflow called from another repository, a composite action, an
  environment's protection rules and its secrets, repository and organization settings (the default token permissions
  among them) and other triggers that run with secrets (`workflow_run`, `issue_comment`) are outside it. A workflow with
  no `permissions:` block gets the default token permissions; a block added there counts only when it grants `write`, a
  scalar such as `read-all`, or a value that is not a level.
- **Deleted workflows.** A deleted workflow, and a deleted job, widens nothing: it no longer runs.
- **CODEOWNERS adds are allowed.** Owners added to an unchanged rule line pass, even the agent's own account; every
  other change, an added and a deleted CODEOWNERS included, counts. A line with white space other than a space or a tab
  (a no-break space, U+FEFF) or with U+0085, U+2028 or U+2029 in it, a comment line included, passes only when it is
  unchanged: GitHub may split it into owners or lines differently. Branch protection and rulesets, which decide
  whether code owners must approve, are outside it.
- **Renames are a deletion and an addition.** A renamed settings file loses its deny rules and hooks at the old path and
  gains its allow rules at the new one, so a pure rename counts.
- **The Action reads only with a local diff.** PR-number mode and a compare-API diff leave every touched file
  uncompared (one violation each), and a file dropped past the caps of the test sources (200 files, 512 KiB each, 16
  MiB in all), as binary or missing on a side it should exist on is uncompared too.
- **The CLI has no pull request.** It gathers no agent PR facts, so P13 never runs there.
- **At most 50 violations are listed.** The rest are counted in the `POLICY_P13` text, which names up to 20 paths.

## Upload to pharn.dev

The upload (`upload: auto`; see the README, Upload to pharn.dev) sends the redacted `report.json` and `meta.json` of a
run. What it does not do:

- **No connect timeout of its own.** Each request has one timeout for the whole exchange, response body included (60 s
  for the two requests to the app, 120 s for the `PUT`), and the whole upload ends within 90 s of its start: a request
  or the `PUT` is cut off at the smaller of its timeout and the time left, and a step with no time left does not
  start. There is no separate connect timeout, so a host that accepts the connection and then stalls uses up the time
  left. The two app requests are retried once after a network error or a `5xx` when at least 2 s are left; the `PUT`
  is never retried. The lookup of the pull request comment (GitHub API) counts toward the 90 s but has no timeout of
  its own.
- **One upload per job run, not per matrix leg.** The report and the upload are those of one job. A matrix of jobs
  uploads once per leg, and the run identity the Action sends is the run id, the run attempt and the `scope`
  (`<workflow>/<job>`), none of which carries the matrix values: two legs of one job share all three, so the app may
  treat them as one run.
- **A `404` from the app is "not installed", whatever the cause.** The app answers `404` when the organization has not
  installed the Pharn GitHub App for the repository, and also for a repository it does not know. The Action cannot
  tell them apart, so it logs that the app is not installed and adds the install hint to the comment and the summary.
- **The hint is not a policy check.** The line under the summary (`Install the Pharn GitHub App for org policy, history
  and flaky detection.`) appears only after a `404` to the policy request or to the upload, once when both get one;
  it says nothing about whether a policy exists (a `204`, no policy yet, gets no hint), and a run without an OIDC
  token (a fork pull request, a job without `id-token: write`) gets no hint.
- **A `pull_request_target` run is never uploaded.** Its default checkout is the base branch, which pharn-ci refuses to
  measure (`DIFF_UNAVAILABLE`), so the Action asks for no upload token and sends nothing on that event, whatever
  `upload` says and whatever was checked out; the report says `meta.upload.status: skipped`. The org policy request of
  such a run still happens.
- **Redaction misses what it does not know.** The report is redacted with the ten secret shapes of the agent config
  scan (README, Secrets in agent configs) and cut to the upload's message cap per message and signal detail; a secret
  of another shape, split across strings or encoded, is not found. Paths and test names are not secrets to it and are
  sent as they are. The cap is the smaller of 2048 bytes and the org's `settings.messageMaxBytes` from the same run's
  policy response, used only when that response was a `200` that validated whole (never under `policy: never` or a
  `file:` policy, never from a refused or missing response); the app can lower the cap, never raise it.
- **`settings.redactMessages` is validated and not applied.** The Action never turns redaction off.
  `settings.uploadJunit: false` keeps the JUnit results out of the upload; the response's `quarantine` list is applied
  to the JUnit results (see Flaky tests and JUnit results).
- **The JUnit results are rebuilt, not sent.** With JUnit results, the archive also holds `junit/results.xml`, rebuilt
  from the parsed cases; a failure message is redacted like a report message and cut to the same cap, other strings to
  4096 bytes. `sizes.junit` is the size of that file compressed on its own, an estimate of its share of the archive;
  `sizes.report` stays the size of the whole archive. A `junit/results.xml` over 25 MiB is `UPLOAD_TOO_LARGE`.
- **`meta.mergeBase` is the fork point of the pull request's head, and `null` means "not known to the Action".** When
  the run has a local diff, the Action records the merge base of the resolved base and the run's head commit
  `meta.headSha` (the pull request's head, not GitHub's merge commit that `pull_request` checks out, so on that event it
  is where the pull request forked, not the base tip). `null` is not "these commits share no history". It means the
  Action did not learn it: the diff did not come from local git (the compare API, `pr-number` mode, no base, or a base
  at or past `HEAD`), the run has no run metadata, or `git merge-base` failed because the head commit or the base
  history is not in the checkout (a shallow `actions/checkout`; `fetch-depth: 0` fixes it). A shallow checkout can
  also make git print a common ancestor that is not the real merge base, and the Action cannot tell it from the real
  one; the fork point is an answer of the checkout, only as deep as the history there. It never fails the run or
  changes the verdict.
- **The CLI never uploads.** Only the Action does; the CLI makes no network call.
- **A report over the limit is not uploaded.** A `report.json` over 5 MiB (5242880 bytes), a gzip archive over the
  `maxBytes` the app names, or a `413` from the app ends in `UPLOAD_TOO_LARGE`; the check ran in full and only the
  history misses the run. A `413` is also what the app answers to a size it will never take; its body is not read, so
  the upload names no limit then (`maxBytes: null`): the app's API defines no body for a `413`.
- **No retry of a registered run.** The register request can reach the app twice when its first answer is lost to a
  network error or a `5xx`; the app answers a repeated run with `200` and the upload counts as `ok` then.

## 5. Security limits

- **The report is derived from untrusted input.** File paths, coverage data and the config file
  come from the change under review. pharn-ci neutralizes what would break the PR comment's markdown
  (control characters, HTML in messages), but the numbers are only as honest as the coverage file
  the PR's own test run produced. pharn-ci cannot detect a test run that was altered to write a
  favorable coverage file.
- **Exclusions come from the PR.** `coverage.exclude` lives in `.pharn/ci.yml` and the Action's
  `exclude` input in the workflow file, both of which the change under review can edit. A PR can
  exclude its own files, ultimately all of them, which passes as `NO_COVERABLE_CHANGES`. The gate
  is only as honest as the config the PR carries. Protect `.pharn/ci.yml` and the workflow with
  CODEOWNERS so changes to them need a code owner's review.
- **A PR controls the inputs that grade it.** Besides the config and the workflow, it can add a
  committed coverage file or change `.gitattributes`: `*.ts -diff` makes `git diff` print
  `Binary files ... differ` with no line counts, so those files' added lines are never measured.
  pharn-ci flags these with three warnings, `CONFIG_CHANGED_IN_DIFF` (the diff touches the config in
  use or a file under `.github/workflows/`), `COVERAGE_FILE_TRACKED` (the coverage file is a tracked
  file) and `DIFF_BINARY_COVERED_FILE` (the diff shows a file the coverage report knows as binary).
  They are warnings only, never a `fail`. pharn-ci does not read the base branch's copies of these
  files and does not detect changes to `.gitattributes` itself.
- **Coverage and config paths are not confined to the repository.** They are resolved against the
  workspace (Action) or the current directory and repo root (CLI), and may point anywhere the job
  can read, such as `$RUNNER_TEMP`. A literal coverage path is opened as given, so a symbolic link
  there is followed, including one that points outside the repository; only glob matching and
  auto-discovery skip symbolic links. The file is only parsed as coverage (lcov or Cobertura) or
  config and its contents are not echoed, with one exception: when no path in the coverage report
  matches a tracked file, `COVERAGE_PATHS_UNMATCHED` quotes one example path from the report and a
  suggested root. The coverage file's own path appears in `COVERAGE_FILE_MISSING`,
  `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `COVERAGE_FILE_TRACKED` messages.
- **Input sizes are not capped.** No input has a size limit of its own, except the text of the test and
  test-config files (section 8). The local diff and lcov
  coverage are read line by line, so memory holds what they yield, not their text; Cobertura coverage
  and the config are read whole. The output of `git ls-files` and `git ls-tree` is limited to 256 MiB.
  A hostile file can make the job slow or run out of memory; it cannot make pharn-ci write anywhere
  but `report.json`, the job summary and its PR comment. Section 8 lists what each input costs and
  how it fails.
- **A bug in pharn-ci's own code fails the run.** Only the call to a third-party function that can fail on the
  input (TypeScript's `createSourceFile`, `JSON.parse`) is wrapped in a `try`; a file the parser throws on is refused
  as before (`too-deep`, `parser-threw`, `syntax-error`, `invalid-json`). An exception from pharn-ci's own test-file
  walk, test-config readers, Python output mapping or policy validator is not caught: it escapes `check()` (or the
  step that runs before it), so the Action step fails and the CLI exits 2, and that run's report, comment and upload
  are lost. That is the accepted trade: a failed run, not a gate that passes or an index reported unavailable because
  of a bug. One catch-all remains: `readPolicyFileAt` (the merge-base copy of an edited `file:` policy) reads any
  failure as `unreadable`.
- **pharn-ci cannot protect the job from the PR.** On `pull_request`, the PR's own code (its tests)
  runs in the same job before pharn-ci does. pharn-ci's guarantees are about what pharn-ci itself
  does with the token and with the input it reads.
- **PR-number mode depends on the GitHub API.** With the `pr-number` input, the diff comes from the
  compare API, so it is subject to GitHub's size limit for compare diffs (a diff over it is
  `DIFF_UNAVAILABLE`), and the file list comes from the git trees API. For a very large repository
  that listing is truncated: pharn-ci warns, and the agent setup scan, the secret scan and the org policy's
  forbidden-file rule (P08) may miss files. The coverage
  file still comes from the workflow, so a forged one can flatter its own PR; the `pull_request`
  run's verdict is the gate, not the comment.

## 6. Distribution

- **Pre-1.0.** Each report version, v1 and v2, is stable within itself (fields are only added; codes are never
  renamed).
  Inputs, outputs and message codes are never removed before 1.0, and a renamed input keeps its old
  name, with a warning, for at least one minor release. Defaults may still change, but only in a
  minor release listed under **Changed** in the changelog, and the comment layout may change in any
  release ([`RELEASING.md`](./RELEASING.md#inputs-outputs-and-message-codes)).
- **The CLI is not published to npm yet.** Build it from source (`pnpm install && pnpm build`).
- **The Action runs on the runner's Node 24** (`runs.using: node24`).
- **Platform.** Developed and tested on Linux and macOS. The Action is tested on `ubuntu-latest`
  only.

## 7. Coverage path mapping

- **Paths are matched exactly against `git ls-files`.** After normalization, every path in the
  coverage report is compared with the tracked files, case-sensitively. pharn-ci reads no files,
  so a tracked path is the only evidence a coverage path names a real file.
- **No path matches: `COVERAGE_PATHS_UNMATCHED`.** Diff coverage is not computed, and the report
  says so instead of passing as `NO_COVERABLE_CHANGES`. It is an error, and the verdict `fail`,
  with a threshold (0 included), and a warning without one. When a tracked file ends in a
  coverage path at a path-segment boundary, the message suggests the directory in front of it as
  the coverage root. The hint is a suggestion, never applied.
- **Some paths do not match: `COVERAGE_PATHS_PARTIALLY_UNMATCHED`.** An `info` message with the
  count. Those files' coverage is not used, and the verdict is unchanged.
- **A coverage root fixes package-relative reports.** `coverage.root` in `.pharn/ci.yml`, the
  Action's `coverage-root` input and the CLI's `--coverage-root` flag (the input and the flag win
  over the config) name the repo-relative directory that relative coverage paths start from. It is joined in front of paths that are relative as written, and never in front of an
  absolute one. It is one root for the whole report: a report that mixes packages cannot be mapped
  with it.
- **Absolute paths from another root are reported, not remapped.** A Docker build's `/app/src/a.ts`
  stays unmatched, and so do paths through a symlinked workspace. Write coverage paths relative to
  the repository, or as absolute paths under the checkout path.
- **Both checks are skipped when the tracked-files list is empty** (a repository with no tracked file). A failed
  `git ls-files` no longer gives an empty list: the Action step fails, as the CLI does.
- **A changed file missing from the coverage report is never looked at here.** The checks read the
  coverage report's paths only, so a docs-only change with mapped coverage still passes as
  `NO_COVERABLE_CHANGES`.

## 8. Size limits

Which inputs have a size limit, what it is, and what you see when it is passed. Only the text of
the test and test-config files has caps set by pharn-ci (the last bullet); every other input is
limited by git, Node or GitHub alone.

- **The diff.** From local git (the CLI, and the Action when the checkout has the base) it is read
  line by line as git writes it, with no fixed limit. Memory holds the changed paths and their added
  line numbers, plus the text of added and removed lines for test files, the pharn-ci config in use, workflow files, every `package.json` and the JavaScript, TypeScript and Python source files only, capped at 5000 lines
  per file and 400 characters per line (`textTruncated` marks a file cut at the cap). The pytest config files
  (`pytest.ini`, `pyproject.toml`, `setup.cfg` and `tox.ini`) keep their text too, for TI08. A finding past the cut is not
  seen. When a signal reads the cut file (a test file in JS/TS, Python or Go, a workflow, a modified `package.json`, a
  pytest config file, a source file or the pharn-ci config) and the file is not deleted, the report adds `TEST_INTEGRITY_TEXT_TRUNCATED`
  (`warn`) naming it, so a change cannot pass in silence by padding a file past the cut. A deleted file is not named:
  TI01 already counts a cut test file. For the prompt-injection scan it also keeps the full text of the added lines
  of every file outside the scan's default exemptions, apart from that: at most 50,000 lines per file and 8,000,000
  characters across the diff (`addedTextCut` marks a file cut there, and `INJECTION_TEXT_TRUNCATED` names it). The 120 s git
  timeout still applies. From the GitHub compare API (the
  Action's fallback, and PR-number mode) it is limited by GitHub's own compare limit; past it the
  diff is unavailable and the report says `DIFF_UNAVAILABLE`.
- **lcov coverage.** Read line by line from the file, with no fixed limit. Memory holds the coverage
  map (a hit count per covered line), not the text. One single line longer than the longest string
  the JavaScript engine can build still fails with `Invalid string length`: the CLI exits 2 after
  `pharn-ci:`, and the Action step fails.
- **Cobertura coverage.** The XML is read whole, as one string. Past about 512 Mi characters the
  engine's own error, `Invalid string length`, ends the run: the CLI exits 2 after `pharn-ci:` and
  the Action step fails, with or without a threshold. The error is not reworded. Use lcov for a
  report that large.
- **The config.** `.pharn/ci.yml` is read whole. A file past what Node can read as text fails with
  Node's own error: the CLI exits 2 and the Action step fails.
- **The `git ls-files` output.** It is read through a 256 MiB buffer. Past it the CLI exits 2 and
  the Action step fails.
- **The `git ls-tree` output.** It is read through a 256 MiB buffer and is optional. Past it, empty
  agent setup files are not reported, and the rest of the check runs.
- **The text of the test and test-config files.** For a diff read from local git, the CLI and the Action
  read, from committed git objects, the text of the test files and the test-config files (`vitest.config.*`,
  `vite.config.*`, `vitest.workspace.*`, `jest.config.*`, `playwright.config.*`, `.mocharc*`, `pytest.ini`, `pyproject.toml`,
  `setup.cfg`, `tox.ini`, `conftest.py` and `package.json`, by basename at any depth) that the change touches: the
  base side at the merge base, the head side at `HEAD`. Three caps apply to each side, with fixed values that no input,
  flag or config key changes: at most 200 files, at most 524288 bytes (512 KiB) per file, and at most 16777216 bytes
  (16 MiB) in all. Paths are taken in code-unit order, so which files are read does not depend on the order of the
  diff. A selected file that is not kept is dropped with one reason, tried in this order: `unsafe-path` (a control
  character, a leading `/`, or an empty, `.` or `..` segment in the name), `missing` (absent at that revision, or not
  a blob, such as a submodule), `too-large` (more than 524288 bytes), `over-file-cap` (the 201st file and later),
  `over-total-cap` (the file that would take the side past 16777216 bytes, and every later path of that side that has
  no earlier reason: the first file past the cap ends the reading, even if a later file is small), and `binary` (found after reading: a 0x00
  byte, or bytes that are not well-formed UTF-8). A file found binary still counts toward the file and total caps.
  A diff from the GitHub compare API (the Action's fallback) or from PR-number mode gets no text: both sides are
  marked unavailable and nothing is fetched. When git fails, both sides are unavailable, the CLI writes one line to
  stderr and the Action one log line naming the failed git step, and TI02 and TI05 do not run. In a partial clone a
  blob that is not local is `missing`, never fetched (`GIT_NO_LAZY_FETCH=1`; an older git ignores the variable). The
  diff itself (`git diff`) runs without that variable, so in a partial clone (`filter: blob:none`) git fetches the
  blobs the diff needs from the remote: that is how such a checkout gets a diff at all. Without the network that
  diff fails, and so does the step. A symlink test file is read as its link target path. TI02 and TI05 read this text for the JavaScript, TypeScript and
  Python test files the diff modifies (and the added ones, as places a test can move to). A touched test file that has
  no text on a side (any drop reason above), or that the test index refuses, is not compared: the report names it in
  `TEST_INTEGRITY_INDEX_UNAVAILABLE` with the reason code, an added one in a sentence of its own (its tests are not
  checked), and when a side of the sources is unavailable and the diff modifies a test file, the same message says
  that TI02 and TI05 did not run. When the sources are unavailable and the diff only adds test files, nothing is
  named: no file has text, and an added file cannot hide a weakened existing test. The test index adds its own refusals:
  more than 524288 UTF-16 code units of text (`too-large`), more than ten syntax errors (`syntax-error-heavy`) and a
  syntax tree deeper than 1000 nodes (`too-deep`); the Python index adds the 30 s interpreter timeout, 64 MiB of
  output and its own caps of 200 files, 512 KiB per file and 16 MiB in all, shared by the base and head files of one
  run, so a large change can have its later Python files refused as `too-large`. A body is compared by its first 4000
  characters. Matching a test with a similar one probes at most 256 candidates per test, so a file of thousands of
  near-identical bodies can report a renamed test as removed. At most 20 TI02 and 20 TI05 findings are listed per file;
  the messages say how many were left out, and the block findings come first. The action and CLI dists carry the
  TypeScript parser for this and are about 11 MB.

## 9. Agent-PR detection

`meta.isAgentPr` in the Action's report says whether the pull request counts as an agent PR. What it does not do:

- **Metadata only.** It reads the pull request's author, labels and commit count, and its commits' authors, committers
  and `Co-authored-by` trailers. It never reads the diff or any file, and it says nothing about who wrote the code. An
  agent that commits through a person's account with no trailer, label or known login counts as human.
- **Commits are read through the API, at most 3 pages of 100.** A pull request of more than 250 commits, a commit count
  that does not match the list, a page that cannot be read and a list cut at the third page all count as an agent PR:
  evidence that cannot be read in full fails closed. The Action says so in one fixed log line.
- **Dependabot and any `[bot]` author count as agent PRs.** So does a pull request whose author is not a user, a bot or
  an organization (a deleted account, a Mannequin) or is missing.
- **Labels are read as the event delivered them.** A label added after the event started the run is not seen until the
  next run.
- **The known-agent list holds only the seven verified entries** (Claude Code, Copilot, Codex, Devin, Cursor, Gemini and
  Jules). Another agent is recognized only by a `[bot]` login, a label or a `Co-authored-by` trailer of a login on the
  list.
- **Only the org policy adds labels and logins.** `agents.labels` and `agents.extra_logins` of the org policy add to the
  defaults and never remove one; no `.pharn/ci.yml` key and no input does. A `file:` policy the pull request edits
  counts with the lists it has at the merge base too, and when that version cannot be read the pull request counts as
  an agent PR.
- **A human co-author is never recorded.** Only trailers of known agents reach the report, as a hint and an address.
- **The CLI does not set it.** Only the Action gathers pull request facts. On its own the detection changes no verdict,
  message, comment or exit code; under a policy with protected paths, rule P11 uses it (see Org policy).
