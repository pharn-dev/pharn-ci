# pharn-ci — Limits

What pharn-ci does **not** guarantee, stated plainly. pharn-ci is pre-1.0 (latest release: `v0.2.0`).
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
  recognized only by name: `.test.` or `.spec.` with a JavaScript or TypeScript extension, `.e2e.ts`,
  `.pw.ts`, `test_*.py`, `*_test.py`, `*_test.go`, or any file in a `test`, `tests` or `__tests__`
  directory. An added skip or focus marker in a test file is TI03 or TI04. A weakened assertion, an emptied test
  body and a test case deleted from a file that stays are not detected yet (see "What test integrity does not
  catch" below).
- **What TI01 misses.** TI01 reads line patterns, not syntax. (1) A test file counts only if its
  removed lines start with `it(`, `test(`, `describe(`, `context(`, `specify(`, `def test_` or
  `func Test`; a test written another way (a custom wrapper, a `Deno.test(` call) reads as not
  defining tests. (2) A source file of the same name deleted anywhere in the change makes the
  finding `info`, so an unrelated `foo.ts` deleted beside `foo.test.ts` exempts it. (3) A rename
  shows only the lines it edits, never the tests the file keeps, so a test renamed to a path that is
  not a test file counts on its path alone, edited or not, and a helper renamed out of `tests/`
  counts too. (4) A test file emptied but not deleted is not seen (TI02 and
  TI05 in a later release). (5) Text is kept for at most 5000 lines per file and 400 characters per
  line; a deleted JS/TS, Python or Go file cut at that bound with no test-defining line kept still
  counts, so a huge test file is never waved through, while a cut fixture, snapshot or data file
  under a test directory does not. (6) A package that is the repository root never exempts a deletion.
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
  decimals is read. A value moved onto another key, and a threshold set by the workflow input (which beats the config
  and is out of the diff's reach) are not seen. A config renamed with no edits shows no lines.
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
- **Triggers by token.** A removed `pull_request` or `pull_request_target` is excused when any added line of the same
  file names either. The `on` key may be quoted (`"on":`). Other filters (`branches`, `paths`) are not judged, and a
  workflow that drops its `pull_request` trigger is a block even when it never ran tests (a release or labeler
  workflow).
- **Matrix by one-line list.** Only a flow list (`[18, 20, 22]`) that shrinks on the same key counts; a block list
  loses no entry here, and `branches`, `paths`, `types` and `runs-on` lists are not read as matrices.
- **Needs policy.** A required-check job renamed and a `paths-ignore` widened over source need the list of required
  checks and the source paths from the app policy; they land with the policy work (E5), not here.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8).

### What TI03 misses

TI03 reads the added and removed lines of test files, one line at a time, in JS/TS, Python and Go. The local diff is
`--unified=0`, so there are no context lines.

- **No context lines.** A skip is judged from its own line and the lines the diff shows next to it. A Python decorator
  is judged by the added lines directly below it: a `def` or `class` there is a test the change adds (`warn`) unless a
  removed line of the same hunk opened a test of the same name (an edited `def` line); nothing added directly below it
  means it sits on a test the diff does not show, a test that existed. A skip inside a test body cannot be
  tied to the test it stops or to the `if` that guards it, so it is `warn`.
- **Forms at the start of a line.** A form is recognised only at the start of a line after white space, so a one-line
  `if (slow) this.skip()`, a skip written after another statement on the same line and a skip built through a helper
  are missed. A call wrapped over lines is read from its first line only: `it` alone with `.skip(...)` on the next line
  is missed, and `it.skip(` with the name on the next line reads as a skip inside a body (`warn`). Comments and strings are never read as skips.
- **Runner words that are not named.** `test.fixme`, `test.fail` and any other runner word that stops a test but is not
  one of the forms above are not seen. `skipIf` and `runIf` are judged by their literal argument only: a
  condition that is always true under another spelling reads as conditional.
- **Go receivers other than `t`.** Only `t.Skip(`, `t.Skipf(` and `t.SkipNow(` are read; a receiver named `tb`, `b` or
  anything else is missed.
- **A skip moved to another file** reads as added, because the removed line is looked for in the same file only. A
  rename that edits the skip is judged against the old file's lines.
- **Names by content.** A test is matched by the text of its first argument, so two tests with the same name in a file
  are one, and a name built from an expression (`describe.skip.each(table)`) is compared by that text. A nameless
  `.skip(cond)` is read as conditional.
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file, the unconditional skips of existing tests first, so warn findings never push a block finding out.
  A diff that reaches `check()` already parsed without kept text yields no TI03.

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
  command in `pyproject.toml`, a Makefile or tox are not. `exit 0` counts only as a command at the start, after `||` or
  after `;`. `echo` counts there too, and only when no `&&`, `|`, `&` or `;` follows it, so a banner such as
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
  not JS/TS or Python. `*.test.mts` and `*.test.cts` files are not test files by the existing detection, so they count as
  source and fire.
- **A marker inside a string fires,** because the scan sees a comment start in the text of the line, not the syntax. A
  marker on a later line of a block comment (without its own comment start) is missed.
- **Moves and one-to-one matching.** A removed marker of the same text accounts for one added marker of the same file; a
  marker moved to another file reads as added. The text is compared after lower-casing and collapsing white space
  (for the Python pragma, after removing white space and the colon, so `no cover` and `nocover` are one marker).
- **Kept text is capped** at 5000 lines per file and 400 characters per line (section 8); at most 20 signals are
  given per file. A diff that reaches `check()` already parsed without kept text yields no TI13.

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

## What test integrity does not catch

The test-integrity signals that ship today (TI01, TI03, TI04, TI10, TI11, TI13 and TI14) read only the added and
removed lines of the diff, in files they recognise by name. They do not run tests, parse syntax or read a file that the
diff does not touch, and they cannot judge whether an assertion is strong. The accept label records that a reviewer who
is not the author signed off a block finding. It cannot show that the reviewer read the tests, and it never adds a
check. What each signal misses is listed under its own "What TIxx misses" heading above, and the accept label's limits
under "What the accept label misses". A file whose changed lines run past 5000 is read only up to that point; the
report names it with `TEST_INTEGRITY_TEXT_TRUNCATED` (section 8).

The benchmark for what is not seen is Skylos's list of nine ways to hide a failing test. The nine cases are reproduced
in vitest under `fixtures/skylos-nine/` and pinned by tests. The diff-only signals of this release catch **2 of 9**.

Caught:

- `deleted-test` — caught by TI01: the test file is deleted, and its removed lines define tests.
- `added-skip` — caught by TI03: `it(` becomes `it.skip(` on a test the diff shows existed.

Not caught. Each of these names the signal that is planned for it; none of them exists yet:

- `emptied-assertion` — missed; planned: TI05. The `expect(...)` call is replaced by a bare call, so the test still
  runs and asserts nothing.
- `deselect-setting` — missed; planned: TI09. The runner's `include` list is narrowed in `vitest.config.ts`, so the
  test file is never picked up. A runner config is not read.
- `hard-coded-answer` — missed; planned: TI15. The source returns the expected value for the test's input. Source
  files that are not tests are read for coverage-ignore comments only.
- `always-true-matcher` — missed; planned: TI17, which is a proposal and not a signal in the test-integrity spec yet.
  A custom matcher that always passes replaces `toBe(5)`.
- `replaced-test` — missed; planned: TI02. A test is replaced by one with another name, so no test file is deleted and
  nothing is skipped.
- `loosened-assertion` — missed; planned: TI06. `toBe(5)` becomes `toBeTruthy()`.
- `edited-expected-value` — missed; planned: TI07. `toBe(5)` becomes `toBe(6)` so that the test agrees with the code.

Other ways a change can weaken tests without being seen:

- A test replaced by a new test with the **same name** and a **trivial body**. TI02 (planned) misses it when the name
  stays, and TI05 (planned) catches only the case with no assertion at all.
- Semantic weakening that keeps the matcher, such as `toEqual(expectedFromOutput)`, where the expected value is read
  back from the code under test.
- A **mock** introduced in a **setup file** that the diff does not show as a test file, so a test passes against a
  stand-in.

## 2. When an input is missing

- **A missing input fails only with a threshold.** `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`,
  `COVERAGE_FORMAT_UNSUPPORTED`, `COVERAGE_PATHS_UNMATCHED` and `DIFF_UNAVAILABLE` are errors, and the verdict is `fail`, when a
  threshold is set (0 included): a gate that cannot measure fails closed. Without a threshold they
  are warnings.
- **`DIFF_UNAVAILABLE` has several causes.** It is reported when there is no base to diff against (a
  push without a previous commit, or no `base-ref` outside a pull request or merge queue), when
  neither local git nor the GitHub API can produce the diff (for example a shallow checkout and an
  API error), when the diff is over the size limit, and when a `pull_request_target` run checked out
  the base branch (that run is refused, not measured: checking out the PR head to measure it would
  run fork code with a write token; see `SECURITY.md`).
  Use `fetch-depth: 0` (or let the GitHub API fallback fetch the diff) and a `pull_request` trigger
  and this does not happen in practice. A `base-ref` you set that is found neither in the checkout
  nor through the GitHub API is not `DIFF_UNAVAILABLE`: it fails the step, like a bad `--base` in
  the CLI.
- **`fail-on-threshold: false` makes the step report, not gate.** The verdict and outputs are still
  set.

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

- **It is an inventory, not a review.** pharn-ci lists agent setup files and never reads them. It
  does not validate their syntax, judge their content, or check them for prompt injection.
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
    reads a setup file, so it does not follow them.
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
  jules, opencode and zed. pharn-ci never reads file contents, so an empty or unrelated file still
  counts (an empty one gets `AGENT_SETUP_FILE_EMPTY`).
- **The summary is derived.** `agentSetup.summary` holds counts per kind and the tools those kinds
  belong to, from a fixed list. It is computed from the file list and says nothing about content.

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
- **pharn-ci cannot protect the job from the PR.** On `pull_request`, the PR's own code (its tests)
  runs in the same job before pharn-ci does. pharn-ci's guarantees are about what pharn-ci itself
  does with the token and with the input it reads.
- **PR-number mode depends on the GitHub API.** With the `pr-number` input, the diff comes from the
  compare API, so it is subject to GitHub's size limit for compare diffs (a diff over it is
  `DIFF_UNAVAILABLE`), and the file list comes from the git trees API. For a very large repository
  that listing is truncated: pharn-ci warns, and the agent setup scan may miss files. The coverage
  file still comes from the workflow, so a forged one can flatter its own PR; the `pull_request`
  run's verdict is the gate, not the comment.

