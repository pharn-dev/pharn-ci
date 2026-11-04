---
spec_id: require-agent-setup
state: Approved
spec_content_hash: c5ece5f9ec754e6ab4d11f027ec1cd570a062620bc4f680d092b2c7e16926dee
approved_by: model
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
spec_kind: quick
---

## Intent

Teams that rely on AI coding agents want pharn-ci to be able to fail a PR check when the repo has no
agent setup files at all (finding F-03). Today the agent setup inventory is informational only: a repo
with no CLAUDE.md, AGENTS.md, .cursor/rules or similar gets an `info` message and never a failing
verdict. They want an opt-in switch, off by default, that turns that missing setup into a failure, set
from `.pharn/ci.yml`, the Action input or the CLI flag, so existing users see no change unless they ask
for it.

## Scope

**In scope:**

- A config key `setup.require` in `.pharn/ci.yml`, accepting only `true` or `false`; any other value is
  rejected with an error in the config parser's usual style.
- An Action input `require-agent-setup`, declared in `action.yml` as not required, with no `default:`
  key, and a description saying it defaults to false. An empty input falls back to `setup.require`, then
  to false (the precedence `threshold` and `coverage-format` use). A set value is parsed like the
  existing boolean inputs such as `fail-on-threshold`, and an invalid value is an error.
- A CLI flag `--require-agent-setup`; when given it overrides `setup.require`, otherwise the config value
  applies, then false.
- When the option is on and the inventory finds no agent setup files, the message `NO_AGENT_SETUP_FILES`
  is emitted at level `error` and the verdict is `fail`. When it is off, the message stays `info` exactly
  as today. The code is the same in both cases; the text may say that setup is required by config.
- Docs: README inputs table, config reference and the "What it proves" section say the inventory is
  informational unless `require-agent-setup` is on; a CHANGELOG line under Unreleased;
  `docs/THREAT-MODEL.md` notes that the PR-carried `.pharn/ci.yml` can switch the requirement off;
  `schema/report.v1.json` updates only the `NO_AGENT_SETUP_FILES` description.

**Out of scope (non-goals):**

- Changing which files count as agent setup (scan rules), the tools enum, or the inventory table.
- Requiring a specific tool's setup file, or a minimum number of files.
- Adding a new field to the Report v1 output.
- A CLI flag that turns the requirement off when the config turns it on (such as `--no-require-agent-setup`).

## Acceptance Criteria

- **AC-1** Given a repo whose tracked files include no agent setup file When `check()` runs with the
  agent setup requirement on Then the returned report has a `NO_AGENT_SETUP_FILES` message at level
  `error` and verdict `fail`, and it validates against `schema/report.v1.json`; with the requirement off
  or not given the same input returns that message at level `info` and the same verdict as today, and a
  repo that has an agent setup file returns no `NO_AGENT_SETUP_FILES` message whether the requirement is
  on or off
  - verify: unit
- **AC-2** Given a `.pharn/ci.yml` text with `setup:` and `require: true` (or `false`) When
  `parseConfig` reads it Then it returns a config whose `setup.require` is that boolean, and a text whose
  `setup.require` is a non-boolean value (for example a string or a number) throws a `ConfigError` naming
  `setup.require`
  - verify: unit
- **AC-3** Given a repo with no agent setup files and a `.pharn/ci.yml` setting `setup.require` When the
  CLI runs `check` with or without `--require-agent-setup`, and when the Action runs with the
  `require-agent-setup` input empty, `true` or `false` Then a given flag or a set input decides the
  `NO_AGENT_SETUP_FILES` level in the printed report, an absent flag or empty input falls back to
  `setup.require` and then to off, the CLI exits 1 when the verdict is `fail`, and an Action input that
  is not a boolean is reported as an error naming `require-agent-setup`
  - verify: integration

## Constraints

- Default is off: with the option unset everywhere, every existing report, golden file and snapshot is
  unchanged.
- `schema/report.v1.json` stays v1: no field added, removed, renamed or retyped; only the
  `NO_AGENT_SETUP_FILES` description changes. The message code is stable API and is not renamed.
- `packages/core/src` stays pure (no I/O), per AGENTS.md rule 1.
- Reports produced in tests are validated with `expectValidReport`; inputs live in `fixtures/`.
- `packages/action/dist` is rebuilt and committed because core and the action change.
- No new dependency.

## Assumptions

- The CLI flag is a plain boolean: present means on, absent falls back to `setup.require` then off; a CLI
  user cannot switch off a requirement the config turns on (listed as a non-goal).
- "Non-boolean value" for `setup.require` means anything the config parser does not read as the YAML
  booleans `true` or `false`; `null` (an empty value) is treated as unset, as for the existing
  `coverage.*` keys.
- The Action fails the step on a `fail` verdict only through its existing `fail-on-threshold` handling; no
  separate step-failure switch is added for the setup requirement.
- `setup` becomes a new allowed top-level key of `.pharn/ci.yml` beside `coverage`, and unknown keys under
  `setup` are rejected like unknown keys under `coverage`.
- The project's `test` script is `vitest run`, so PHARN's gate discovery finds a runner for the `unit` and
  `integration` criteria; the test stage's own preflight decides whether it gives per-test results.
