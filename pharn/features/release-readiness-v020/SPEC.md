---
spec_id: release-readiness-v020
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 ships seven diff-only test-integrity signals (TI01, TI03, TI04, TI10, TI11, TI13, TI14), the
`test-integrity` input and the accept label, and the Skylos nine benchmark is pinned by AC tests at 2 of 9. The
maintainer wants the repository ready to cut v0.2.0 (backlog item 9 of Epic 1), without cutting it. Today the docs do
not say plainly what test integrity misses, the README has no section on test integrity and its Roadmap still says
test-tampering detection is unbuilt, the changelog does not record the benchmark, and nothing checks a published
release before the Marketplace step. The maintainer also has no written step for the one case the repository's own CI
cannot produce: a pull request from a fork. This increment writes the limits section, the README section, the
changelog line and the release checklist steps, and adds a release smoke script with a small fixture repository that
runs a given Action bundle end to end and fails loudly when its output is wrong. It changes no product behaviour.

## Scope

**In scope:**

- `docs/LIMITS.md`: a new `##` section titled "What test integrity does not catch", placed after the existing
  "What the accept label misses" subsection, stating what the shipped signals and the accept label cannot see, the
  seven Skylos cases the diff-only signals miss with the signal planned for each, the three misses named in the
  test-integrity spec's "Definition of done" item 6, and the headline "2 of 9"; and the stale sentence in section 1
  saying weakened, skipped or focused tests and deleted test cases are "not detected yet" corrected to what is built.
- `README.md`: a `## Test integrity` section listed in Contents, explaining the `test-integrity` input, linking to the
  existing Accept label section, showing an example "🔍 Test integrity" comment section taken from the real renderer's
  output for the `fixtures/skylos-nine/added-skip` case, and stating the 2-of-9 Skylos result with a link to
  `docs/LIMITS.md`; and the Roadmap bullet on test-tampering detection rewritten so it no longer says the feature is
  wholly unbuilt.
- `CHANGELOG.md`: one or more lines under `## [Unreleased]` recording the Skylos benchmark (2 of 9, pinned by AC
  tests) and the new LIMITS section; the Report v2 line is already there and is kept as is.
- `fixtures/smoke/`: a tiny hand-written repository in two states (base and head), the coverage data for the head, and
  `fixtures/smoke/expected-summary.txt`, the lines the job summary must contain.
- `scripts/smoke-release.mjs`: a Node script (built-ins only) run from the repository root as
  `node scripts/smoke-release.mjs <action-dir>`, which builds a temporary git repository from `fixtures/smoke/`, runs
  `<action-dir>/packages/action/dist/index.js` against it as a subprocess, checks its exit code, `verdict` output,
  job summary lines and footer version, prints one `ok` line or the failed check, and removes its temporary directory.
- `docs/RELEASING.md`: the fork-PR step in the release checklist, and the post-release `Release smoke` job and the
  `node scripts/smoke-release.mjs` command (what it runs, that red means no Marketplace step, that it also runs in the
  dry run on the committed bundle), keeping every existing rule.
- AC tests for all of the above, reading files inside test bodies.

**Out of scope (non-goals):**

- Any edit under `.github/workflows/**`, including the `Release smoke` job in `release.yml` and a smoke step in the
  `verify` job; these are done by hand after this increment.
- Any change under `packages/*/src`, `schema/`, `action.yml` or `packages/action/dist`; no new signal, message code,
  input, output or setting.
- Version numbers in any `package.json` or `packages/core/src/version.ts`, the README `uses: pharn-dev/pharn-ci@v0.1.0`
  pins, the README Status note and the `latest release` line of `docs/LIMITS.md`.
- A version heading in `CHANGELOG.md`, a release PR, a tag, dispatching any workflow, and the Marketplace listing.
- The pytest half of the Skylos benchmark and the published precision table (backlog items 17 and 18).
- Rewriting existing CHANGELOG entries, and changing any existing test, any fixture outside `fixtures/smoke/`, or any
  file under `fixtures/golden*`.
- Any new dependency.

## Acceptance Criteria

- **AC-1** Given `docs/LIMITS.md` When its `##` section whose heading contains "What test integrity does not catch" is
  read up to the next `## ` heading Then there is exactly one such heading, it comes after the
  `### What the accept label misses` heading, the section names TI01, TI03, TI04, TI10, TI11, TI13, TI14 and the accept
  label, it contains `Skylos` and the text `2 of 9`, it has a list item naming `deleted-test` with TI01 and one naming
  `added-skip` with TI03 as caught, and it has a list item (its lines joined) for each of the seven missed cases holding
  the case name in a code span and its planned signal: `emptied-assertion` with TI05, `deselect-setting` with TI09,
  `hard-coded-answer` with TI15, `always-true-matcher` with TI17, `replaced-test` with TI02, `loosened-assertion` with
  TI06 and `edited-expected-value` with TI07
  - verify: unit
