---
spec_id: require-agent-setup
spec_content_hash: c5ece5f9ec754e6ab4d11f027ec1cd570a062620bc4f680d092b2c7e16926dee
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/{check,config,report,index}.ts`, `packages/core/src/render/markdown.ts`
> (message line only), `packages/cli/src/main.ts`, `packages/action/src/run.ts`, `action.yml`,
> `schema/report.v1.json` (message section), `packages/core/test/{golden,report,ac-setup-summary,ac-format-config,
> ac-release-changelog,helpers}.test.ts` (relevant parts), `packages/cli/test/exclude.test.ts`,
> `packages/action/test/ac-coverage-format.test.ts`, `fixtures/golden/files.txt`, `fixtures/setup/all-kinds.txt`,
> `fixtures/golden-exclusions/{files.txt,ci.yml}`, `README.md` (What pharn-ci is, Action reference, CLI, Config,
> Report v1, What it proves), `docs/THREAT-MODEL.md` (rows A1 to G2, §3), `docs/LIMITS.md` §4, `CHANGELOG.md`
> (Unreleased), `.pharn/ci.yml`, `vitest.config.ts`, `biome.json`, and
> `pharn/features/coverage-format-selection/{PLAN,AC-TESTS}.md` for this repo's conventions.

One boolean, `requireAgentSetup`, is resolved at the edges (config, CLI flag, Action input) and passed as plain
data into core, which alone decides the message level. Core stays pure (AGENTS.md rule 1).

1. **Report — `packages/core/src/report.ts`.** `BuildReportInput` gains `requireAgentSetup?: boolean` (doc comment:
   when true, a repo with no agent setup files is an error). In `buildReport`, the existing
   `NO_AGENT_SETUP_FILES` push keeps its code; its level is `input.requireAgentSetup === true ? "error" : "info"`.
   The `info` text stays byte-for-byte `No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.`
   so every golden file and snapshot is unchanged. The `error` text is that sentence with its final `.` replaced by
   `, and agent setup is required by config.` (the SPEC allows the text to say so). `verdictOf` already turns any
   `error` into `fail`; nothing else changes. No new field reaches the `Report` object.
2. **Check — `packages/core/src/check.ts`.** `CheckInput` gains `requireAgentSetup?: boolean` (doc comment: off
   when absent). `base` carries `requireAgentSetup: input.requireAgentSetup === true`, so every early-return path
   (missing, empty, unsupported coverage, unavailable diff) and the normal path apply it the same way.
3. **Config — `packages/core/src/config.ts`.** `PharnConfig` gains `setup?: { require?: boolean }`. In
   `validateConfig`, the top-level loop accepts `coverage` and `setup` (any other key keeps the
   `unknown top-level key "<key>"` error). The coverage branch moves into a helper so the function no longer returns
   early when `coverage` is absent; a new `validateSetup(value)` helper mirrors it:
   - `setup` absent or `null` → no `setup` in the result (as for an absent `coverage`).
   - not a mapping (a scalar or a list) → `ConfigError('"setup" must be a mapping')`.
   - for each entry: a `null` value is skipped (unset, as for `coverage.*` — SPEC Assumptions); `require` must be
     the boolean `true` or `false`, else `ConfigError('"setup.require" must be true or false')`; any other key →
     `ConfigError('unknown key "setup.<key>"')`.
   - the result is `{ setup: { require } }` when `require` was set, `{ setup: {} }` when the mapping had only null
     values (the same shape `coverage` takes today).

   The YAML subset parser is unchanged: `setup:` followed by an indented `require: true` already parses as a nested
   map with a boolean, and `yes`, `1` or `"true"` reach validation as a string or a number, which is rejected.
   A config with only `coverage` returns exactly what it returns today (no `setup` key), so `config.test.ts`,
   `config-exclude.test.ts` and `ac-format-config.test.ts` stay green.
4. **CLI — `packages/cli/src/main.ts`.** `parseArgs` gains `"require-agent-setup": { type: "boolean" }`. In
   `runCheck`, after the config loads:
   `const requireAgentSetup = values["require-agent-setup"] === true || (config.setup?.require ?? false);`
   (a given flag turns it on; absent falls back to `setup.require`, then off — there is no way to turn off from the
   CLI a requirement the config turns on, a SPEC non-goal). It goes into `CheckInput.requireAgentSetup`. The existing
   `report.verdict === "fail" ? EXIT_FAIL : EXIT_OK` gives exit 1. `HELP` gains one line:
   `--require-agent-setup  Fail when the repo has no agent setup files. Default: setup.require, then off`.
5. **Action — `packages/action/src/run.ts`.** After `failOnThreshold`:
   `const requireAgentSetup = parseBool(input("require-agent-setup"), config.setup?.require ?? false, "require-agent-setup");`
   The existing `parseBool` already returns the fallback for an empty input, accepts `true|yes|on|1` and
   `false|no|off|0` like `fail-on-threshold`, and throws `require-agent-setup must be true or false, got "<v>"`,
   which `run` reports through `setFailed`. It goes into `checkInput.requireAgentSetup`. The step fails on the `fail`
   verdict only through the existing `fail-on-threshold` branch (SPEC Assumptions); its `setFailed` text joins the
   error messages, so it names the missing agent setup.
6. **`action.yml`** gains, after `exclude`, an input `require-agent-setup` with `required: false`, **no `default:`
   key** (an empty input must reach `run.ts` so it can fall back to `setup.require`), and the description
   `Fail the check when the repo has no agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...). Defaults to setup.require in .pharn/ci.yml, then false.`
7. **Schema — `schema/report.v1.json`.** Only the `message.code` description changes, and only about
   `NO_AGENT_SETUP_FILES`: after the existing last sentence (`... consumers must tolerate unknown codes.`) append
   ` NO_AGENT_SETUP_FILES is level info, or error when the agent setup requirement (setup.require, require-agent-setup) is on.`
   The `Known codes: ...` list itself is untouched, because `ac-release-changelog.test.ts` (AC-3) reads it up to the
   first `.`; the new sentence comes after it. No field, enum or pattern changes; the schema stays v1.
8. **Fixtures — new `fixtures/require-agent-setup/`** (inputs for the AC tests, AGENTS.md rule 3):
   - `files.txt` — a tracked-files list with no agent setup file: `README.md`, `src/math.ts`, `src/new.ts`,
     `src/utils/new-name.ts` (the paths of `fixtures/golden/pr.diff`, so the golden diff and coverage still measure).
   - `ci-require-true.yml` — `setup:` / `  require: true` with a one-line comment header.
   - `ci-require-false.yml` — `setup:` / `  require: false` with a one-line comment header.

   The repo-with-setup case reuses `fixtures/golden/files.txt` (it lists `CLAUDE.md`, `AGENTS.md` and more) and
   `fixtures/setup/all-kinds.txt`; coverage and diff reuse `fixtures/golden/{coverage.info,pr.diff}`.
9. **Docs.**
   - `README.md`: Action reference table gains a `require-agent-setup` row (default `setup.require`, then `false`;
     "Fail when the repo has no agent setup files; the step fails through `fail-on-threshold`"). The CLI usage block
     gains `[--require-agent-setup]` and one bullet (present turns it on; absent falls back to `setup.require`, then
     off; the flag cannot turn off a requirement the config turns on). The Config example gains
     `setup:` / `  require: false # true fails the check when the repo has no agent setup files`. "What it proves":
     the "inventory is not a review" bullet gains that the inventory is informational (`NO_AGENT_SETUP_FILES` is
     `info`) unless `require-agent-setup` / `setup.require` is on, which makes it an `error` and the verdict `fail`;
     and a new bullet "The setup requirement comes from the PR": the `.pharn/ci.yml` a PR carries can switch
     `setup.require` off, so protect it with CODEOWNERS (or set the Action input in the workflow).
   - `CHANGELOG.md`: one line under `## [Unreleased]` › `### Added` naming `require-agent-setup`,
     `--require-agent-setup` and `setup.require`, off by default, and that it makes `NO_AGENT_SETUP_FILES` an error
     and the verdict `fail`.
   - `docs/THREAT-MODEL.md`: row A1's config-parser sentence gains that `setup.require` accepts only `true` or
     `false` and rejects any other value with a `ConfigError`, citing the AC-2 test by its title as written in
     `packages/core/test/ac-require-setup-config.test.ts` (the file exists by build time; copy the title, do not
     invent it). §3 gains item 8, "The agent setup requirement comes from the PR": `setup.require` lives in the
     PR-carried `.pharn/ci.yml`, so a PR can switch the requirement off (and it is off by default); the Action input
     in the workflow file is the stronger setting, and both should be protected with CODEOWNERS. Statuses unchanged.
