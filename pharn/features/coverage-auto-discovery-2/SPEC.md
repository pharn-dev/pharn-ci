---
spec_id: coverage-auto-discovery-2
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

Today pharn-ci must be told where the coverage report is. When neither the Action's `coverage-file`
input / the CLI's `--coverage` flag nor `coverage.file` in `.pharn/ci.yml` is set, the run stops
with "no coverage file: ...", even though most projects write their report to one of a few
well-known paths. The user wants pharn-ci to work with no `with:` block for the common ecosystems:
when no coverage path is configured, the Action and the CLI look for a coverage report at a fixed
list of well-known paths, use it when exactly one kind is found, refuse to guess when several are,
and give the ordinary missing-coverage report when none is. Explicit settings keep precedence and
behave exactly as today. The change ships with copy-paste example workflows for vitest, jest,
pytest, .NET and cargo, and the docs say that the path is auto-discovered when unset.

## Scope

**In scope:**

- Auto-discovery of the coverage report when no coverage path is set (no `coverage-file` input or
  an empty one, no `--coverage` flag, no `coverage.file` in the config). The candidates, relative to
  the repo root, in this order: `coverage/lcov.info`, `lcov.info`, `coverage.xml`,
  `coverage/cobertura-coverage.xml`, and the glob `**/coverage.cobertura.xml` (.NET coverlet), with
  `node_modules` skipped.
- The choice rule: exactly one candidate found is used (all the files the one .NET glob matches
  count as one candidate, and are all used, merged like any coverage glob), and a line
  `coverage: <path> (auto-discovered)` is logged for each file used (CLI: stderr; Action: info log).
  Several different candidates found is a usage error that lists the found files and asks the user
  to set the coverage path; nothing is merged or guessed. None found is the same
  `COVERAGE_FILE_MISSING` report as a missing coverage file today, with a message saying where
  pharn-ci looked and how to set the path.
- The candidate list and the choice rule as a pure function in `packages/core`; the existence checks
  and the directory walk in `packages/node-io`, shared by the CLI and the Action. Discovery checks
  the disk, not `git ls-files`, because generated coverage files are usually git-ignored.
- Five example workflows in `examples/workflows/`: `vitest.yml`, `jest.yml`, `pytest.yml`,
  `dotnet.yml`, `cargo.yml`, each using `pharn-dev/pharn-ci@v0.1.0` with no `with:`.
- Docs: the README quick start and CLI section mention auto-discovery and `examples/workflows/`; the
  `coverage-file` description in `action.yml` says the path is auto-discovered when unset; a
  `CHANGELOG.md` line under Unreleased; `docs/THREAT-MODEL.md` updated for the new disk probing.

**Out of scope (non-goals):**

- Publishing the CLI to npm.
- An `init` command or any generator of workflows or config.
- Merging several different discovered candidates, or ranking them to pick one.
- Candidates beyond the five listed (for example Go, JaCoCo or Kover output paths), and reading any
  coverage format other than lcov and Cobertura XML.
- Any change to how an explicitly set coverage path, glob or list is resolved, read or reported.
- Extending `scripts/check-action-pins.mjs` to scan `examples/`.
- A new report field or message code recording that the path was discovered.
- Any refactor of code this change does not need to touch.

## Acceptance Criteria

- **AC-1** Given, one case at a time, a set of existing repo-relative paths that contains exactly
  one discovery candidate: `coverage/lcov.info`, `lcov.info`, `coverage.xml`,
  `coverage/cobertura-coverage.xml`, or `tests/App.Tests/TestResults/abc/coverage.cobertura.xml`,
  together with unrelated paths such as `src/a.ts` When core's discovery choice runs on it Then it
  returns a found result whose files are exactly that one path
  - verify: unit
- **AC-2** Given a set of existing paths whose only candidate matches are three
  `coverage.cobertura.xml` files under different `TestResults/<id>/` directories When core's
  discovery choice runs on it Then it returns a found result whose files are those three paths,
  sorted, and no ambiguity
  - verify: unit
- **AC-3** Given sets of existing paths that contain two or more different candidates
  (`coverage/lcov.info` with `lcov.info`; `coverage.xml` with one `coverage.cobertura.xml` under
  `TestResults/`; all five kinds at once) When core's discovery choice runs on each Then it returns
  an ambiguous result listing every found path, and no chosen file
  - verify: unit
- **AC-4** Given an empty set of paths, and a set with only unrelated paths When core's discovery
  choice runs on each Then it returns a not-found result, and core's exported candidate list is
  exactly `coverage/lcov.info`, `lcov.info`, `coverage.xml`, `coverage/cobertura-coverage.xml`,
  `**/coverage.cobertura.xml`, in that order
  - verify: unit