- **AC-2** Given the same LIMITS section When its text is read Then it contains `same name` and `trivial body` (a test
  replaced by a new test with the same name and a trivial body), `toEqual(expectedFromOutput)` (semantic weakening
  that keeps the matcher), and both `mock` and `setup file` (mocks introduced in setup files outside the diff), and it
  contains the word `planned` for the signals that are not built
  - verify: unit
- **AC-3** Given the nine case directories of `fixtures/skylos-nine/` When each case runs through `check()` in mode
  `block` with the inputs the Skylos AC tests use Then exactly the two cases the LIMITS section lists as caught give a
  report with a test-integrity signal, each carrying only the id the section names for it, and the seven cases it
  lists as missed give none, so the live count is 2 of 9, the figure the section states
  - verify: unit
- **AC-4** Given `docs/LIMITS.md` and its copy at commit `b2c3a56373046ee6b64f913581a645f98240310c` When both are read
  Then the current file no longer contains `Weakened, skipped or focused tests inside a file and deleted test cases are
  not detected yet`, and every `##` and `###` heading line of the earlier copy is still present
  - verify: unit
- **AC-5** Given `README.md` and its copy at commit `b2c3a56373046ee6b64f913581a645f98240310c` When both are read Then
  the current file has exactly one `## Test integrity` heading, the Contents list holds `- [Test integrity](#test-integrity)`,
  the section up to the next `## ` heading contains `block`, `warn`, `off`, `default`, `test_integrity.mode`,
  `stricter`, a link to `#accept-label`, a link to `docs/LIMITS.md`, `Skylos` and `2 of 9`, and holds no `uses:` line,
  and the `> **Status:**` note and every `uses: pharn-dev/pharn-ci@` line are identical to the earlier copy's
  - verify: unit
- **AC-6** Given the `fixtures/skylos-nine/added-skip` case When it runs through `check()` in mode `block` with the
  inputs the Skylos AC tests use and the "🔍 Test integrity" section of `renderMarkdown()` is taken from its heading to
  the next `### ` heading Then every non-blank line of that rendered section appears, in the same order, among the
  lines of the README `## Test integrity` section after a leading `> ` or `>` is removed from each README line
  - verify: unit
- **AC-7** Given `README.md` When its `## Roadmap` section is read Then no line of it contains
  `deleted test files are already named by`, and it contains a link to `#test-integrity`
  - verify: unit
- **AC-8** Given `CHANGELOG.md` and its copy at commit `b2c3a56373046ee6b64f913581a645f98240310c` When the
  `## [Unreleased]` section is read up to the next `## [` line Then it contains `Skylos`, `2 of 9` and `docs/LIMITS.md`,
  it still contains `Report v2`, `schemaVersion` and `report.v1.json`, every non-blank line of the earlier copy's
  Unreleased section is still present in it, and the list of lines starting with `## [` is the same as in the earlier
  copy
  - verify: unit
- **AC-9** Given `docs/RELEASING.md` and its copy at commit `b2c3a56373046ee6b64f913581a645f98240310c` When the list
  items of `## Cutting a release` are read with their continuation lines joined Then an item that contains `fork`,
  `job summary` and `comment` comes before the item starting `**Release.**`; the file has a paragraph or list item
  containing `Release smoke`, `node scripts/smoke-release.mjs` and `Marketplace`, and one containing `smoke` and
  `dry run`; and every `##` heading line and every list item's leading bold text (`**…**`) of the earlier copy is still
  present
  - verify: unit
- **AC-10** Given `fixtures/smoke/expected-summary.txt` When its lines are read Then it holds the lines
  `### 🔍 Test integrity` and `No test-integrity findings (mode: block).`, and no line of it matches `pharn-ci` followed
  by a space and a digit
  - verify: unit
- **AC-11** Given the repository's committed `packages/action/dist` and `TMPDIR` set to a new empty directory When
  `node scripts/smoke-release.mjs .` runs from the repository root Then it exits 0, its standard output holds exactly
  one non-blank line and that line starts with `ok`, and the `TMPDIR` directory is empty afterwards
  - verify: integration
- **AC-12** Given `TMPDIR` set to a new empty directory and four broken setups: an action directory whose bundle
  writes `verdict` `fail` and exits 0; a copy of the committed bundle whose `packages/action/package.json` version is
  `9.9.9`; a copy of `scripts/smoke-release.mjs` and `fixtures/smoke/`, laid out as in the repository, whose
  `expected-summary.txt` has the extra line `THIS LINE IS NOT IN THE SUMMARY`, run against the committed bundle; and an
  action directory whose bundle exits 1 When the script runs on each Then each run exits non-zero, its combined output
  names the failed check (`verdict`, `9.9.9`, `THIS LINE IS NOT IN THE SUMMARY` and `exit` respectively) and holds no
  line starting with `ok`, and the `TMPDIR` directory is empty after each run
  - verify: integration