## 6. Distribution

- **Pre-1.0.** Report v1 is stable within v1 (fields are only added; codes are never renamed).
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
- **Both checks are skipped when the tracked-files list is empty**, which is what the Action does
  when `git ls-files` fails (it warns). The report is then what it was before these checks.
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
  per file and 400 characters per line (`textTruncated` marks a file cut at the cap). A finding past the cut is not
  seen. When a signal reads the cut file (a test file in JS/TS, Python or Go, a workflow, a modified `package.json`, a
  source file or the pharn-ci config) and the file is not deleted, the report adds `TEST_INTEGRITY_TEXT_TRUNCATED`
  (`warn`) naming it, so a change cannot pass in silence by padding a file past the cut. A deleted file is not named:
  TI01 already counts a cut test file. The 120 s git
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
- **The `git ls-files` output.** It is read through a 256 MiB buffer. Past it the CLI exits 2, and
  the Action warns and skips the agent setup scan and the coverage path checks.
- **The `git ls-tree` output.** It is read through a 256 MiB buffer and is optional. Past it, empty
  agent setup files are not reported, and the rest of the check runs.
- **The text of the test and test-config files.** For a diff read from local git, the CLI and the Action
  read, from committed git objects, the text of the test files and the test-config files (`vitest.config.*`,
  `vitest.workspace.*`, `jest.config.*`, `playwright.config.*`, `.mocharc*`, `pytest.ini`, `pyproject.toml`,
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
  stderr and the Action one log line naming the failed git step, and the report is unchanged. In a partial clone a
  blob that is not local is `missing`, never fetched (`GIT_NO_LAZY_FETCH=1`; an older git ignores the variable). A
  symlink test file is read as its link target path. Nothing reads this text yet: the report is the same with it,
  without it and with both sides unavailable.