- **AC-5** Given core's not-found discovery result passed to `check()` as its coverage, a valid diff,
  and threshold `null` in one case and `80` in another When `check()` runs Then each report has
  `diffCoverage` null and exactly one `COVERAGE_FILE_MISSING` message, level `warn` with verdict
  `warn` without a threshold and level `error` with verdict `fail` with threshold 80, whose text
  names each of the five candidates and `coverage.file`, and each report validates against
  `schema/report.v1.json`
  - verify: unit
- **AC-6** Given fixture directories under `fixtures/coverage-discovery/`, one per case of AC-1 to
  AC-4 (a single candidate of each kind, several .NET `TestResults` files, two different
  candidates, no candidate) When node-io's discovery runs on each directory as the repo root Then
  it returns the same found, ambiguous or not-found result, with the same repo-relative paths, as
  core's choice gives for that case
  - verify: integration
- **AC-7** Given a temporary repo root where `coverage.cobertura.xml` exists only under
  `node_modules/` (directly and at depth), where `coverage.xml` is a directory, and where
  `lcov.info` is a symbolic link to a valid lcov file When node-io's discovery runs on it Then it
  returns a not-found result: no file under `node_modules`, no directory and no symbolic link
  counts as a candidate
  - verify: integration
- **AC-8** Given a git repository with a base commit and a change, `coverage/lcov.info` written to
  disk and not tracked, no `--coverage` flag and no `coverage.file` in its config When
  `pharn-ci check --format json` runs from the repo root, and again from a subdirectory Then each
  run exits 0, stderr contains the line `coverage: coverage/lcov.info (auto-discovered)`, and the
  JSON report on stdout has a non-null `diffCoverage` measured from that file with
  `diffCoverage.format` `lcov`
  - verify: integration
- **AC-9** Given the same repository with both `coverage/lcov.info` and `coverage.xml` on disk and
  no coverage path set When `pharn-ci check` runs Then it exits 2, stdout is empty, and stderr names
  both found files and `--coverage`
  - verify: integration
- **AC-10** Given the same repository with no candidate on disk and no coverage path set When
  `pharn-ci check --format json` runs without a threshold, and again with `--threshold 80` Then the
  first exits 0 and the second exits 1, each report carries `COVERAGE_FILE_MISSING` naming the
  candidates, and stderr has no `(auto-discovered)` line
  - verify: integration
- **AC-11** Given the same repository with `coverage/lcov.info` on disk When `pharn-ci check` runs
  with `--coverage missing.info`, and again with no flag but `coverage.file: missing.info` in
  `.pharn/ci.yml` Then each report carries `COVERAGE_FILE_MISSING` naming `missing.info` as today,
  and stderr has no `(auto-discovered)` line
  - verify: integration
- **AC-12** Given an Action run on a pull request whose workspace has only `coverage.xml` (a valid
  Cobertura report) on disk, an empty `coverage-file` input and no config file When the Action runs
  Then the info log contains `coverage: coverage.xml (auto-discovered)`, the written `report.json`
  has `diffCoverage.format` `cobertura` and a non-null `diffCoverage`, and the step is not failed
  - verify: integration
- **AC-13** Given an Action run on a pull request whose workspace has both `lcov.info` and
  `coverage/cobertura-coverage.xml` on disk and an empty `coverage-file` input When the Action runs
  Then the step is failed with a message naming both found files and `coverage-file`, and no PR
  comment is created or updated
  - verify: integration
- **AC-14** Given an Action run on a pull request with an empty `coverage-file` input and no
  candidate on disk, without a threshold and then with threshold `80`, and a third run with
  `coverage-file: missing.info` while `coverage/lcov.info` exists When the Action runs each Then
  the first two `report.json` files carry `COVERAGE_FILE_MISSING` naming the candidates, the step
  is failed only with threshold 80, and the third reports `COVERAGE_FILE_MISSING` naming
  `missing.info` with no `(auto-discovered)` info line
  - verify: integration
- **AC-15** Given each of `examples/workflows/vitest.yml`, `jest.yml`, `pytest.yml`, `dotnet.yml`
  and `cargo.yml` When its text is read Then it has `fetch-depth: 0` on the checkout step,
  `permissions` with `contents: read` and `pull-requests: write`, the README quick start's
  `concurrency` group, exactly one step `uses: pharn-dev/pharn-ci@v0.1.0` with `timeout-minutes: 5`
  and no `with:` key, and every other `uses:` ref pinned to a 40-character hex commit SHA followed
  by a `# vX.Y.Z` version comment
  - verify: unit
- **AC-16** Given the same five example workflows When their run steps are read Then vitest's runs
  `npx vitest run --coverage --coverage.reporter=lcov`, jest's runs
  `npx jest --coverage --coverageReporters=lcov`, pytest's runs `pytest --cov --cov-report=xml`,
  dotnet's runs `dotnet test --collect:"XPlat Code Coverage"`, and cargo's runs
  `cargo llvm-cov --lcov --output-path lcov.info`, so each writes its report to a discovery
  candidate
  - verify: unit