10. **Bundle.** Rebuild `packages/action/dist/index.js` with `pnpm --filter @pharn-ci/action build` (AGENTS.md
    rule 7), as the previous runs did; it writes only the committed bundle.

## Applied lessons

- none — the project has no `memory-bank/lessons-learned.md` yet (`check-lessons-index.mjs --verdict` printed
  `NO_CANON` this run), so there are no promoted lessons to apply.

## Steps

- Core report: add `requireAgentSetup` to `BuildReportInput`; choose the `NO_AGENT_SETUP_FILES` level and text from it.
- Core check: add `requireAgentSetup` to `CheckInput`; pass it through `base` into every `buildReport` call.
- Core config: add `setup?: { require?: boolean }` to `PharnConfig`; accept the `setup` top-level key; split coverage
  validation into a helper; add `validateSetup` with the three errors above.
- CLI: add the boolean flag, resolve it against `config.setup?.require`, pass it to `check`, extend `HELP`.
- Action: resolve the input with `parseBool` and the config fallback, pass it to `check`.
- `action.yml`: declare the input, no `default:`.
- Schema: append the one sentence to the `message.code` description.
- Fixtures: add `fixtures/require-agent-setup/{files.txt,ci-require-true.yml,ci-require-false.yml}`.
- Docs: README (four places), CHANGELOG (one line), THREAT-MODEL (A1 sentence, §3 item 8).
- Run `pnpm --filter @pharn-ci/action build`; then `pnpm test` and `pnpm lint` stay green with no golden or snapshot
  change (`fixtures/golden*/` and `packages/core/test/__snapshots__/` must show no diff).

