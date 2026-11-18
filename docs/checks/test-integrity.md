# Test integrity

Diff coverage says which added lines a test ran. Test integrity looks at the other side of the change: did it make the
tests weaker? The `test-integrity` input takes `block`, `warn` or `off`, and the default is `warn`.

- `block`: a block-level finding fails the check.
- `warn`: a block-level finding warns and does not fail the check.
- `off`: nothing is checked.

`test_integrity.mode` in `.pharn/ci.yml` can only make the mode stricter, never looser, so a pull request cannot loosen
its own gate by editing the config. The signals so far are TI01, TI02, TI03, TI04, TI05, TI06, TI07, TI08, TI09, TI10,
TI11, TI12, TI13, TI14, TI15, TI16 and TI17:

| Signal | What it reports | Severity in mode `block` | JS/TS | Python |
| --- | --- | --- | --- | --- |
| TI01 | a test file deleted, or renamed to a name that is not a test file's | block; `info` when the change also deletes the code it tested, or its tests are found again by body; never `info` for a test file git shows as binary | yes | yes |
| TI02 | a test removed from a test file that stays | block; `warn` for a computed name | yes | yes |
| TI03 | a skip added to a test | block for an unconditional skip of an existing test; `warn` otherwise | yes | yes |
| TI04 | a `.only`, `fit` or `fdescribe` added | block | yes | not applicable |
| TI05 | a test emptied of its assertions, or with fewer | block when none are left; `warn` for fewer, and `warn` when none are left but the test calls a function whose name suggests an assertion helper (it starts with `check`, `verify`, `assert`, `expect`, `should`, `validate` or `ensure`) | yes | yes |
| TI06 | a test weakened: a weaker matcher, a lower assertion guard, an assertion that compares a literal with itself, or an assertion moved into a `try`/`catch` or after an early `return` | `warn` | yes | yes |
| TI07 | an expected value of a test edited to match, in a change that also edits source | `warn` | yes | yes |
| TI08 | snapshots regenerated or updated in bulk | `warn` | yes | yes (pytest config) |
| TI09 | a test-runner setting loosened | block; `warn` for a raised retry count or timeout, a narrowing key set in a config new at head, or a value that is not a literal | yes | yes |
| TI10 | a test script in `package.json` weakened | block | yes | no |
| TI11 | CI stopped running tests | block for a removed test command or `pull_request` trigger; `warn` otherwise. A command that only gains report flags from an allow-list (`--coverage`, `--coverage.enabled`, `--cov`, `--cov=<value>`, `--cov-branch`, `--cov-report`, `--coverage.reporter`, `--coverage.provider`, `--coverage.reportsDirectory`, `--coverageReporters`, `--coverageProvider`, `--coverageDirectory`, `--reporter`, `--reporters`, `--junitxml`, `--ci`, and `-v` or `-q` for pytest, `python -m unittest`, tox and `go test`; `docs/LIMITS.md` has the exact spellings) is the same command; anything else it gains (a path, `-k`, a shell operator, a flag that narrows or turns off coverage such as `--coverage.exclude` or `--cov-config`, another flag) is a removal | yes | yes |
| TI12 | a module under test mocked: a new `vi.mock`, `jest.mock` or Python `patch` of a source file the change also edits | `warn` | yes | yes |
| TI13 | a coverage-ignore comment added to source | block; `warn` for a hint that marks one line or branch (`# pragma: no cover`, or an Istanbul, V8 or C8 `ignore next`, `ignore if` or `ignore else`) in a file the change adds. A whole-file or range hint (`ignore file`, `ignore start`, `ignore next` with a count) in a new file, and any hint added to an existing file, is a block | yes | yes |
| TI14 | a lower coverage threshold or a wider exclusion in the pharn-ci config | block | yes | not applicable |
| TI15 | a source condition that compares with a value the tests add | `info` | yes | yes |
| TI16 | a lint or type suppression comment added to a test file | `info` | yes | yes |
| TI17 | an assertion that always passes: a custom matcher whose pass is always true, a Python helper that always returns True, or a wildcard in place of an expected value | `warn` | yes | yes |

