---
spec_id: release-readiness-v0-1-0
state: Approved
spec_content_hash: "9fbea1c93031b67305156a9e286f8964e9fcfb216feb07a72109c3d47ebd076e"
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
approved_by: model
---

## Intent

Every Phase 0 feature of pharn-ci is merged on `main`: Cobertura parsing, coverage format selection
(`auto` by default, `--coverage-format`, `COVERAGE_FORMAT_UNSUPPORTED`, `diffCoverage.format`), the
complete agent setup inventory (the new kinds and `agentSetup.summary`) and coverage exclusions
(`coverage.exclude`, `--exclude`, the `exclude` input, `diffCoverage.excludedFiles`). The
maintainer wants the repository ready to cut `v0.1.0` with `.github/workflows/release.yml`: every
version in the repo says `0.1.0`, the changelog has a complete `0.1.0` section the release
workflow accepts, the product docs say only what the merged code does, and the GitHub Marketplace
listing text is written down and checked against the Action's real inputs. Tests keep these
release preconditions true, so a release attempt does not fail on them. This is run 5 of 5 of
"Finish Phase 0 of pharn-ci", and it changes docs, versions and tests only, never product
behaviour.

## Scope

**In scope:**

- A `"version": "0.1.0"` field in the root `package.json`, alongside the existing `0.1.0` in
  `packages/core/package.json`, `packages/cli/package.json` and `packages/action/package.json`
  and `VERSION` in `packages/core/src/version.ts`.
- Extending `packages/core/test/version.test.ts` so it also checks the root `package.json`,
  keeping every check it makes today.
- `CHANGELOG.md`: the `[Unreleased]` entries move under `## [0.1.0] - YYYY-MM-DD` with a one-line
  note that the maintainer sets the date when cutting the release; a fresh, empty
  `## [Unreleased]` with `### Added`, `### Changed` and `### Security` subsections sits above it;
  the `0.1.0` entries for Cobertura, format selection, the agent setup inventory and exclusions are
  complete and consistent with each other and with the merged behaviour.
- A test applying `release.yml`'s `Release verify` changelog checks to the version in
  `packages/action/package.json`: the heading at line start, and a non-empty section extracted the
  way the workflow's `awk` extracts it.
- `README.md`: the quick start, the inputs table, the CLI usage, the message codes table, the agent
  setup kinds list and "What it proves, and what it does not" checked and corrected so every
  statement matches the merged behaviour.
- `docs/LIMITS.md`: any statement contradicting the merged behaviour corrected; every limit that
  still holds kept.
- `docs/RELEASING.md`: the placeholder-date convention, and the root `package.json` in the step
  that sets the version, consistent with the existing steps.
- A new `docs/MARKETPLACE.md` with the GitHub Marketplace listing text, and a test that checks it
  against `action.yml`.
- Rebuilding `packages/action/dist` with `pnpm build` so it stays current.

**Out of scope (non-goals):**

- Any product behaviour change: no new input, flag, message code, setup kind or report field, and
  no source change beyond what the version requires.
- Any change to `schema/report.v1.json` or `action.yml`.
- Creating a tag, a GitHub Release or a Marketplace listing, dispatching or running any workflow,
  or opening a pull request.
- Setting the real release date; that is the maintainer's step when cutting the release.
- The root-level `LIMITS.md`, `THREAT-MODEL.md` and every other PHARN tooling file
  (`pharn/`, `.claude/commands/pharn-*.md`, `pharn.config.json`, `pharn.records.json`).
- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md` and `SECURITY.md`.
- Publishing the CLI to npm.

## Acceptance Criteria

- **AC-1** Given the root `package.json`, `packages/core/package.json`, `packages/cli/package.json`
  and `packages/action/package.json` When the version test reads each `version` field and compares
  it with `VERSION` exported from `packages/core/src/version.ts` Then each of the four equals
  `VERSION`, and the root `package.json` has a `version` field at all
  - verify: unit
- **AC-2** Given `CHANGELOG.md` and the version V in `packages/action/package.json` When its lines
  are checked as `release.yml`'s `Check version, tag and changelog` step checks them Then exactly
  one line starts with `## [V]`, that line is `## [V] - YYYY-MM-DD` or `## [V] - ` followed by a
  date in the form `NNNN-NN-NN` of digits, and a line `## [Unreleased]` is the first line starting
  with `## [` and comes before it
  - verify: unit
- **AC-3** Given `CHANGELOG.md` and the version V in `packages/action/package.json` When the V
  section is extracted with the `awk` program `release.yml`'s `Extract release notes` step uses
  (from the line after the first line starting with `## [V]` up to, not including, the next line
  starting with `## [`) Then the extracted text holds non-whitespace characters; it names
  Cobertura, `coverage-format`, `--coverage-format`, `coverage.format`, `auto`,
  `diffCoverage.format`, `agentSetup.summary`, `coverage.exclude`, `--exclude`, the `exclude`
  input and `diffCoverage.excludedFiles`; it names every message code and every agent setup kind
  listed as known in `schema/report.v1.json`; and it contains none of `lcov only`, `lcov-only` or
  `the lcov report`
  - verify: unit
