---
spec_id: ti14-ti11-ci-config-signals
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 adds test-integrity signals computed from the diff. Two of the ways a pull request can make its own checks
pass without testing more are to edit the check's own settings and to edit the CI workflow. Today both only raise the
`CONFIG_CHANGED_IN_DIFF` warning, which names the changed file but says nothing about whether the edit loosened anything.
TI14 must report that a PR lowered the coverage threshold or added a coverage exclusion in the pharn-ci config, and TI11
must report that a PR changed a workflow so that CI stops running the tests (a test step removed, the pull request trigger
removed, the matrix reduced, a step or job made non-failing, disabled or given a near-zero timeout). A reviewer then sees
a precise, recorded finding with a hint, and a block-mode setup fails the check. The local diff has no context lines, so
every rule has to be decided from added and removed lines alone; rules that cannot tell which step a line belongs to are
warnings by design.

## Scope

**In scope:**

- The diff reader keeping the text of added and removed lines for the pharn-ci config in use and for workflow files, with the existing bounds, through both the whole-text and the streaming path, including a custom config path.
- Signal TI14: coverage threshold lowered or removed, and a coverage exclusion added, in the config file in use.
- Signal TI11: test step removed, pull request trigger removed (both block), matrix reduced, `continue-on-error: true` added, a disabling `if:` added, a near-zero `timeout-minutes` added (all warn), in workflow files.
- The effect of the effective test-integrity mode (block, warn, off) on both signals, on `testIntegrity.verdict` and on the overall verdict.
- One `TEST_INTEGRITY_TI14` and one `TEST_INTEGRITY_TI11` message per report that carries findings of that id; `CONFIG_CHANGED_IN_DIFF` kept as it is.
- The "Test integrity" section of the PR comment listing the findings with `path:line` and a hint per id; hints for the two new message codes.
- Fixtures under `fixtures/test-integrity/TI14/` and `fixtures/test-integrity/TI11/`, and updates to the schema description, CHANGELOG, README, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`.

**Out of scope (non-goals):**

- "Required-check job renamed" and "`paths-ignore` widened over source": they need policy and land with the app policy work.
- The accept label, per-signal overrides and app policy.
- Any change to the arguments of the git diff or to the context lines it returns.
- Reading the head or base content of the config or a workflow; only the diff is read.
- Any new action input, CLI flag or setting: nothing carried by the pull request can loosen this check.
- Changing `schema/report.v1.json`, or removing or renaming any existing message code or report field.

## Acceptance Criteria

- **AC-1** Given a unified diff that edits `.pharn/ci.yml`, `.github/workflows/ci.yml`, `.github/workflows/x.yaml`, a source file and a non-workflow YAML file such as `.github/dependabot.yml` When it is parsed with the file-selection predicate the core exports for signal text (given the default config path, and again given the custom config path `config/pharn.yml`) Then the predicate selects the config in use, the two workflow files and the test files and nothing else, selected files carry `hunks` with the added and removed line text, the others carry none, and the custom config path is selected in place of `.pharn/ci.yml` only when it is given
  - verify: unit
- **AC-2** Given a diff that lowers the threshold in a custom config path `config/pharn.yml`, read once through the streaming reader given that config path and once as one text passed to the check with the same `configPath` When both reports are produced and the stream is cut into chunks of 7 characters Then the two `testIntegrity` blocks and the two message lists are equal and hold a TI14 signal for `config/pharn.yml`, and the same diff read through the streaming reader without the config path holds none
  - verify: integration
- **AC-3** Given diffs of `.pharn/ci.yml` that change `threshold: 80` to `threshold: 70`, remove the threshold line, delete the config file, raise the threshold to `90`, keep it at `80` on a moved line, add a threshold line where there was none, and set a quoted value `"70"` When the check runs in mode `block` Then the lowered, removed and deleted cases each give one TI14 signal with severity `block`, the path, a line number (the old-file line for a removed line, the new-file line for an added line) and a detail of at most 300 characters that names the old and new numbers or says the threshold was removed, and the raised, unchanged, newly added and quoted cases give no TI14 signal
  - verify: integration
- **AC-4** Given diffs of `.pharn/ci.yml` that add the flow list `exclude: [dist/**, docs/**]`, add an `exclude:` key followed by block items in the same hunk, append the item `- src/legacy/**` to an existing list while the check input's exclusion patterns hold `src/legacy/**`, and, as controls, remove an exclusion item, move an item (the same value removed and added), add an item to `coverage.file`, change `setup.require`, and append a `- src/other/**` item the check input's exclusion patterns do not hold When the check runs in mode `block` Then each of the first three cases gives one TI14 signal of severity `block` whose detail does not hold any pattern text, and none of the controls gives a TI14 signal
  - verify: integration
- **AC-5** Given a lowering diff of the config and a check whose config path is outside the repository (an absolute path elsewhere or one led by `..`), and the same diff whose config file is the one named by the config path When the check runs Then the outside-path run gives no TI14 signal and the other run gives one
  - verify: integration
- **AC-6** Given diffs of workflow files that remove the lines `- run: pnpm test:coverage`, `run: npx vitest run`, `pytest -q` and `go test ./...`, delete a whole workflow holding `pnpm test`, remove a commented-out line `# pnpm test`, move `pnpm test` from `ci.yml` to `test.yml` in the same diff, reflow the command with other spacing, and rename a workflow without any removed line When the check runs in mode `block` Then each removal and the deleted workflow give one TI11 signal of severity `block` with the old-file line, the comment-only removal, the move, the reflow and the pure rename give none, and the detail does not hold the command text
  - verify: integration
- **AC-7** Given workflow diffs that remove the `pull_request:` key, remove `pull_request_target`, change `on: [push, pull_request]` to `on: [push]`, change `on: pull_request` to `on: push`, and, as controls, add only a `push:` trigger beside a kept `pull_request:` and replace `pull_request:` by `pull_request_target:` in the same file When the check runs in mode `block` Then the first four give one TI11 signal each of severity `block`, and the controls give none
  - verify: integration
- **AC-8** Given workflow diffs that change `node-version: [18, 20, 22]` to `[20, 22]`, to `[22]`, and to `[18, 20, 22, 24]`, and as a control a changed key `os: [ubuntu-latest]` to `os: [ubuntu-latest, macos-latest]` When the check runs in mode `block` Then the first two give one TI11 signal of severity `warn` (the matrix is reduced, and a warn is not raised by the mode), and the last two give none
  - verify: integration
- **AC-9** Given workflow diffs that add `continue-on-error: true`, add `continue-on-error: ${{ matrix.experimental }}`, add `continue-on-error: false`, and move `continue-on-error: true` (removed and added in the same file) When the check runs in mode `block` Then only the first gives a TI11 signal, with severity `warn` and the new-file line
  - verify: integration
- **AC-10** Given workflow diffs that add `if: false`, `if: ${{ false }}`, `if: 'false'`, `if: github.event_name == 'push'`, `if: github.event_name != 'pull_request'`, and, as controls, add `if: always()`, `if: success()`, `if: ${{ !cancelled() }}`, `if: github.ref == 'refs/heads/main'` and `if: contains(github.event.head_commit.message, 'x')` When the check runs in mode `block` Then each of the first five gives one TI11 signal of severity `warn` and none of the controls gives a signal
  - verify: integration
- **AC-11** Given workflow diffs that add `timeout-minutes: 0`, `timeout-minutes: 1`, `timeout-minutes: 15` and `timeout-minutes: ${{ vars.T }}`, and a workflow diff that only bumps an action version, adds a job, adds a step, changes permissions or edits a comment, and a diff that edits `.github/dependabot.yml` and `docs/workflows/ci.yml` with the same lines as a firing case When the check runs in mode `block` Then the first two give one TI11 signal of severity `warn` each and every other diff gives no TI11 signal
  - verify: integration
- **AC-12** Given one diff that lowers the threshold, deletes a test file whose removed lines define tests while its source stays, removes a `pull_request:` trigger and adds `continue-on-error: true`, with the exclusions input holding no pattern When the check runs in mode `block`, in mode `warn` and in mode `off` Then in `block` the signals are sorted by id, then path, then line, then detail, TI14 and TI11 block signals have severity `block`, the warn signal stays `warn`, `testIntegrity.verdict` is `fail`, and the messages hold one `TEST_INTEGRITY_TI14` and one `TEST_INTEGRITY_TI11` message with level `error` (the TI11 one is `error` because one of its signals is block), plus `TEST_INTEGRITY_TI01` and the unchanged `CONFIG_CHANGED_IN_DIFF`; in `warn` every block signal is shown as `warn`, the verdict is `warn` and the message levels are `warn`; in `off` there is no TI14 or TI11 signal or message, `testIntegrity.verdict` is `pass` and `CONFIG_CHANGED_IN_DIFF` is still reported
  - verify: integration
- **AC-13** Given a report with TI14 and TI11 signals of severity block, warn and info, one with a non-null line and one with a null line, and a report with none When the PR comment is rendered and the CLI is run with `--format json` on a lowering diff Then the "Test integrity" section holds one line per signal with the id in bold, the path as `path:line` in a code span when the line is non-null and `path` otherwise, and the detail, and an indented "Hint:" line per id, the hints for `TEST_INTEGRITY_TI14` and `TEST_INTEGRITY_TI11` exist in the Messages section and none mentions an accept label, the empty report keeps the line `No test-integrity findings (mode: warn).`, the CLI JSON holds the TI14 signal, and every report validates against `schema/report.v2.json`
  - verify: integration
- **AC-14** Given the existing tests, the `fixtures/golden` outputs and the `fixtures/test-integrity/TI01` diffs When the whole suite runs with this increment Then every existing assertion still passes unchanged, except tests whose diffs edit a workflow or the config, which may pass `testIntegrityMode` `off` to keep their assertions about the older signals, and the TI01 signals and message for the TI01 fixtures are identical to before
  - verify: integration
- **AC-15** Given the repository files When the schema, CHANGELOG, README, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the new fixtures are read Then `schema/report.v2.json` names `TEST_INTEGRITY_TI14` and `TEST_INTEGRITY_TI11` in its message-code description, `schema/report.v1.json` is byte-identical to the base commit, the CHANGELOG Unreleased section mentions TI14 and TI11, the README names both with their message codes, `docs/LIMITS.md` has sections "What TI14 misses" and "What TI11 misses" naming the missing context lines, the unlisted runners, the moved test job, the E5 deferrals, the input-based exclusion ownership, the workflow-input threshold and the kept-text caps, `docs/THREAT-MODEL.md` covers the kept text of the config and workflow files and the fixed-sentence details, and `fixtures/test-integrity/TI14/` and `fixtures/test-integrity/TI11/` each hold at least five must-trigger and five must-not-trigger diffs
  - verify: unit

## Constraints

- The core package stays pure: no file, process, network, clock or random access in `packages/core/src`.
- Report v2 stays additive to v1: no field or message code is removed, renamed or retyped, and `schema/report.v1.json` is not changed.
- Matching on diff text runs in linear time on a line cut to 400 characters; the memory kept for line text is bounded per file (5000 lines, 400 characters per line) as for test files, and files outside the test, config and workflow groups keep no text.
- No file content, diff text, command, pattern or test name leaves the report: a finding holds paths, a line number, a fixed reason sentence of at most 300 characters and, for a threshold, two numbers.
- No new dependency, no new action input, no CLI flag and no new setting; the mode precedence of the earlier increments is unchanged; the CLI and Action dist is rebuilt.
- Existing tests are not weakened, skipped or deleted; goldens change only where the new section lists findings.

## Assumptions

- The mode rules of the previous increments apply as they are: default `warn`, the config can only tighten, `off` computes nothing; in mode `warn` a block signal is reported with effective severity `warn` so the signal, the message level and the verdict agree, and a signal that is warn by design stays `warn` in every mode but `off`.
- The message level for an id is `error` if any of its signals is block, `warn` if any is warn, else `info`, as for TI01.
- A threshold line is recognized as the key `threshold` at any indentation with a plain decimal number; this is a heuristic on one line, and the config parser stays the authority on what the config means.
- Rule (c) of the exclusion rule relies on the exclusion patterns the check was given (the check input's exclusion list) because a bare list item cannot be attributed to a key without context lines; the shape of a matching item is compared after trimming and unquoting.
- A test command is recognized by a line pattern anchored at the start of the command after optional `- `, `run:` and `|`; commands outside the listed runners are a documented miss.
- "The same normalized command added anywhere in the workflow files of the diff" exempts a moved or reflowed step, even when it was moved to a different job; this is documented in `docs/LIMITS.md`.
- A flow-list shrink compares the same key on a removed and an added line in one file; block-list matrices are a documented miss.
- One signal is reported per rule per file, on the first matching line, so a file with several removed test commands gives one TI11 signal for that rule.
- `testIntegrity.languages` stays an empty list because only line patterns run.
- Existing tests whose fixtures edit a workflow or the config and compare against older signals may pass `testIntegrityMode` `off`; the reason is recorded in BUILD.md and the PR description.
- The repository has no end-to-end runner, so all criteria are verified at unit or integration level; the fixtures are plain diffs run through the check, the streaming reader and the CLI.
- Hints for TI14 and TI11 do not mention the accept label because that feature ships in a later item.