In mode `warn` every `block` above is a `warn`. TI06, TI07, TI08, TI12 and TI17 warn and TI15 and TI16 give an `info`
finding in both `block` and `warn`, so those seven never fail the check. Each reads the diff, and TI02, TI05, TI06, TI07 and TI12
also read the text of the JS/TS and Python test files the change modifies at the merge base and at HEAD, parsed without
running them: a test counts as removed only when no test of the same name or a similar body is left in the touched test
files (a test of the same name in another touched file counts only when it holds the removed test's body), and
`TEST_INTEGRITY_INDEX_UNAVAILABLE` names a file that could not be compared, and an added test file whose tests
could not be read (so nothing checked them). TI09 reads the text of the touched
test-runner config files the same way (`vitest.config.*`, `vite.config.*`, `vitest.workspace.*`, `jest.config.*`,
`playwright.config.*`, `.mocharc.*`, `package.json`, `pytest.ini`, `tox.ini`, `setup.cfg` and `pyproject.toml`) and
compares a fixed list of settings between the two: a lowered coverage threshold, a narrower test list (`include`,
`testMatch`, `testpaths`, `spec`), a wider exclusion (build directories, `node_modules` and `.d.ts` files excepted),
`passWithNoTests`, `allowOnly` or `bail` turned on, a `grep` added, `forbidOnly` turned off, or a pytest `addopts` that
gains `-k`, `-m`, `--deselect`, `--ignore` or `-x`. A raised retry count or timeout is a warning only, and so is a value
that is not a literal and cannot be compared; a modified config that was read at the merge base but cannot be read or
found at HEAD (an opaque wrapper, a file padded past the size cap) is a finding at the mode's level. When a change adds, removes, modifies or renames tests, the comment also
holds a collapsed "Tests changed" table with the counts per test file; the test names are in `report.json` only. A
reviewer who is not the author can sign off block findings with the accept label: see [Accept label](../action.md#accept-label).

**Tests exercise the changes.** Next to the signals, the check asks whether the tests of the change touch the code it
changes. A changed JavaScript or TypeScript source file (one with at least one added line; test files, `.d.ts` files,
config files such as `vite.config.ts` or `.eslintrc.cjs`, `dist/`, `vendor/`, `node_modules/`, minified, `*.generated.*`
and `coverage.exclude` files are not asked) counts as exercised when a JS/TS test file the change adds or modifies
imports it directly with a relative import (`./cart`, `../src/cart.js`, a directory's `index`) and keeps or raises its
assertion count. A changed Python source file counts as exercised when a Python test file the change adds or modifies
imports it (`import pkg.cart`, `from pkg.cart import total`, `from . import cart`, at the repository root or under
`src/`) and keeps or raises its assertion count; without a usable `python3` for the touched Python test files, Python
files are not asked. When at least one changed source file is not exercised, the report carries one
`TESTS_NOT_EXERCISING_CHANGES` warning with the counts and up to 10 paths, `testIntegrity.exercise` lists up to 200
paths, and the comment shows one line under "Test integrity" with a collapsed list. It is a warning in every mode and
never fails the check; many pull requests that change code without a test will see it, on purpose. It reads only the
test files the change touches, whose text the signals above already read, and runs no test. Import aliases, workspace
packages, re-exports through another source file and per-test coverage are not followed: see
[docs/LIMITS.md](../LIMITS.md#what-the-tests-exercise-check-misses).

Python test files are parsed with the runner's own `python3` (or `python`), 3.8 or newer, and only when the change
modifies one. When neither `python3` nor `python` is found on the runner, TI02 and TI05 do not run for that change
(`TEST_INTEGRITY_INDEX_UNAVAILABLE`), and the diff-only signals still run; an added `.py` test file alone is only
named (warn). A Python older than 3.8, or a Python run that fails, does not stop them: the modified `.py` test files
are named in that message (warn) and the signals that compare test text skip them. When TI02 and TI05, or TI09, did
not run at all because the test text could not be read (a shallow checkout, or `pr-number` mode), or because no
Python was found, that message is an error in `test-integrity: block`, so the check fails closed. A test file the
change modifies that cannot be read at HEAD (nested too deeply, over 512 KiB, pushed past the 200-file cap) is an
error in `block` too, and so is a JS/TS, Python or Go test file the change modifies that has
more than 5000 changed lines; the accept label lowers both. An added test file and a file already unreadable at the
merge base stay a warning. The test files the change modifies are read before the added and deleted ones.
The Python parser has its own cap of 200 files, shared by the merge base and HEAD: a modified `.py` test file counts once on each side and an added
or deleted one once, so about 100 modified `.py` test files (fewer when the change also adds or deletes some) can push
a modified one past it at HEAD, which is also an error in `block`.

The block signals were measured on 600 merged pull requests of three open-source vitest repositories: TI01, TI02 and
TI11 each falsely block 1 of 600 (0.17 %). The method, the reviewed findings and the warn and info signals' sampled
precision are in [docs/PRECISION.md](../PRECISION.md#official-results-v030-2026-10-26).

This is the "Test integrity" section of the report for a change that turns `it(` into `it.skip(` in
`src/cart.test.ts`, in mode `block`:

> ### 🔍 Test integrity
>
> - ❌ **TI03** `src/cart.test.ts:12` — An unconditional skip was added to a test that the diff shows existed before this change, so that test no longer runs.
>   - Hint: Remove the skip so the test runs again, or say in the PR why it must stay, for example a test that fails in CI; a reviewer who is not the PR author can record that sign-off by applying the accept label `pharn/accepted`.

The benchmark for this is Skylos's list of nine ways to hide a failing test. The nine cases are reproduced in vitest
under `fixtures/skylos-nine/` and pinned by tests: the signals of v0.11.0 catch **8 of 9** (`deleted-test` by TI01,
`added-skip` by TI03, `emptied-assertion` by TI05, `deselect-setting` by TI09, `replaced-test` by TI02,
`loosened-assertion` by TI06, `edited-expected-value` by TI07 and `always-true-matcher` by TI17). The other one is
missed: TI15 exists and misses `hard-coded-answer`. What each signal misses is in [docs/LIMITS.md](../LIMITS.md#what-test-integrity-does-not-catch).

The same nine are reproduced for pytest under `fixtures/skylos-nine-pytest/`, where the signals catch **8 of 9**; the
case-by-case table is in [docs/PRECISION.md](../PRECISION.md#3-skylos-nine-what-pharn-ci-catches).