- **AC-17** Given the repository docs When they are read Then the README Quick start section and the
  README CLI section each mention auto-discovery and `examples/workflows/`, the `coverage-file`
  description in `action.yml` says the path is auto-discovered when unset, `CHANGELOG.md` has a line
  under Unreleased naming coverage auto-discovery, and `docs/THREAT-MODEL.md` names coverage
  auto-discovery and a test that covers it
  - verify: unit

## Constraints

- `packages/core` stays pure (AGENTS.md rule 1): the candidate list and the choice rule live in core
  and do no I/O; existence checks, the directory walk and file reads live in `packages/node-io`.
- `schema/report.v1.json` stays the source of truth (AGENTS.md rule 2): no field or message code is
  removed, renamed or retyped; any addition would be optional, documented in the schema and mirrored
  in `packages/core/src/report.ts`.
- An explicitly set coverage path, glob or list (input, flag or config) resolves, reads and reports
  exactly as before, and no golden file changes.
- No existing test is weakened, skipped or deleted (AGENTS.md rule 4). A test that asserts the old
  "no coverage file" stop is replaced by a test of the new not-found behaviour, and the PR
  description says why.
- Every core change ships with fixture-based tests, and every report a test produces is checked with
  `expectValidReport` (AGENTS.md rule 3).
- The discovery walk follows the existing coverage glob rules: no symbolic link followed, `.git` and
  `node_modules` skipped, at most 1,000 matched files and 100,000 visited entries per run.
- No new runtime dependency; no network call (AGENTS.md rules 5 and 6).
- `packages/action/dist` is rebuilt with `pnpm build` (AGENTS.md rule 7).
- Third-party actions in the example workflows are pinned to a full commit SHA with the version in a
  trailing comment, as in the README quick start.
- README.md gains no `uses: pharn-dev/pharn-ci@` line and keeps every other `uses:` line pinned to a
  full SHA with a version comment, as `packages/core/test/ac-release-docs.test.ts` asserts.

## Assumptions

- Several different candidates found is a usage error, not a report: the CLI exits 2 with the
  message on stderr and the Action fails the step, as today's "no coverage file" error does; no
  report or comment is produced for it.
- The not-found case reuses the `COVERAGE_FILE_MISSING` code with the same levels as today (error
  with a threshold, warn without); only its text differs, naming the five candidates and how to set
  the path (`coverage-file`, `--coverage` or `coverage.file`). No new message code is needed.
- The `coverage: <path> (auto-discovered)` line goes to the log only (CLI stderr, Action info log);
  the report gains no field recording that the path was discovered.
- The logged and reported path of a discovered file is repo-relative with forward slashes in both
  the CLI and the Action, and the CLI discovers from the repo root whatever directory it runs in.
- A candidate counts only when it is a regular file; a directory or a symbolic link at a candidate
  path does not count, matching the coverage glob walk, which never follows a link.
- The `coverage-format` and `coverage-root` settings apply to discovered files as they do to
  configured ones.
- Discovery runs in PR-number mode too, probing the workspace like any other run.
- Exceeding the walk limits while looking for `**/coverage.cobertura.xml` is an error naming the
  limit, as for a configured glob.
- `v0.1.0` is not released yet (`CHANGELOG.md` has an Unreleased section and `## [0.1.0]` is not
  dated), so the examples' `uses: pharn-dev/pharn-ci@v0.1.0` with no `with:` works once that release
  includes this change.
- The README quick start's YAML block keeps its single pharn-ci step; its prose says that
  `coverage-file` may be omitted when the report is at a discovery candidate and points to
  `examples/workflows/`.
- `scripts/check-action-pins.mjs` scans only `.github/workflows` and `.github/actions`, so it does
  not read `examples/`; the SHA pins in the examples are checked by this feature's own test, and the
  pin script is not extended (a tag ref to `pharn-dev/pharn-ci` there would fail it).
- The commit SHAs in the examples are looked up from the actions' real release tags at build time,
  which needs network access; no test can verify offline that a SHA is the named release.
- The cargo example installs `cargo-llvm-cov`, matching the README's per-ecosystem table, and the
  vitest example installs `@vitest/coverage-v8`, as the README quick start says it must.
- Without a `with:` block the examples set no threshold, so they report and never fail the step.
- The new disk probing counts as a new place that reads untrusted input (files the PR's test run
  writes at paths the PR can influence), so `docs/THREAT-MODEL.md` is updated; it is not one of the
  write-protected PHARN paths.
- Existing tests that assert the old stop include `packages/cli/test/main.test.ts` (`["check"]`,
  "no coverage file"), `packages/action/test/run.test.ts` (`coverage-file: ""`, "no coverage file")
  and possibly `packages/core/test/inputs.test.ts`; the PLAN decides which change.
- Fixtures that need a `node_modules` directory or a symbolic link are built in a temporary
  directory at test time, because git ignores `node_modules/` and links are fragile in fixtures.
- The project's `test` script (`vitest run`) runs these criteria's tests; no extra runner is needed.
