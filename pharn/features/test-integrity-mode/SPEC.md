---
spec_id: test-integrity-mode
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 (epic E1) adds test integrity, and the first thing a team must be able to do is choose how strict it
is. Report v2 already carries an empty `testIntegrity` block whose mode is always `warn`. This increment makes the
mode a setting: a `test-integrity` Action input (and CLI flag) with the values `block`, `warn` and `off`, and a
`test_integrity.mode` key in `.pharn/ci.yml`. A pull request carries its own `.pharn/ci.yml`, so that file may only
make the check stricter; it can never switch it off or loosen it, and when it tries, the report says so. The report's
`testIntegrity.mode` and `testIntegrity.source` say which mode applies and where it came from, and the PR comment and
job summary gain a "🔍 Test integrity" section that shows the mode even though no signal exists yet. Later E1 items add
the signals that this mode governs.

## Scope

**In scope:**

- The `test-integrity` Action input (declared in `action.yml`) and the matching CLI flag `--test-integrity`, with
  the values `block`, `warn` or `off`.
- The `.pharn/ci.yml` key `test_integrity.mode` with the same three values, parsed and validated with the rest of
  the config.
- A pure precedence function in `packages/core`: the base mode is the input when given, else the default `warn`;
  the config may only raise it (off < warn < block); the effective mode is the stricter of the two.
- `testIntegrity.mode` set to the effective mode and `testIntegrity.source` set to `input`, `config` or `default`.
- Two message codes, `TEST_INTEGRITY_MODE_IGNORED` (a config value looser than the base was ignored) and
  `TEST_INTEGRITY_OFF` (the effective mode is off), added to the "Known codes" documentation in
  `schema/report.v2.json`.
- A "🔍 Test integrity" section in the markdown that core renders for the PR comment and the job summary, with an
  empty state for every mode.
- Precedence fixtures and tests, a README input entry, a `CHANGELOG.md` Unreleased line, and a `docs/THREAT-MODEL.md`
  line stating that the PR-carried config cannot loosen the mode.

**Out of scope (non-goals):**

- Every test-integrity signal TI01–TI16 and any detection; `signals` stays empty, `languages` stays empty and
  `testIntegrity.verdict` stays `pass`.
- The accept label, `testIntegrity.accepted`, and the message-level downgrade of blocks (no block exists yet).
- The app policy layer and the `policy` source value (BACKLOG item 20), including per-signal overrides.
- Test-file detection and the behaviour of `TEST_FILES_DELETED` (item 3).
- `docs/LIMITS.md` (item 9) and the release itself.
- Changing `schema/report.v1.json`, or any other change to how the verdict is computed.

## Acceptance Criteria

- **AC-1** Given no `test-integrity` input and no `test_integrity` key in the config When `check()` runs Then the
  report's `testIntegrity.mode` is "warn" and `testIntegrity.source` is "default", no `TEST_INTEGRITY_OFF` or
  `TEST_INTEGRITY_MODE_IGNORED` message is present, and the report passes `expectValidReport`
  - verify: unit
- **AC-2** Given the input is "block" and the config has no `test_integrity` key When `check()` runs Then
  `testIntegrity.mode` is "block" and `testIntegrity.source` is "input"; and given the input is "block" and the
  config says "warn", the mode is still "block", the source is "input" and the report has a
  `TEST_INTEGRITY_MODE_IGNORED` message of level "warn" whose text names both "warn" and "block"
  - verify: unit
- **AC-3** Given the config says "block" and the input is absent, or the input is "warn" When `check()` runs Then
  `testIntegrity.mode` is "block" and `testIntegrity.source` is "config", with no `TEST_INTEGRITY_MODE_IGNORED`
  message
  - verify: unit
- **AC-4** Given the config says "off" or "warn" and the base is "warn" (the default or an input), or the config
  says "off" and the base is "block" When `check()` runs Then the effective mode is the base mode, the source is
  that of the base, and exactly one `TEST_INTEGRITY_MODE_IGNORED` message of level "warn" is present only when
  the config value is looser than the base; a config value equal to the base adds no such message
  - verify: unit
- **AC-5** Given the input is "off" and the config says nothing or "off" When `check()` runs Then
  `testIntegrity.mode` is "off", `testIntegrity.source` is "input", exactly one `TEST_INTEGRITY_OFF` message of
  level "info" is present, `testIntegrity.verdict` is "pass" and the report passes `expectValidReport`; and given
  the input is "off" and the config says "block", the mode is "block" with source "config" and no
  `TEST_INTEGRITY_OFF` message
  - verify: unit
