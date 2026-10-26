# Changelog

All notable changes to pharn-ci are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a breaking change bumps the minor version.
Releases are cut by a maintainer; see [`docs/RELEASING.md`](./docs/RELEASING.md).

## [Unreleased]

### Added

- `meta.isAgentPr` in the Action's report, with `meta.prAuthor`, `meta.prLabels`, `meta.coAuthors` and `meta.agentHint`:
  whether the pull request counts as an agent PR, from its author, its commits' authors, committers and
  `Co-authored-by` trailers, and its labels (`agent` and `ai-generated` by default). Seven known agents are recognized.
  Evidence that cannot be read in full (an unknown author, unreadable commits, more than 250 commits) counts as an agent
  PR. Metadata only: the verdict, the messages, the comment and the exit code do not change. In core: `detectAgentPr`,
  `parseCoAuthorTrailers`, `agentPrMetaFields`, `withAgentPrMeta`, `KNOWN_AGENTS` and `DEFAULT_AGENT_LABELS`.
- `schema/policy.v1.json`: the JSON Schema (draft 2020-12) for version 1 of the policy document, the file that will
  tell pharn-ci what "safe to merge" means for a repository, shared with the pharn.dev app. A pure validator in core
  (`validatePolicy`, and `parsePolicyJson` for JSON text) checks a document against it: it never throws, never
  repeats a value from the document in an error, and bounds its work on any input. The org policy entry below is
  what reads it.
- Org policy. The Action takes two inputs, `policy` (`auto`, `never`, `required` or `file:<path>`, default `auto`) and
  `app-url` (default `https://pharn.dev`), and the CLI two flags, `--policy-file <path>` and `--no-policy`. With
  `policy: auto` or `required` and an OIDC token (`permissions: id-token: write`), the Action makes one `GET` of the
  pharn.dev policy endpoint, sending only the OIDC token and the repository name, and applies the served policy over
  the workflow inputs and `.pharn/ci.yml`: it raises the threshold, `setup.require` and the test-integrity mode,
  replaces the exclusions and the coverage root, sets per-signal severities and the accept label, and adds
  `setup.expect` tools. A `file:` policy carried by the pull request can only tighten. Two new message codes:
  `POLICY_UNAVAILABLE` (`warn`, `error` under `policy: required`) and `POLICY_OVERRIDE_IGNORED` (`warn`). With no
  token, `policy: never` or no policy, the report is the one it was.