- **AC-4** Given `docs/MARKETPLACE.md` and `action.yml` When the listing's name, one-line
  description, description and categories are read Then the name equals the `name` in
  `action.yml`, the one-line description is at most 125 characters and equals the `description`
  in `action.yml`, the description has exactly three paragraphs, and the primary and secondary
  categories are two different values, each one of `Code quality`, `Code review`,
  `Continuous integration`, `Security`, `Testing` or `Utilities`
  - verify: unit
- **AC-5** Given the quick-start workflow YAML in `docs/MARKETPLACE.md` and `action.yml` When the
  step that uses pharn-ci is read Then its `uses:` is `pharn-dev/pharn-ci@v` followed by `VERSION`
  from `packages/core/src/version.ts`, it sets at least one input, and every input named under
  its `with:` is an input declared in `action.yml`
  - verify: unit
- **AC-6** Given `docs/RELEASING.md` When the step that sets the version is read Then it names the
  root `package.json` as well as `packages/core/package.json`, `packages/cli/package.json`,
  `packages/action/package.json` and `packages/core/src/version.ts`, and the document states that
  the maintainer replaces the `YYYY-MM-DD` placeholder in the changelog heading with the release
  date before running the release workflow
  - verify: unit

## Constraints

- No product behaviour changes: no file under `packages/*/src` changes (`VERSION` is already
  `0.1.0`), and `schema/report.v1.json` and `action.yml` are not changed (the run's intent;
  AGENTS.md rule 2).
- No existing test is weakened, skipped or deleted (AGENTS.md rule 4); `version.test.ts` keeps its
  per-package checks against `VERSION`. Golden files do not change.
- No dependency is added (AGENTS.md rule 6); the doc tests read files with what the repo already
  has.
- `packages/action/dist` is rebuilt with `pnpm build` and current (AGENTS.md rule 7).
- The checks in AC-2 and AC-3 mirror `.github/workflows/release.yml` as it is; the workflow itself
  is not changed.
- The tests stay true after the maintainer replaces `YYYY-MM-DD` with the real date, and after
  later entries are added under `## [Unreleased]`, so cutting the release needs no test change.
- In this run, `CHANGELOG.md` carries the literal heading `## [0.1.0] - YYYY-MM-DD`, the one-line
  note about the date directly beneath it, and an `## [Unreleased]` section holding only empty
  `### Added`, `### Changed` and `### Security` subsections.
- The product docs are `README.md`, `CHANGELOG.md` and `docs/*.md`, and they keep their existing
  style. No product doc claims a feature that does not exist, and none says the Action or the CLI
  reads lcov only.
- `README.md`'s inputs table lists exactly the inputs in `action.yml` with their real defaults
  (`coverage-format` defaulting to `coverage.format`, then `auto`; the `exclude` input); its CLI
  usage lists exactly the flags `pharn-ci --help` prints; its message codes table lists exactly
  the codes `schema/report.v1.json` lists as known, including `COVERAGE_FORMAT_UNSUPPORTED`; and
  its agent setup kinds table lists exactly the kinds the schema lists as known.
- `docs/MARKETPLACE.md` holds the name, the one-line description, a three-paragraph description, a
  primary and a secondary category and the quick-start workflow YAML, using
  `uses: pharn-dev/pharn-ci@v0.1.0` and only inputs `action.yml` declares, and claims no feature
  that does not exist.
- `docs/RELEASING.md`'s version step also names `docs/MARKETPLACE.md`'s `uses:` line, since AC-5
  ties it to `VERSION`.
- No tag is created and no workflow is run or dispatched.
- `pnpm lint` and `pnpm test` pass.

## Assumptions

- "Version" for the release workflow means `packages/action/package.json`, the file `release.yml`
  compares its input with; AC-2 and AC-3 read the version from there, so they hold for every later
  release, not for `0.1.0` alone. Today that version is `0.1.0`.
- The heading test accepts either the literal `YYYY-MM-DD` or a real date, because the maintainer
  replaces the placeholder in the release PR and a test that demanded the placeholder would then
  have to change.
- The fresh `## [Unreleased]` being empty, and the note about the date, are checked by reading the
  diff, not by a permanent test, because both stop being true in normal use (entries are added;
  the note is removed when the date is set).
- When the maintainer sets the date, the one-line note is removed with the placeholder, so the
  release notes the workflow extracts do not carry it; `docs/RELEASING.md` says so.
- The awk extraction in AC-3 may be run with the system `awk` (present on Linux and macOS, the
  platforms the repo supports) or reproduced in the test exactly; the plan chooses.
- The Marketplace listing's one-line description equals the `description` in `action.yml`
  (107 characters today), because GitHub shows that field as the listing's summary; `action.yml`
  is not changed.
- The listing's categories are chosen from GitHub Marketplace's category list; AC-4 checks them
  against the subset named there, which holds the categories that fit a coverage gate and setup
  inventory.
- `docs/MARKETPLACE.md` is written so a test can find each field (for example a heading per
  field); its exact layout is the plan's choice.
- The doc test for `docs/MARKETPLACE.md` and `docs/RELEASING.md` reads the files directly; it lives
  with the other tests under `packages/*/test` so `pnpm test` runs it.
- README and docs/LIMITS.md consistency is checked by review in this run (Constraints), because
  their current tables already match `action.yml` and the schema, so a new test of them could not
  fail before the build.
- The project's test runner is vitest (`pnpm test`, `vitest run`) with per-test results configured
  for PHARN as `vitest-json`.
- This run opens no pull request.