- **AC-13** Given a parent environment that sets `GITHUB_EVENT_NAME=pull_request`, `GITHUB_EVENT_PATH`,
  `GITHUB_TOKEN` and `INPUT_PR-NUMBER=1`, and an action directory whose bundle records its own environment to a file
  When the script runs with that action directory Then the recorded environment holds none of those four names, its
  `INPUT_` variables are exactly `INPUT_COVERAGE-FILE` (non-empty), `INPUT_THRESHOLD`, `INPUT_BASE-REF` (`HEAD~1`),
  `INPUT_TEST-INTEGRITY` (`block`), `INPUT_COMMENT` (`false`) and `INPUT_GITHUB-TOKEN` (empty), and
  `GITHUB_WORKSPACE`, `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT` and `RUNNER_TEMP` all lie inside the `TMPDIR` the script
  was given
  - verify: integration
- **AC-14** Given `scripts/smoke-release.mjs` When its import and require specifiers and its text are read Then every
  specifier starts with `node:`, none is `node:http`, `node:https`, `node:http2`, `node:net`, `node:tls`, `node:dns` or
  `node:dgram`, and the text contains no `fetch(`
  - verify: unit

## Constraints

- AGENTS.md: core stays pure (no I/O in `packages/core/src`); no new dependency; a user-visible change gets a CHANGELOG
  line under Unreleased; no existing test is weakened, skipped or deleted.
- Existing tests, every fixture outside `fixtures/smoke/` and every file under `fixtures/golden*` stay byte-identical,
  and the whole suite (`pnpm test`) and `pnpm lint` pass. The existing docs tests (`ac-release-*.test.ts`,
  `ac-*-docs.test.ts`) keep passing, which pins the README to four `uses: pharn-dev/pharn-ci@v0.1.0` lines and no other
  unpinned `uses:` line, and pins the RELEASING step order (CHANGELOG date, then README pins, then dispatch).
- Docs are plain and exact and claim nothing the code does not do: the not-built signals (TI02, TI05, TI06, TI07, TI09,
  TI15, TI17) are named only as planned.
- `scripts/smoke-release.mjs` uses Node built-ins only, makes no network call, writes only inside its temporary
  directory (taken from the OS temporary directory, so `TMPDIR` decides it), and removes it on success and on failure.
- The script runs the Action bundle as a subprocess with a fresh environment: `PATH`, `HOME`, the six `INPUT_*`
  variables of AC-13, `GITHUB_WORKSPACE` (the temporary repository), `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT` and
  `RUNNER_TEMP` (all inside the temporary directory); it never forwards `GITHUB_*` or `INPUT_*` variables of its own
  environment, so a CI runner's event and token cannot make the Action call the GitHub API.
- The temporary repository is built with `git -c user.name=... -c user.email=...` so it works where git has no
  identity; the base commit holds the base state and the head commit adds a small source change and its tests.
- The script reads the `verdict` output in either form GitHub Actions accepts (`name=value` or a `name<<DELIMITER`
  block), compares whole lines of the summary with the non-blank lines of `expected-summary.txt`, and reads the version
  from `<action-dir>/packages/action/package.json`, expecting `pharn-ci <version>` in the summary footer.
- AC tests read files inside test bodies; AC tests that run the script use a test timeout long enough for a git
  repository and a bundle run, and need no GitHub token or network.

## Assumptions

- The coverage file is written into the temporary repository's working tree after the head commit and is not committed:
  a tracked coverage file adds `COVERAGE_FILE_TRACKED` (warn) and the verdict would be `warn`, not the `pass` the smoke
  asserts. A trial run of the committed bundle against such a repository gave exit 0, `verdict` `pass`, the line
  `No test-integrity findings (mode: block).` and the footer `pharn-ci 0.1.0`.
- `RUNNER_TEMP` is set inside the temporary directory because the bundle writes `report.json` under `RUNNER_TEMP`, or
  the OS temporary directory when it is unset, which would leave a file behind.
- The threshold passed to the Action is 80 and the head's added source lines are all covered, so diff coverage is 100%.
- The CHANGELOG Unreleased section already carries the Report v2 line (schemaVersion becomes the number 2, a v2 report
  does not validate against `report.v1.json`, tools must switch on `schemaVersion`), so no second line is added for it.
  Its parenthetical "empty until test-integrity signals ship" is left as written because existing entries are not
  rewritten.
- The README example section is the one rendered for `fixtures/skylos-nine/added-skip` (a TI03 block finding), quoted
  with `> ` like the existing "Example PR comment".
- The `Release smoke` job and the smoke step in the dry run that `docs/RELEASING.md` describes are added to
  `.github/workflows/release.yml` by hand after this increment, before it merges; this increment cannot edit workflows.
- Commit `b2c3a56373046ee6b64f913581a645f98240310c` (current `main`) is the base for the "still present" checks, and
  the CI checkout has it, as the existing `ac-test-integrity-mode-docs.test.ts` already assumes for its base commit.
- Paths in AC-13 are compared after resolving symbolic links (macOS's temporary directory is a link).
- The repository has `"test": "vitest run"` and no end-to-end runner; the script-running criteria are `integration`
  tests run by vitest.