## Files

- `packages/core/src/report.ts` — `BuildReportInput.requireAgentSetup`; `NO_AGENT_SETUP_FILES` is `error` with the "required by config" text when it is on, `info` with today's text otherwise
- `packages/core/src/check.ts` — `CheckInput.requireAgentSetup`, passed to every `buildReport` call through `base`
- `packages/core/src/config.ts` — `PharnConfig.setup.require`; top-level `setup` key; `setup.require` must be `true` or `false`; unknown `setup.*` keys rejected
- `packages/cli/src/main.ts` — `--require-agent-setup` boolean flag, fallback to `setup.require` then off, help line
- `packages/action/src/run.ts` — `require-agent-setup` input parsed with `parseBool`, empty falls back to `setup.require` then false
- `action.yml` — new `require-agent-setup` input, not required, no `default:` key, description says it defaults to false
- `schema/report.v1.json` — `message.code` description: one appended sentence about the `NO_AGENT_SETUP_FILES` level; nothing else
- `fixtures/require-agent-setup/files.txt` — new: tracked files with no agent setup file
- `fixtures/require-agent-setup/ci-require-true.yml` — new: `setup.require: true`
- `fixtures/require-agent-setup/ci-require-false.yml` — new: `setup.require: false`
- `README.md` — Action reference row, CLI usage and bullet, Config example, "What it proves" (informational unless required; the requirement comes from the PR)
- `CHANGELOG.md` — one line under Unreleased › Added
- `docs/THREAT-MODEL.md` — row A1 sentence on `setup.require` validation citing the AC-2 test; §3 item 8 on the PR-carried config switching the requirement off
- `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build`

### Explicitly not touched