- **AC-6** Given a `test-integrity` input value other than "block", "warn" or "off" (including "Block" and
  "true"), or a `test_integrity.mode` config value other than those three, or an unknown key under `test_integrity`
  When the input is resolved or the config is parsed Then it is rejected with an error that names the allowed
  values; and given an empty or whitespace-only input, it counts as not given
  - verify: unit
- **AC-7** Given a report for each mode "warn", "block" and "off" When core renders its markdown Then a "🔍 Test
  integrity" section appears after the Diff coverage section and before the Agent setup section; for "warn" and
  "block" it reads "No test-integrity findings (mode: <mode>).", for "off" it states that test integrity is off,
  and the section adds no heading, raw HTML or extra lines beyond those fixed texts whatever the config or input
  contained
  - verify: unit
- **AC-8** Given the golden fixture inputs When `check()` runs without a `test-integrity` input Then the report
  JSON equals the recorded golden report exactly as before this change, and the rendered golden markdown equals
  the previous golden markdown with only the "🔍 Test integrity" section added
  - verify: unit
- **AC-9** Given the Action in the test harness with the input `test-integrity` set to "block" and a repository
  config that says "off" When it runs Then the `report.json` at `report-path` has `testIntegrity.mode` "block", the
  posted PR comment contains "No test-integrity findings (mode: block).", and the step does not fail because of
  the mode; and given the input value "loud", the run fails with an error naming "block", "warn" and "off"
  - verify: integration
- **AC-10** Given the CLI `pharn-ci check --format json` run on the golden fixture repository with
  `--test-integrity block` When it runs Then stdout parses to a report with `testIntegrity.mode` "block" and
  source "input" that passes the v2 schema, and `--test-integrity maybe` exits with code 2 and a message naming
  the allowed values
  - verify: integration
- **AC-11** Given the repository docs and `action.yml` When they are read Then `action.yml` declares a
  `test-integrity` input whose description names block, warn, off, the default warn and that `.pharn/ci.yml` can
  only tighten; `CHANGELOG.md` has an Unreleased entry naming the `test-integrity` input and
  `test_integrity.mode`; the README documents both; `docs/THREAT-MODEL.md` states the PR-carried config cannot
  loosen the mode; and `schema/report.v2.json` lists `TEST_INTEGRITY_MODE_IGNORED` and `TEST_INTEGRITY_OFF` among
  the known codes while `schema/report.v1.json` is byte-identical to the base commit's copy
  - verify: unit

## Constraints

- AGENTS.md rule 1: `packages/core` stays pure; the input, the config text and the mode reach core as plain data.
- AGENTS.md rule 2: the schema is the source of truth; `schema/report.v1.json` is not edited; the new codes are
  documented in `schema/report.v2.json` within v2, and message codes are stable once added.
- AGENTS.md rule 3 and 4: every report a test produces is validated with `expectValidReport`; no existing test is
  weakened or skipped; golden files change only because the output changes on purpose, regenerated with
  `pnpm test -u` and reviewed.
- AGENTS.md rule 7: `packages/action/dist` is rebuilt and committed.
- CLAUDE.local.md: settings the PR carries can never loosen a gate; workflow inputs beat `.pharn/ci.yml`, and
  `.pharn/ci.yml` may only tighten.
- Message levels follow `product/REPORT-V2.md`: `TEST_INTEGRITY_OFF` is "info"; the ignored-loosening message is
  "warn", the level the spec gives `POLICY_OVERRIDE_IGNORED`, so it shows up in the verdict as a warning and never
  fails the check.
- No new runtime dependency, no network call and no new GitHub API call.

## Assumptions

- The CLI mirrors the Action's other inputs (`--threshold`, `--exclude`, `--coverage-root`, `--expect-agent-setup`),
  so the new input gets the matching flag `--test-integrity`.
- Input values are case-sensitive and trimmed, like the other enumerated inputs; an empty input counts as not
  given, as for every other Action input.
- The source is `input` whenever an input was given and it is at least as strict as the config; it is `config`
  only when the config raised the mode above the base; it is `default` when neither was given.
- A config value equal to the base is not "ignored" and adds no message, since it changes nothing.
- A warn-level message makes the overall report verdict "warn" (the existing `verdictOf` rule), which is the
  intended way for a repo to learn its config tried to loosen the mode.
- The "🔍 Test integrity" section sits between the Diff coverage section and the Agent setup section, with the
  Messages section keeping its current place relative to them as the existing layout decides.
- The job summary and the PR comment share one renderer in core, so one change covers both.
- The project's `test` script runs vitest, which PHARN's gate discovery finds, so the criteria above have a
  runner.