- Check **A7**, secrets in agent configs. The CLI and the Action read the committed text at `HEAD` of the
  machine-readable agent setup files (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.claude/settings*.json`,
  `.codex/config.toml`, `.gemini/settings.json`, `opencode.json`, `.aider.conf.yml`, the files under `.claude/hooks/` and
  the `.json`, `.yaml` and `.yml` files under `.continue/rules/`; never the Markdown kinds) and report ten shapes of
  secret (GitHub, Anthropic, OpenAI, Google, AWS, Slack, Stripe, private keys, URL passwords and tokens, and secret-like
  values under secret-named keys). Twelve message codes, `AGENT_CONFIG_SECRET_S01` to `AGENT_CONFIG_SECRET_S11` and
  `AGENT_CONFIG_SECRET_UNSCANNED`: S01 to S09 are `error` and fail the check, S10 is `warn`, S11 is `info`, and files that
  could not be scanned are named in the unscanned code (`error` when a drop could hide a secret). Report v2 only gains
  codes; the message-code description in `schema/report.v2.json` names them. In the Action, the files are read only for
  a diff from the local checkout; in PR-number mode and for a compare-API diff the message says nothing was read.
- A redaction module in `@pharn-ci/core`: `findSecretSpans`, `redactSecrets`, `truncateUtf8`, `redactMessage` and
  `MESSAGE_MAX_BYTES`. Nothing outside check A7 uses it yet.

### Changed

### Security

- The Action makes one new read-only GitHub API call, `GET /repos/{owner}/{repo}/pulls/{n}/commits` (at most 3 pages of
  100), and reads the text of the pull request's commit messages in memory for the agent PR detection. A message is
  capped at 65,536 UTF-16 code units, read for at most 50 trailers in linear time, and never stored, logged or sent;
  only fixed words, valid logins and the trailers of known agents reach the report. `docs/THREAT-MODEL.md` has the new
  surface A5 and residual risks 22 and 23.
- No A7 message, and nothing else the report, the comment or the summary carries, names a secret's value, its key or
  any other text of an agent config file: a message holds the shape id, a path in a code span and a line number.

## [0.3.0] - 2026-10-26

Test integrity now reads the tests themselves. Nine new signals (TI02, TI05, TI06, TI07, TI08, TI09, TI12, TI15 and
TI16) compare what a change does to its test files, test-runner configs and sources, for JS/TS and Python alike, and the
report lists the tests a change adds, removes, modifies or renames. With `test-integrity: block`, a pull request that
passed under 0.2.0 can now fail: see the first entry under **Changed** for what, and how to get the 0.2.0 outcome back.
No input, output or message code was removed or renamed, the default mode is still `warn`, and the report is still
Report v2 with two optional fields added.

### Added

- Signal **TI02**, a test removed, and the code `TEST_INTEGRITY_TI02`. With TI05, the first signals that compare the
  text of the test files a change modifies at the merge base and at HEAD (JS/TS and, through the Python test index,
  `.py` files). TI02 reports a test with no counterpart left in the touched test files by name or by a similar body,
  `block` in mode `block` and `warn` in mode `warn` and for a computed name, at its base path and base line. It clears a
  test renamed in place in its describe, hand-written tests replaced by an `it.each` table, and a test moved to another
  touched file under a new name when its body closely matches. No rule clears a test by its name alone: a removed test
  is cleared by the same leaf name in another touched file only when that test holds the body.
- Signal **TI05**, assertions emptied or dropped, and the code `TEST_INTEGRITY_TI05`. It reports a test that had
  assertions and has none at head (`block` in mode `block`), or fewer with the rest of its body unchanged (`warn`), at
  its head path and head line.
- Signal **TI06**, a test weakened, and the code `TEST_INTEGRITY_TI06`, always `warn`. TI06 compares each matched test at
  the merge base and at HEAD and reports a strong matcher replaced by a weak one (`toBe` to `toBeTruthy`), an
  `expect.assertions` or `expect.hasAssertions` guard lowered or removed, an assertion that compares a literal with
  itself added, and an assertion moved into a `try` block with a `catch` or after an early `return`. It reads the
  subject of `expect(…)` for `toBe`, `toEqual` and `toStrictEqual`, so `typeof`, `instanceof`, `.length`, `!!x`, `null`
  and `undefined` rewrites to the matcher they equal are not a weakening. The detail is fixed text and matcher labels,
  never a test name.
- Signal **TI07**, an expected value edited to match, and the code `TEST_INTEGRITY_TI07`. It warns, in modes `block` and
  `warn` alike and so never fails the check, when a test of a modified JS/TS or Python test file changes only literals
  inside the expected-value arguments of its assertions (the Jest and Vitest matchers, chai's `equal`, node:assert's
  `assert.equal` family, unittest's `assertEqual` family and the operand after `==` in a pytest `assert`) and the change
  also edits a JS/TS or Python source file. The finding names the test and the matcher, never the literal.
- Signal **TI08**, snapshot churn, and the code `TEST_INTEGRITY_TI08`. It warns, in modes `block` and `warn` alike, when a
  change modifies, deletes or rewrites more than 10 snapshot files (`__snapshots__` directories, `.snap` and `.ambr`
  files), when a JS/TS test file rewrites 10 or more `toMatchInlineSnapshot(` lines, or when a snapshot-update flag
  (`-u`, `--update`, `--updateSnapshot`, `--update-snapshots`, `--snapshot-update`) is added to a `test*` script in
  `package.json` or `--snapshot-update` to a pytest config file.
- Signal **TI09**, a test-runner setting loosened, and the code `TEST_INTEGRITY_TI09`. TI09 compares the base and head
  text of the touched test-runner config files: `vitest.config.*`, `vite.config.*` (now read as a test-config file by the
  CLI and the Action), `vitest.workspace.*`, `jest.config.*` and the `jest` key of `package.json`, `playwright.config.*`,
  `.mocharc.*`, `pytest.ini`, `tox.ini`, `setup.cfg` and `pyproject.toml`. A fixed list of keys is judged: a lowered
  or removed coverage threshold, a narrowed test list, a widened exclusion (build directories, `node_modules` and
  `.d.ts` files excepted), `passWithNoTests`, `allowOnly` or `bail` turned on, a `grep` added, `forbidOnly` turned off
  and a pytest `addopts` that gains a deselecting option are `block` in mode `block` and `warn` in mode `warn`; a raised
  retry count or timeout, and a value that is not a literal, are always `warn`. The projects of a vitest or jest `projects` list are matched by name
  (`test.name`, `displayName`) or by position and only their test-list keys are compared, so an unrelated key changed in
  a project gives nothing. The finding sits at the head path and the head line of the key (no line for JSON). A config
  that cannot be read, or the whole signal when a side of the test sources is unavailable, adds a TI09 sentence to
  `TEST_INTEGRITY_INDEX_UNAVAILABLE`.
- Signal **TI12**, a module under test mocked, and the code `TEST_INTEGRITY_TI12`, always `warn`. TI12 reports a new
  `vi.mock`, `jest.mock` or Python `patch` of a source file the same change edits, once per test file and target, with
  the mock's specifier sanitized and cut to 120 characters.
- Signal **TI15**, the test may be special-cased, and the code `TEST_INTEGRITY_TI15`, at level `info`: it never blocks or
  warns, in modes `block` and `warn` alike. It fires when a condition added to a JavaScript, TypeScript or Python source
  file (`===`, `!==`, `==`, `!=`, a `case` label or a Python `in (...)` group) compares with a string or number literal
  that a test file in the same change also adds. It matches only inside the same package (the nearest `package.json` or
  `pyproject.toml`), leaves out `examples`, `benchmarks`, `bench`, `docs` and `fixtures` directories, needs 6 characters
  or 4 significant digits, and lists at most 10 findings per change (the message says how many more). The finding names
  the source line, the literal's kind and length and the test file, never the literal's text. It is `info` because 0 of
  30 sampled TI15 findings were right on the 600-PR precision corpus (`docs/PRECISION.md`).
- Signal **TI16**, a lint or type suppression in tests, and the code `TEST_INTEGRITY_TI16`. It gives an `info` finding,
  which never blocks and leaves the verdict at `pass`, when a JS/TS or Python test file adds a comment that switches off
  a linter or type checker.
- At most 20 findings per file and signal are listed for TI02, TI05, TI06, TI09 and TI12, and the messages say how many
  were left out.
- The code `TEST_INTEGRITY_INDEX_UNAVAILABLE` (warn). It names the touched test files that could not be compared, with a
  reason code each, or says that TI02 and TI05 did not run.
- Tests-changed summary: `testIntegrity.changes` in `report.json` (optional, in `schema/report.v2.json`) lists the tests a
  change adds, removes, modifies or renames, with counts per test file, and the comment gains a collapsed "Tests changed"
  table with the counts per test file. Test names are in `report.json` only, cut to 120 characters, at most 200 entries.
  An `.each` replacement is listed once under renamed.
- `testIntegrity.languages` in `report.json` (optional) lists the languages (`js`, `py`, `ts`) the test indexes parsed.
- Python parity with JS/TS. **TI03** and the Python test index resolve pytest marker and unittest decorator aliases
  bound by a test file's own top-level imports (`import pytest as pt`, `from pytest import mark as m`,
  `from unittest import skipIf as si`), so TI02, TI05 and TI06 see through them too; TI03 also reads
  `@unittest.expectedFailure` and `pytest.xfail(`. **TI09** reads pytest 9's native `[tool.pytest]` table of
  `pyproject.toml` beside `[tool.pytest.ini_options]`. `docs/LIMITS.md` gains a Python parity table and the list of
  Python misses.
- The official precision results for v0.3.0, in `docs/PRECISION.md`: 600 PRs, 0 errors, TI01, TI02 and TI11 each
  falsely block 1 of 600 PRs and ship as block, and the reviewed CSV is `fixtures/corpus/review.csv`.
- The Skylos nine reproduced for pytest under `fixtures/skylos-nine-pytest` (eleven cases, the nine plus an aliased skip
  and a `mock.ANY` variant of the always-true matcher), pinned by tests that run `check()` with the real Python index.
  The signals catch **8 of 9** for pytest, and the vitest `skylos-nine` benchmark under `fixtures/skylos-nine/` now
  catches **7 of 9**, up from 2 of 9 in 0.2.0 (`emptied-assertion`, `deselect-setting`, `replaced-test`,
  `loosened-assertion` and `edited-expected-value` are new). `docs/PRECISION.md` gains a section with the case-by-case
  table, and `docs/LIMITS.md` gains the TI17 proposal for the always-true matcher (a proposal only, nothing implements it).

### Changed

- **What can now fail a pull request in mode `block`** that passed under 0.2.0: a removed test (TI02), a test left with
  no assertions (TI05), a loosened test-runner setting (TI09), a skip of an existing test written through an aliased
  pytest marker or unittest decorator, or `@unittest.expectedFailure` (TI03), and a deleted test file replaced by a test
  file of the same name whose tests are not found again by body (TI01, below). Mode `warn`, the default, reports the
  same findings without failing the check. To get the 0.2.0 outcome back on one pull request, a reviewer who is not its
  author applies the accept label (`pharn/accepted`, the `accept-label` input), which downgrades its block findings to
  `warn`; to get it back for every pull request, set `test-integrity: warn`.
- **TI01** no longer lets a name stand in for a test's code. A deleted test file replaced by a test file of the same
  name is `info` only when every test it held is found again by body in a new test, and stays a `block` when the tests
  are hollow or when no test sources are given (the two `info-migration` diffs checked diff-only are now a `block`).
  TI01 also gives `info` when every test a deleted test file held is found again, by name and by body, in another test
  file of the change; those moved tests are judged by TI05, TI06 and TI07. The rules and their limits are in
  `docs/LIMITS.md`.
- **The Python test index needs `python3`.** The CLI and the Action index the Python test files of a change with
  `python3` (or `python`, 3.8 or newer) when the change modifies one; with JS/TS-only changes nothing runs. Without a
  usable interpreter the touched Python test files are named in `TEST_INTEGRITY_INDEX_UNAVAILABLE` (warn) with a reason
  code (`python-not-found`, `python-too-old`), the signals that compare test text skip them, and the diff-only signals
  still run. The repository's own tests that need `python3` now fail, instead of skipping, when it is missing.
- pharn-ci now reads the base and head text of the test and test-config files a change touches from local git. When
  that fails on git, the CLI writes one stderr line and the Action one log line naming the failed git step.
- The diff reader now keeps the text of `pytest.ini`, `pyproject.toml`, `setup.cfg` and `tox.ini`, and a cut one is
  named in `TEST_INTEGRITY_TEXT_TRUNCATED`.
- The action and CLI dist now carry the TypeScript parser, so the Action dist is larger (about 11 MB, under 12 MB).

### Fixed

- **TI11** compares test commands by a key per test part, so a package-manager swap (`bun run test` to `pnpm run test`)
  is no longer a removed step; a narrowed run and a test job moved to another workflow file are still a `block`.
- **TI01** no longer counts a `.snap` file as a deleted test file (the `TEST_FILES_DELETED` message still lists it).

### Security

- The Python test index runs the runner's own `python3`, found on the job's `PATH`, on the text of the pull request's
  Python test files. It only parses them (`ast.parse`), in isolated mode, with no shell, a minimal environment, a 30 s
  timeout and a 64 MiB output limit; a hostile interpreter earlier on `PATH` is a residual risk. See
  `docs/THREAT-MODEL.md` (row C3, residual risk 20).

## [0.2.0] - 2026-10-25

### Added

- The accept label, the `accept-label` Action input (default `pharn/accepted`, at most 50 characters). In
  `test-integrity: block` on a `pull_request` or `pr-number` run, a pull request that carries the label, applied last by
  a user account that is not the PR author, has its block signals downgraded to `warn`: the report gains the
  `TEST_INTEGRITY_ACCEPTED` message (info), `testIntegrity.accepted` and, for a non-default name,
  `testIntegrity.acceptLabel`, and the comment says who accepted it. A label that does not count (the author or a bot
  applied it, no labeling event, or anything unreadable) adds `TEST_INTEGRITY_ACCEPT_IGNORED` (warn) and the blocks
  stand. The Action reads the pull request and its issue events (at most 10 pages of 100) with `pull-requests: read` or
  `issues: read`; the CLI never honours the label, and `test_integrity.accept_label` in `.pharn/ci.yml` is refused. The
  TI03, TI10 and TI13 hints now name the label.
- The `test-integrity` Action input and `--test-integrity` CLI flag (`block`, `warn` or `off`, default `warn`),
  and a `test_integrity.mode` key in `.pharn/ci.yml` that can only make the check stricter than the input. The
  report's `testIntegrity.mode` and `testIntegrity.source` say which mode applies and where it came from, a
  looser config value is ignored with the new `TEST_INTEGRITY_MODE_IGNORED` message (warn), mode `off` adds
  `TEST_INTEGRITY_OFF` (info), and the PR comment and job summary gain a "🔍 Test integrity" section.
- Signal **TI01**, test file deleted: a deleted test file whose removed lines define tests, or a test file renamed to
  a path that is not a test file (edited or not, since a rename shows only the lines it edits), is reported in
  `testIntegrity.signals` and in one `TEST_INTEGRITY_TI01` message,
  `block` in mode `block` (a failing check), `warn` in the default mode. It is `info` when the same change also
  deletes the source file of the same name, deletes other files of the test's package, or adds a test file of the
  same name (a migration); helpers, fixtures and an `__init__.py` under `tests/` do not count. The "🔍 Test
  integrity" section lists the findings. Test files are now recognized by the spec's globs: `.test.` and `.spec.`
  with a JavaScript or TypeScript extension, `.e2e.ts`, `.pw.ts`, `test_*.py`, `*_test.py`, `*_test.go` and the
  `test`, `tests` and `__tests__` directories. `TEST_FILES_DELETED` is unchanged and now uses the same detection.
- Signal **TI14**, diff-coverage exclusions widened: a change to the pharn-ci config in use (`.pharn/ci.yml`, or the
  `config` input) that lowers or removes `coverage.threshold`, or adds a coverage exclusion, is reported in
  `testIntegrity.signals` and in one `TEST_INTEGRITY_TI14` message, `block` in mode `block`, `warn` in the default
  mode. Raising a threshold, removing an exclusion and unrelated settings never fire. `CONFIG_CHANGED_IN_DIFF` is
  unchanged.
  The config lines are read as the config reads them: a quoted key, a quoted or escaped value and any number of
  decimals all count.
- Signal **TI11**, CI stopped running tests, from the diff of workflow files (`.github/workflows/*.yml|yaml`),
  reported in `testIntegrity.signals` and in one `TEST_INTEGRITY_TI11` message. `block` in mode `block`: a removed
  test command (`pnpm test`, `vitest`, `jest`, `pytest`, `go test`, ...) that no workflow adds again, and a removed
  `pull_request` trigger. `warn` in every mode but `off`: a shrunk flow-list matrix, an added
  `continue-on-error: true`, an added `if:` that is a literal false or leaves pull requests out, and a
  `timeout-minutes` of 0 or 1. Which step a line belongs to cannot be seen without context lines, hence the warnings.
- Signal **TI03**, a skip added to a test file, from the kept text of the diff, reported in `testIntegrity.signals`
  and in one `TEST_INTEGRITY_TI03` message. It reads JS/TS (`.skip`, `xit` and the other `x` heads, `.todo`, `.fails`,
  `skipIf`, `runIf`, `this.skip(`), Python (`@pytest.mark.skip`, `skipif`, `xfail`, `@unittest.skip*`, `pytest.skip(`) and
  Go (`t.Skip(`, `t.Skipf(`, `t.SkipNow(`). An unconditional skip of a test the diff shows existed is `block` in mode
  `block`; a conditional skip, a skip inside a test body, and a skip in a test the change adds are `warn`. A skip that
  was already there (an edit, a move) never fires, and environment guards such as `skipIf(!hasCamera)` or
  `pytest.skip("REDIS_URL not set")` stay `warn`.
  At most 20 findings per file, with the skips of existing tests kept first, so warn findings never push a block out.
- Signal **TI04**, a focused-run marker added to a JS/TS test file (`.only`, bare `fit(` or `fdescribe(`), reported
  in `testIntegrity.signals` and in one `TEST_INTEGRITY_TI04` message, `block` in mode `block`, `warn` in the default
  mode. `solver.fit(x)`, `def fit(self)`, comments, strings and files that are not tests never fire; a marker that was
  already there (an edit, a move) does not fire either.
- Signal **TI10**, a test script weakened, from the diff of a modified or renamed `package.json` (root or nested),
  reported in `testIntegrity.signals` and in one `TEST_INTEGRITY_TI10` message, `block` in mode `block`, `warn` in the
  default mode. In a script whose key starts with `test`, an added `|| true`, an `echo` or `exit 0` as a command,
  `--passWithNoTests`, `--testPathPattern` and `-t` or `--testNamePattern` each fire once per line, unless a removed
  line of the same key already had that form; a removed `pretest` or `posttest` script fires too. `--passWithNoTests`
  stays quiet when no tracked file is a test file. Other scripts, an added or deleted `package.json` and a pure edit
  that keeps the weakening never fire.
- Signal **TI13**, a coverage-ignore comment added to source, reported in `testIntegrity.signals` and in one
  `TEST_INTEGRITY_TI13` message, `block` in mode `block`, `warn` in the default mode. An added Istanbul, V8 or C8
  ignore hint in a comment of a JS/TS file, or a `# pragma: no cover` in a Python file, that is not a test file fires;
  a marker that was already there (an edit, a move) never does.
- The unified-diff parser keeps the text of added and removed lines per hunk for test files, the pharn-ci config in
  use, workflow files, every `package.json` and the JavaScript, TypeScript and Python source files (at most 5000 lines
  per file, 400 characters per line; `textTruncated` marks a cut file), for the signals that read line text. `readDiffChunks` takes an optional `{ configPath, repoRoot }` so a custom
  config path works through the stream as it does through `check()`.
- The `accept-label` input also refuses invisible formatting characters (zero-width marks, bidirectional overrides
  and isolates, a byte order mark inside the name), which could make the hint around the label read differently from
  what it says. A spelling of `pharn/accepted` in other letter case is read as the default, so the report, the hints
  and the sign-off line name the same label. The comment shows those characters in a path or label as U+FFFD.
- The PR comment and job summary follow the Report v2 layout. The summary table gains a Test integrity column (`off`,
  `none (warn)`, or the number of findings and how many block), and the headline sentence counts the findings when
  there are any. The "🔍 Test integrity" section lists block findings first, then warn, then info, shows 10 and
  collapses the next 10 in a `<details>` block. The Messages section leaves out each `TEST_INTEGRITY_TI*` message
  whose findings the section lists, so a finding and its hint appear once; `report.json` keeps every message.
- Precision of the diff-only signals, from a review of the base-rate fixtures. TI11 reads a quoted `"on":` key and the
  test commands `npm t`, `pnpm -r test`, `pnpm --filter <pkg> test`, `pnpm vitest`, `pnpm exec`, `bun x`,
  `node --test`, `bun test`, `deno test`, `tox`, `nox` and the `uv`, `poetry`, `pipenv`, `pdm`, `hatch` and `rye run`
  wrappers. TI10 reads `; true`, `|| :` and `; :` as ignoring the exit status, no longer reads a banner
  (`echo start && vitest run`) as a weakening, and no longer reads mocha's `-t` (its timeout) as a name filter. TI13
  reads coverage.py's `# pragma: nocover`. TI03 reads a Python skip decorator above an edited `def` line, or above an
  existing test in a diff with context lines, as a skip of an existing test. TI01 no longer counts a deleted fixture,
  snapshot or data file under a test directory because its text was cut. A hand-made hunk header that starts a side at
  line 0 numbers its lines from 1.
- The `TEST_INTEGRITY_TEXT_TRUNCATED` message (warn, not in mode `off`): a file that a test-integrity signal reads
  (a test file, a workflow, a modified `package.json`, a JavaScript, TypeScript or Python source file, or the pharn-ci
  config) has more than 5000 changed lines, so the signals read only the first 5000. The message names those files,
  so a change cannot pass in silence by padding a file past the cut. Deleted files are not named.
- README: an [Agent skills](README.md#agent-skills) section on the `pharn-ci` plugin in
  [pharn-dev/skills](https://github.com/pharn-dev/skills) (install, explain a verdict, cover
  uncovered lines), and a pointer to it from the Quick start and the Pharn family table.
- The Skylos nine benchmark: the nine ways Skylos hides a failing test, reproduced in vitest under
  `fixtures/skylos-nine/` and pinned by tests. The diff-only signals of this release (TI01 and TI03) catch 2 of 9;
  the other seven are named with the planned signal that would catch them.
- A "What test integrity does not catch" section in [`docs/LIMITS.md`](docs/LIMITS.md), and a "Test integrity"
  section in the README with a rendered example of a finding. The "Only added lines count" limit no longer says that
  skipped tests are not detected.
- A release smoke script, `scripts/smoke-release.mjs`, that builds a throwaway repository from `fixtures/smoke/`, runs
  the built Action bundle against it with no token and no event, and checks the exit code, the `verdict` output, the
  job summary and the footer version. `docs/RELEASING.md` describes running it in the dry run and after the release,
  and adds a check with a pull request from a fork.

### Changed

- **Breaking for report consumers:** the report is now Report v2
  ([`schema/report.v2.json`](schema/report.v2.json)). `schemaVersion` is the number `2` (Report v1 used the
  string `"1"`), every report carries a `testIntegrity` block (the mode in effect and where it came from, the
  verdict and the signals; mode `warn` from source `default` unless set), and the Action's `report.json` adds a `meta` block with run
  metadata (event, repository, pull request, head and base commits, run id and attempt). Every Report v1 field
  keeps its name, type and meaning, and no message code changed. `report.v1.json` has
  `additionalProperties: false`, so a v2 report does not validate against it: tools that validate the report
  must switch on `schemaVersion`. The CLI's `--format json` prints Report v2, and the comment footer reads
  `report schema v2`. `schema/report.v1.json` is unchanged.

## [0.1.0] - 2026-10-19

### Added

- GitHub Action and `pharn-ci check` CLI.
- Diff coverage: the share of lines added in the change that the coverage report (lcov or
  Cobertura XML) marks as executed, with an optional, inclusive threshold gate (`threshold` input,
  `--threshold`, `coverage.threshold`).
- Agent setup inventory: the tracked agent setup files of Claude Code, Cursor, GitHub Copilot,
  Codex, Gemini, Windsurf, Cline and MCP, listed by kind and never read. The kinds are `claude-md`,
  `claude-local-md`, `agents-md`, `gemini-md`, `claude-settings`, `claude-settings-local`,
  `claude-skill`, `claude-hook`, `claude-agent`, `claude-command`, `cursor-rules`, `cursor-mcp`,
  `copilot-instructions`, `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`,
  `vscode-mcp`, `codex-config`, `windsurf-rules`, `cline-rules` and `mcp-config`, plus, for Aider,
  Continue, Roo Code, Amazon Q Developer, Junie, Zed, Augment, Kiro, Goose, OpenCode and Gemini CLI
  and for `.claude/rules/`, `claude-rule`, `aider-config`, `conventions-md`, `continue-rules`,
  `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`, `augment-rules`, `kiro-steering`,
  `goosehints`, `opencode-config` and `gemini-settings`. `.mcp.json`, `.claude/` files and
  `.cursor/rules/` are found in nested directories, and the more specific directory rule wins over
  a file-name rule.
- Report v1: optional `agentSetup.summary` (counts per kind and the tools involved), and an
  `Agent setup: N files · tools` line in the markdown, with the table collapsed above 25 files.
- Report v1 (`schema/report.v1.json`), the stable JSON output, with message codes
  `DIFF_COVERAGE_BELOW_THRESHOLD`, `DIFF_COVERAGE_UNGATED`, `NO_COVERABLE_CHANGES`,
  `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`,
  `DIFF_UNAVAILABLE` and `NO_AGENT_SETUP_FILES`.
- One sticky PR comment and a job summary; on fork PRs, where the token cannot comment, the job
  summary only.
- `.pharn/ci.yml` config file, overridden by Action inputs and CLI flags.
- Coverage exclusions: glob patterns (`*`, `**`, `?`) from `coverage.exclude`, the CLI's repeatable
  `--exclude <glob>` and the Action's `exclude` input, merged (their union applies), leave matching
  changed files out of diff coverage. The report gains the optional `diffCoverage.excludedFiles`
  field, and the comment an "Excluded" summary listing them.
- Cobertura XML coverage parsing in core, read by the CLI and the Action.
- Coverage format selection: the `coverage-format` Action input, the `--coverage-format` CLI flag
  and `coverage.format` in `.pharn/ci.yml` take `lcov`, `cobertura` or `auto`. The flag or input
  wins over the config file.
- `auto` is the default: the format is detected from the first 1 KiB of the file, and the CLI
  (stderr) and the Action (log) print which format was used, for example
  `coverage: cobertura (auto-detected)`. Clover and JaCoCo native XML are not supported.
- Message code `COVERAGE_FORMAT_UNSUPPORTED`: under `auto`, a coverage file that is neither lcov
  nor Cobertura XML is an error with a threshold, a warning without.
- Report v1: optional `diffCoverage.format` (`lcov` or `cobertura`), the format the report was
  read as.
- `COVERAGE_LINES_SKIPPED` (info): malformed lcov `DA` records and Cobertura `<line>` elements that were skipped while reading the coverage files are now counted, and the report says how many (a count only, no line numbers or file names). The verdict and the diff coverage numbers do not change, and reports that end before diff coverage is computed do not carry the message.
- Coverage auto-discovery: with no `coverage-file` input, no `--coverage` flag and no `coverage.file`, the Action and the CLI look for the coverage report at `coverage/lcov.info`, `lcov.info`, `coverage.xml`, `coverage/cobertura-coverage.xml` and `**/coverage.cobertura.xml`, and print `coverage: <path> (auto-discovered)` for each file they read. More than one kind found is an error asking you to set the path; none found is a `COVERAGE_FILE_MISSING` message (previously a usage error). Complete workflows for vitest, jest, pytest, .NET and cargo are in `examples/workflows/`.
- Expected agent tools: `setup.expect` in `.pharn/ci.yml`, the `expect-agent-setup` Action input and the CLI's `--expect-agent-setup` flag (repeatable) name agent tools (for example `claude-code`, `cursor`) that should have a setup file. Any tool no setup file configures is listed in the new `agentSetup.missing` field and reported as `AGENT_SETUP_EXPECTED_MISSING` (warn, or error when agent setup is required). A repo that expects nothing sees no change.
- `AGENT_SETUP_FILE_EMPTY` (warn): a listed agent setup file that is empty (size 0 in `HEAD`, from `git ls-tree -r -l`) is reported with the first path, and stays in the inventory. When `git ls-tree` fails, none is reported (the CLI notes it on stderr, the Action warns). Because it is a warning, the verdict of a repo with an empty `CLAUDE.md` changes from `pass` to `warn`.
- `TEST_FILES_DELETED` (info): the change deletes a test file, or renames one to a name that is not a test file
  (F-21). The message names up to five of them; the verdict is unchanged. Test files are recognized by name
  (`.test.`/`.spec.` in the basename, or a `test`, `tests` or `__tests__` directory).
- Agent setup inventory covers more tools (F-11): 13 new setup kinds, `claude-rule` (`.claude/rules/`), `aider-config`, `conventions-md`, `continue-rules`, `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`, `augment-rules`, `kiro-steering`, `goosehints`, `opencode-config` and `gemini-settings`, so the files of Aider, Continue, Roo Code, Amazon Q Developer, Junie, Zed, Augment, Kiro, Goose, OpenCode and Gemini CLI are listed. `agents-md` is now also credited to amp, jules, opencode and zed, and `agentSetup.summary.tools` in Report v1 accepts new tool names within v1 (a lowercase name pattern replaces the closed list).
- PR-number mode: the `pr-number` and `head-sha` Action inputs let pharn-ci measure and comment on a
  pull request from a `workflow_run` or `workflow_dispatch` run, with no PR code checked out. The PR,
  its diff and its file list come from the GitHub API (two new read-only calls: get a pull request,
  get a git tree), `pr-number` is validated, and `head-sha` is checked against the PR head. The README
  documents the two-workflow pattern for comments on fork PRs.
- Three warn-level messages for a change that touches the inputs of its own grade: `CONFIG_CHANGED_IN_DIFF` (the diff edits the pharn-ci config in use or a file under `.github/workflows/`), `COVERAGE_FILE_TRACKED` (the coverage file is a tracked file, so the change can supply its own numbers) and `DIFF_BINARY_COVERED_FILE` (the diff shows a covered source file as binary, e.g. through `-diff` in `.gitattributes`, so its added lines were not measured). They lift a `pass` to `warn` and never fail the check.
- Several coverage files and globs: the `coverage-file` Action input takes one entry per line, the CLI's `--coverage` flag is repeatable and `coverage.file` in `.pharn/ci.yml` can be a list. Each entry is a path or a glob (`*`, `**`, `?`, relative to the workspace, the current directory or the repo root), so `TestResults/**/coverage.cobertura.xml` and `packages/*/coverage/lcov.info` work. The files are merged with hit counts summed; `auto` detects the format of each file. A glob that finds nothing is `COVERAGE_FILE_MISSING`; a walk stops at 1,000 matched files or 100,000 visited entries, never follows a symbolic link and skips `.git` and `node_modules` unless named.
- Require agent setup: the `require-agent-setup` Action input, the CLI's `--require-agent-setup` flag and `setup.require` in `.pharn/ci.yml` (off by default) make `NO_AGENT_SETUP_FILES` an error and the verdict `fail` when the repo has no agent setup files.
- `DIFF_COVERAGE_UNGATED` (info): diff coverage was measured, with its percent in the text, but no
  threshold gates it (none is set, or it is 0). Before, an ungated run passed with no message.
- Data handling section in `SECURITY.md`, linked from the README's Safety model: what the Action reads, what it sends to your GitHub API, what lands in the PR comment, job summary, step log and `report.json`, and that nothing is sent to Pharn.

- The rendered report (PR comment, job summary, CLI markdown) adds a one-line hint under each message
  saying how to fix it, and says what is missing (typically `AGENTS.md` or `CLAUDE.md`) when no agent
  setup files are found. Message text in `report.json` is unchanged.
- `coverage.exclude` in `.pharn/ci.yml` can be written as a one-line flow list, e.g.
  `exclude: ["**", "dist/**"]`, which used to stop the check with exit code 2.
- Coverage root: `coverage.root` in `.pharn/ci.yml`, the `coverage-root` Action input and the CLI's `--coverage-root` flag name the repo-relative directory that relative coverage paths start from, so a package-relative lcov or Cobertura report in a monorepo is measured at the right files. Absolute paths are never remapped.
- `COVERAGE_PATHS_PARTIALLY_UNMATCHED` (info): some of the coverage report's file paths are not tracked files, so their coverage is not used. The verdict is unchanged. The `fixtures/golden` and `fixtures/golden-cobertura` reports gain this message.

### Changed

- When more than one coverage file is read (a glob, a list, or several `--coverage` flags), the `coverage: <format> (<how>)` log line names its file: `coverage: coverage/a.info: lcov (auto-detected)`. With one file the line is unchanged, and so is the `(auto-discovered)` line.
- The PR comment, job summary and CLI markdown now show the overview sentence in a GitHub alert under the verdict heading: `[!CAUTION]` for fail, `[!WARNING]` for warn, `[!TIP]` for pass. Report data and message text are unchanged.
- The PR comment, job summary and CLI markdown now show the pharn logo (a 48×48 image from the repository's raw `main` URL) above the verdict heading. Report data and message text are unchanged.
- The PR comment, job summary and CLI markdown have a new look. They open with a branded header (a verdict heading, a one-line overview and a summary table), use emoji section headings with counts, and collapse the changed-files and agent setup tables in `<details>` blocks (the changed-files block is open when diff coverage is below the threshold). They end with a footer naming the tool version, the report schema and the coverage format. Report data and message text are unchanged.
- Internal refactor: the CLI and the Action share their Node I/O (git, file reads, directory listing) and their coverage-file reading through a private workspace package, `@pharn-ci/node-io`. No user-visible change.
- Large inputs: the diff and lcov coverage are read line by line (F-15), so a diff is no longer limited by a 256 MiB buffer and lcov no longer by the longest string the engine can build (only one line that long still fails). The CLI and the Action stream git's output and the coverage file instead of reading them whole. Cobertura coverage and the config stay string-based. The limits of each input and what you see when one is passed are in `docs/LIMITS.md` §8 (Size limits).
- Versioning policy for 0.x (`docs/RELEASING.md`): Action inputs and outputs, CLI flags and message
  codes are never removed before 1.0; a renamed input keeps working under its old name, with a
  warning, for at least one minor release; a changed default ships only in a minor release and is
  listed here. The README status note and `docs/LIMITS.md` say the same.
- Agent setup inventory quality (F-10): `.mcp.json`, `.claude/settings.json` and `.claude/settings.local.json` count at the repo root only (a nested copy in a package or a test fixture is no longer listed); a dot-file or README under a directory kind (such as `.claude/skills/x/.gitkeep` or `.github/agents/README.md`) is not listed; and a path with a `node_modules` directory is never listed. Repos with such files see fewer files in `agentSetup.files`.
- A coverage entry (the `coverage-file` input, `--coverage` or `coverage.file`) containing `[`, `]`, `{` or `}` is
  rejected as unsupported glob syntax, even without `*` or `?`. A literal coverage path with one of those characters
  is now a usage error.
- The rendered report lists messages before the agent setup inventory, and a file's uncovered-lines cell shows
  at most 20 ranges followed by `…and N more`. The Action fits an oversized PR comment (65,000 characters) or
  job summary (1 MiB) by rendering fewer table rows instead of cutting the end, so the verdict and messages
  stay visible; `report.json` keeps the full report.
- The diff coverage table lists files by coverage, lowest first (then by path), so the files that
  need tests stay visible when the table is cut at 50 rows; a cut table now points to the full list
  in `report.json` (the Action's `report-path` output, or `--format json`).
- `.pharn/ci.yml` errors for unsupported YAML now name the supported form (for example "use a block
  list").
- A coverage report whose paths match no tracked file is now `COVERAGE_PATHS_UNMATCHED`: an error, and
  the verdict `fail`, when a threshold is set (a warning without one), with the suggested coverage
  root when one can be found. Before, it passed as `NO_COVERABLE_CHANGES`. If your coverage paths are
  relative to a package directory, set `coverage.root`.
- `DIFF_UNAVAILABLE` is now an error, and the verdict `fail`, when a threshold is set (a warning
  without one), like a missing, empty or unrecognized coverage file. If a shallow checkout makes
  the diff unavailable, use `actions/checkout` with `fetch-depth: 0` or rely on the GitHub API
  fallback.
- The diff coverage threshold is compared exactly against covered / coverable lines instead of the
  percent rounded to two decimals: 15,999 of 20,000 lines (79.995%) now fails a threshold of 80.
  A failing coverage that would round up to the threshold is shown rounded down (79.99%).
- Threshold 0 is documented as gating no percentage (reported with `DIFF_COVERAGE_UNGATED`); it
  still fails closed when coverage cannot be measured.
- The repository no longer tracks the maintainer's PHARN workflow install (`pharn/`,
  `pharn.config.json`, `pharn.records.json` and PHARN's own root `LIMITS.md` and `THREAT-MODEL.md`),
  so `uses: pharn-dev/pharn-ci@...` downloads about 5 MB less. pharn-ci's own threat model and
  limits are [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) and [`docs/LIMITS.md`](./docs/LIMITS.md).

### Fixed

- CLI: a flag value that starts with `-` (for example `--threshold -1` or `--base -x`) no longer fails with the misleading "Did you forget to specify the option argument?". The error (exit code 2, unchanged) now says the value must be written with `=`, for example `--threshold=-1`.
- Thresholds (`--threshold`, the `threshold` input and `coverage.threshold`) accept only plain decimal numbers from 0 to 100, such as `80` or `72.5`. Exponent (`1e2`), hex (`0x10`), a sign, a bare or trailing dot (`.5`, `80.`), `Infinity`, `%` and inner spaces were read as JavaScript numbers before and are now refused with the existing "must be a number between 0 and 100" error (exit 2).
- The README quick start no longer aborts for vitest: it says `@vitest/coverage-v8` must be a dev dependency, and a
  new "Coverage per ecosystem" table shows the report and `coverage-file` for vitest, jest, pytest-cov, coverlet,
  cargo-llvm-cov, Go, and JaCoCo/Kover through a Cobertura converter.
- An lcov file whose `SF` records carry no `DA` lines (a crashed or truncated reporter) is now
  `COVERAGE_FILE_EMPTY`, as the Cobertura equivalent already was, instead of passing as
  `NO_COVERABLE_CHANGES`. lcov files without a valid `DA` line are left out of the coverage map.
- Docs: the quick start pins `actions/checkout` to a commit SHA; the Action reference gives the
  real `threshold` and `base-ref` defaults; the docs name Cobertura as untrusted input, the
  `GET /user` call, and the bundled transitive dependencies.
- The Action no longer crashes with a stack trace before running when `github-token` is empty. The
  token is used only when an API call is needed, so `comment: false` with a local diff works
  without one; otherwise the compare fallback reports `DIFF_UNAVAILABLE` and the comment step
  warns, as for any API failure. The `github-token` input now says `pull-requests: write` is
  needed only for the comment.
- Concurrent runs on one PR no longer leave two sticky comments: after creating its comment, the
  Action deletes newer duplicates of its own marker comment (only ones its own login wrote) and
  keeps updating the oldest. The README quick start now sets a per-PR `concurrency` group.
- Merge queue runs (`merge_group`) diff against `merge_group.base_sha` instead of always reporting
  `DIFF_UNAVAILABLE`.
- An explicit `base-ref` found neither in the checkout nor through the GitHub API now fails the
  step with an error naming the ref, instead of reporting `DIFF_UNAVAILABLE`.
- A `config` input naming a file that does not exist now fails the step with "config file not
  found", like the CLI's `--config`, instead of running with no config (and so without a threshold
  held only in the config). The input no longer has a default in `action.yml`; left empty, it reads
  `.pharn/ci.yml` when present, as before.
- The CLI lists tracked files from the repository root when run from a subdirectory, so coverage
  paths are compared with the same names wherever it runs. The agent setup inventory of a
  subdirectory run now covers the whole repo.
- With a GitHub App token, the sticky comment is now found and updated instead of re-posted on every
  run. Each workflow and job owns its own comment, marked by a `<!-- pharn-ci scope: ... -->` line
  under the marker, so sibling jobs no longer overwrite each other. Comments from earlier versions
  keep being updated, but a PR whose single comment was shared by two jobs gains one comment for
  the second job after the upgrade.
- When the Action falls back to the GitHub compare API and the response has no `charset=utf-8` (it
  arrives as bytes) the diff is decoded as UTF-8, and a body that is not diff text (such as JSON)
  degrades to `DIFF_UNAVAILABLE`. Before, the step crashed with "text.split is not a function" and
  wrote no summary, report or outputs.
- A hung GitHub API or `git` call no longer stalls the Action for minutes per stage. Each API request
  is aborted after 30 s, and a 5xx, a network error or a rate limit asking for at most 60 s is retried
  once (honouring `retry-after` and `x-ratelimit-reset`); `git` calls in the Action and the CLI are
  killed after 2 minutes. The README example sets `timeout-minutes: 5` on the step.
- Docs: the `github-token` input says the token is always used in `pr-number` mode; the README
  quick start's `concurrency` group falls back to `github.ref`, so merge-queue entries no longer
  cancel each other; the token-footprint bullet lists `GET /user` and the `pr-number` reads; and
  SECURITY.md's data handling names every message code that quotes a path, including the coverage
  report path quoted by `COVERAGE_PATHS_UNMATCHED`.

### Security

- The PR comment cannot be altered through file names or message text: control characters in
  paths are replaced and HTML in messages is escaped.
- The sticky comment is matched by its author as well as its marker, so a comment someone else
  posted is never taken over.
- A base ref starting with `-` is rejected, and revisions reach git after `--end-of-options`.
- The config parser runs in linear time on hostile input.
- An empty or unparseable coverage file reports `COVERAGE_FILE_EMPTY` instead of passing.
- A `pull_request_target` run that checked out the base branch reports `DIFF_UNAVAILABLE` instead
  of passing.
- PR comments are capped below GitHub's size limit; the job summary keeps the full report.
- Repository protection: signed, linear, squash-merged `main` behind six required checks;
  immutable `v*` tags; every third-party action pinned to a commit SHA.
- `SECURITY.md` and `docs/THREAT-MODEL.md` state that pharn-ci has one maintainer: pull requests
  are merged with the `main` ruleset's admin bypass and releases are self-approved, so no second
  person reviews a change; they list what still enforces integrity and the plan for when a second
  maintainer joins. The threat model no longer says `main` takes only reviewed pull requests (F-18).
- A `pull_request_target` run that checked out the base branch no longer tells users to check out the
  PR head, which would run fork code with a write token. `DIFF_UNAVAILABLE` now says it cannot be
  measured safely and points to `pull_request` and `SECURITY.md`; the safe `workflow_run` pattern for
  comments on fork PRs is documented in the README.
- Cobertura path resolution no longer slows down quadratically on a crafted report with thousands
  of `<source>` entries and thousands of filenames (F-24). Results are unchanged, except that a
  relative `filename` starting with `..` is now joined to at most the first 16 distinct sources.
- PR-controlled text in messages (the coverage path from `.pharn/ci.yml`, the base ref) no longer
  renders as links, images, emphasis or @mentions in the PR comment and job summary: markdown
  characters are escaped, `@` cannot mention, and bare URLs are not autolinked. The report JSON
  keeps the message text unchanged.
- The Action's `git rev-parse --verify` lookup of the base ref now passes the revision after
  `--end-of-options` too, so every git call that takes a revision separates it from options.
- Release tags are documented as unsigned lightweight tags, with pinning the full commit SHA as the
  integrity control (`README.md`, `SECURITY.md`, `docs/RELEASING.md`). The `packages/action/dist`
  diff is no longer collapsed in pull requests (`.gitattributes` no longer marks it
  `linguist-generated`), and CI writes the changed dist files and the bundle's sha256 to the job
  summary of every pull request so reviewers see the shipped artifact change.