- `packages/core/src/setup/scan.ts` — which files count as agent setup is unchanged (SPEC non-goal)
- `packages/core/src/setup/summary.ts` — the tools enum and summary are unchanged (SPEC non-goal)
- `packages/core/src/render/markdown.ts` — renders any message level generically through `LEVEL_ICON`
- `packages/core/src/index.ts` — no new export; `PharnConfig`, `CheckInput` and `BuildReportInput` are already exported types
- `packages/cli/src/nodeDeps.ts` — I/O unchanged
- `packages/action/src/index.ts` — I/O unchanged; inputs are read through `getInput`
- `fixtures/golden/report.json` — must stay byte-identical (default off)
- `fixtures/golden/report.md` — must stay byte-identical (default off)
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — must stay unchanged (default off)
- `packages/core/test/report.test.ts` — its `info` expectation still holds with the requirement absent
- `packages/core/test/golden.test.ts` — unchanged
- `packages/core/test/config.test.ts` — its rejection rows still hold: only `setup` joins the allowed top-level keys
- `docs/LIMITS.md` — §4 says the inventory is not a review, which stays true; the SPEC names no LIMITS change
- `.pharn/ci.yml` — this repo's own config does not turn the requirement on
- `LIMITS.md` — PHARN's root-level document, not a product doc
- `THREAT-MODEL.md` — PHARN's root-level document, not a product doc
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 → `check()` passes `requireAgentSetup` to `buildReport` on every path. With the requirement on and
  `fixtures/require-agent-setup/files.txt`, the `NO_AGENT_SETUP_FILES` message is `error` and `verdictOf` gives
  `fail`; off or absent, the level is `info` with today's text and the verdict is whatever today's is (`pass` for the
  golden coverage and diff with no threshold); with `fixtures/golden/files.txt` (setup files present) no
  `NO_AGENT_SETUP_FILES` message is pushed either way. Reports validate against the schema (no field added).
- AC-2 → `validateSetup`: `true` and `false` are returned as `config.setup.require`; a string (`yes`, `"true"`) or a
  number (`1`) throws `ConfigError` whose message contains `setup.require`.
- AC-3 → CLI: the flag turns it on; without it `setup.require` from `.pharn/ci.yml` (true or false), then off,
  decides the level; a `fail` verdict exits 1, else 0. Action: a set input (`true`/`false`) decides; an empty input
  falls back to `setup.require`, then off; a non-boolean input fails through `setFailed` with a message naming
  `require-agent-setup`. The level is read from the printed report (CLI `--format json` stdout, Action `report.json`
  at `report-path`).

## Risks & open questions

- **For `/pharn-test` (red run):** import `check`, `parseConfig`, `main` and `run` inside each test body and read
  every fixture inside the test body, never at module top level: `fixtures/require-agent-setup/` does not exist
  before the build. Each leaf title must start `AC-<n>:`.
- **AC-3 in one file:** the mapping allows one file per AC, so the AC-3 test file drives both entry points. It lives
  under `packages/cli/test/` and imports the Action's `run` from `../../action/src/run.js` inside the test body
  (`run.ts` imports only `@pharn-ci/core`, which `vitest.config.ts` aliases to source). Fake deps can follow
  `packages/cli/test/exclude.test.ts` and `packages/action/test/ac-coverage-format.test.ts`, with `git ls-files`
  returning `fixtures/require-agent-setup/files.txt`. In the Action fake, an unset input is `""` (no `default:`),
  and `fail-on-threshold` is `"true"`.
- **Red for the right reason:** before the build, AC-1 and AC-3 fail (level stays `info`, unknown CLI option exits 2,
  missing fixtures) and AC-2 fails (`unknown top-level key "setup"`); none can pass by accident.
- **Text change is level-gated:** the `error` text differs from the `info` text; a test should assert on `code` and
  `level`, and on `text` only through `toContain` if at all (the schema says wording may change).
- **Schema description:** the appended sentence must come after the `Known codes:` list's closing `.`; putting
  anything with a `.` inside that list would break `ac-release-changelog.test.ts` AC-3.
- **Action step failure:** with `fail-on-threshold: false`, a missing-setup `fail` verdict does not fail the step
  (SPEC Assumptions). The README row says the step fails through `fail-on-threshold`.
- **Threat model:** the requirement is off by default and switchable off by the PR's own `.pharn/ci.yml`; this is a
  named residual (§3 item 8), not a guarantee.
- The SPEC's Constraints mention rebuilding `dist`; this plan uses the action-only build, as the previous runs did,
  because it writes exactly the committed bundle and nothing outside scope.
