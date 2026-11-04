---
spec_id: coverage-auto-discovery-2
spec_content_hash: dc7b704a6189f76a899c60e89eb8a5bc739de793fb98e1d677b0bee43642808f
applied_lessons: none
---

> ADVISORY: this plan is model work. Only its frontmatter shape, its `## Files` scope and the AC mapping are
> floor-checked. Every claim about the repo below comes from a read made this run, on HEAD `dd2a03b`.

## Approach

When no coverage path is set (no `--coverage` flag, an empty `coverage-file` input, no `coverage.file`), the CLI
and the Action stop reporting "no coverage file" and run a discovery shared through `packages/node-io`. The work
splits along AGENTS.md rule 1 and the SPEC's Scope ("the candidate list and the choice rule as a pure function in
`packages/core`; the existence checks and the directory walk in `packages/node-io`"):

1. **core, pure** — new `packages/core/src/coverageDiscovery.ts`:
   - `COVERAGE_DISCOVERY_CANDIDATES` — a frozen tuple, in the SPEC's order: `coverage/lcov.info`, `lcov.info`,
     `coverage.xml`, `coverage/cobertura-coverage.xml`, `**/coverage.cobertura.xml`.
   - `chooseDiscoveredCoverage(paths: Iterable<string>): CoverageDiscovery` — the choice rule over any set of
     existing repo-relative paths. A path counts for a literal candidate when it equals it, and for the glob
     candidate when `compileGlob("**/coverage.cobertura.xml")` matches it and no segment is `.git` or
     `node_modules` (the walk's own rule, so the pure function and the walk agree on any input). Paths are
     de-duplicated. One candidate kind with matches → `{ kind: "found", files }` (the glob's matches, all of them,
     sorted in code-unit order); two or more kinds → `{ kind: "ambiguous", found }` (every found path: candidates
     in list order, glob matches sorted), with no `files`; none → `{ kind: "not-found" }`.
   - Text helpers, so the wording has one owner: `coverageDiscoveryLine(path)` (exactly
     `coverage: <path> (auto-discovered)`), `coverageDiscoveryAmbiguousText(found, howToSet)` (lists every found
     path and appends the adapter's own way to set the path), `coverageNotDiscoveredText()` (the not-found report
     text, built from the candidate list so the two cannot drift: it names the five candidates and says to set
     `coverage.file` in `.pharn/ci.yml`, the `coverage-file` input or `--coverage`), and
     `coverageDiscoveryLimitText(limit: "files" | "entries")` (the walk-limit error, worded like
     `expandCoverageEntries`' messages and telling the user to set the coverage path).
   - The candidate walk uses the existing pure `walkGlob` (`packages/core/src/globWalk.ts`), which already has the
     SPEC's file rules: only `kind: "file"` entries match, so a directory or a symbolic link at a candidate path
     never counts; links are never entered; `.git` and `node_modules` are skipped below a `**`; a literal pattern
     lists only its literal parents. `packages/core/src/index.ts` therefore also exports `walkGlob`,
     `WalkLimitError` and `type WalkBudget` (today only `DirEntry` and `ListDir` are exported from that module).
2. **node-io, I/O** — new `packages/node-io/src/discovery.ts`:
   - `discoverCoverage(deps, repoRoot)` walks every candidate with `walkGlob` over
     `(dir) => deps.listDir(deps.resolvePath(repoRoot, dir))`, under ONE shared `WalkBudget` and the existing
     limits `MAX_COVERAGE_GLOB_FILES` / `MAX_COVERAGE_WALK_ENTRIES` (SPEC Constraints: at most 1,000 matched files
     and 100,000 visited entries per run). A `WalkLimitError` becomes a `ConfigError` with
     `coverageDiscoveryLimitText`. The collected paths go through `chooseDiscoveredCoverage`, so the I/O path and the
     pure rule are one rule (AC-6). The existence check is the real `listDir`, which reports a link as `symlink`
     and never follows it (`packages/node-io/src/io.ts`).
   - `readDiscoveredCoverage(deps, options)` is what the CLI and the Action both call: ambiguous → throws a
     `ConfigError` with `coverageDiscoveryAmbiguousText(found, options.howToSet)`; not-found → returns the core
     not-found value itself, for `check()`; found → calls `options.log(coverageDiscoveryLine(path))` once per file,
     then reads them through the existing `readCoverageFiles` with `baseDir: repoRoot`, `name: (entry) => entry`
     (repo-relative, forward slashes, in both adapters), the resolved `coverage-format` and `coverage-root`, and a
     new opt-in `literal: true` option, so a discovered path that contains `*`, `?`, `[`, `]`, `{` or `}` is read
     as that file and never re-parsed or rejected as a glob.
3. **Inputs** — `resolveInputs` gains an optional fourth argument `{ discoverCoverage?: boolean }`. Only when it is
   true and no coverage path is given does `coverageFile` resolve to `{ discover: true }` instead of pushing the
   `noCoverageFile` error. Without it the function is byte-for-byte as today, so every existing `resolveInputs`
   test (including the `["coverageFile", "no coverage file"]` row of `packages/core/test/inputs.test.ts`) keeps
   passing unchanged. A given flag, input or config entry resolves exactly as today (AC-11, AC-14 third run).
4. **check()** — `CheckInput.coverage` gains a fourth variant, the not-found discovery value
   (`CoverageDiscoveryNotFound`, `{ kind: "not-found" }`), so AC-5 passes core's own result straight in. `check()`
   computes `base` as usual (gate-input findings ride along, as for a missing file) and returns early, before the
   `missingFile` loop and the diff-unavailable branch, with `diffCoverage: null` and a new internal
   `BuildReportInput.missing` reason `{ reason: "coverage-not-discovered" }`. `buildReport` maps that reason to the
   EXISTING code `COVERAGE_FILE_MISSING` with today's level rule (error with a threshold, warn without), and text
   from `coverageNotDiscoveredText()`. No report field and no message code is added, so `schema/report.v1.json` and
   the `Report` / `Message` / `MessageCode` types stay as they are (SPEC Assumptions; Out of scope: "A new report
   field or message code"). The renderer already escapes message text (`inlineText` in `render/markdown.ts`), so
   the `*` of the glob candidate needs no renderer change.
5. **Adapters** — CLI (`packages/cli/src/main.ts`): the second `resolveInputs` call passes
   `{ discoverCoverage: true }`; on `{ discover: true }` it calls `readDiscoveredCoverage` with the repo root from
   `git rev-parse --show-toplevel` (so a run from a subdirectory discovers from the root), stderr as the log, and
   `howToSet` = `pass --coverage <file> or set coverage.file in .pharn/ci.yml`. An ambiguity reaches `main`'s
   existing catch: exit 2, message on stderr, stdout empty (AC-9). The explicit branch keeps its current
   `readCoverageFiles` call unchanged. HELP's `--coverage` line says the default is `coverage.file` from config,
   then auto-discovery. Action (`packages/action/src/run.ts`): the same, with `deps.workspace` as the root,
   `deps.info` as the log and `howToSet` = `set the coverage-file input or coverage.file in .pharn/ci.yml`.
   Discovery runs where the coverage read runs today (after `resolvePrNumberTarget`, before the diff, the summary
   and `upsertComment`), so an ambiguity fails the step through `run()`'s catch with no comment created or updated
   (AC-13), and PR-number mode probes the workspace like any run.
6. **Examples and docs** — five workflows under `examples/workflows/` in the README quick start's shape, and the
   doc edits the SPEC's Scope names.

## Applied lessons

- none — `node pharn/floor/check-lessons-index.mjs . --verdict` printed `NO_CANON`: this project has no
  `memory-bank/lessons-learned.md` yet, so there is no lesson to apply.

## Steps

1. **core: discovery module.** Add `packages/core/src/coverageDiscovery.ts` with `COVERAGE_DISCOVERY_CANDIDATES`,
   the `CoverageDiscovery` union and `CoverageDiscoveryNotFound`, `chooseDiscoveredCoverage`,
   `coverageDiscoveryLine`, `coverageDiscoveryAmbiguousText`, `coverageNotDiscoveredText` and
   `coverageDiscoveryLimitText`. Relative imports only (`./glob.js`), no I/O, no clock (the purity test scans every
   file under `packages/core/src`).
2. **core: exports.** In `packages/core/src/index.ts` export the above, plus `walkGlob`, `WalkLimitError` and
   `type WalkBudget` from `./globWalk.js`.
3. **core: inputs.** In `packages/core/src/inputs.ts` add the optional `options?: { discoverCoverage?: boolean }`
   parameter and widen `ResolvedInputs.coverageFile` to
   `{ path: string | readonly string[]; fromConfig: boolean } | { discover: true }` (doc comment updated). Keep
   `InputErrorText.noCoverageFile`: it is still used without the option. Only `packages/cli/src/main.ts` and
   `packages/action/src/run.ts` read `coverageFile` in `src` (grep this run); both are in scope.
4. **core: check and report.** In `packages/core/src/check.ts` add `CoverageDiscoveryNotFound` to
   `CheckInput.coverage` (doc comment) and the early return described above, without changing any existing branch.
   In `packages/core/src/report.ts` add `{ reason: "coverage-not-discovered" }` to `BuildReportInput.missing`, its
   branch in `buildReport` (code `COVERAGE_FILE_MISSING`, the existing `level`, text from
   `coverageNotDiscoveredText()`), and extend the "Diff coverage could not be computed" comment.
5. **node-io: literal option.** In `packages/node-io/src/coverage.ts` add `literal?: boolean` to
   `ReadCoverageFilesOptions`; when true every entry is `{ kind: "literal", entry }` and
   `parseCoverageEntries` / `expandCoverageEntries` are skipped. The default path is unchanged.
6. **node-io: discovery.** Add `packages/node-io/src/discovery.ts` with
   `discoverCoverage(deps: Pick<CoverageReadDeps, "listDir" | "resolvePath">, repoRoot: string):
   Promise<CoverageDiscovery>` and `readDiscoveredCoverage(deps: CoverageReadDeps, options: { repoRoot: string;
   format: CoverageFormatSelection; coverageRoot?: string; howToSet: string; log(line: string): void }):
   Promise<CheckInput["coverage"]>`. Export both from `packages/node-io/src/index.ts`.
7. **CLI.** In `packages/cli/src/main.ts`: `{ discoverCoverage: true }` on the second `resolveInputs` call (the
   first, flags-only call stays as it is: its coverage-file error is only read when the flag was given); branch on
   `"discover" in coverageFile`; feed the result into `CheckInput.coverage`; update HELP's `--coverage` text and the
   `CliDeps.listDir` doc comment ("only called to expand a coverage glob or discover the coverage file").
8. **Action.** In `packages/action/src/run.ts`: the same, with `deps.workspace`, `deps.info` and the Action's
   `howToSet`; the explicit branch keeps its options exactly; update the `ActionDeps.listDir` doc comment.
9. **Existing tests the approved intent makes wrong (AGENTS.md rule 4 and the SPEC's Constraints: replace, and say
   why in the PR description).** Two table rows assert the old stop that this change removes:
   - `packages/cli/test/main.test.ts` — the `[["check"], "no coverage file"]` row of `exits 2 for %j`. Remove that
     row and add, in the same file, a test that runs `main(["check", "--format", "json"], deps)` on `fakeDeps({})`
     with `deps.listDir = async () => null` and asserts exit `EXIT_OK`, stdout a report whose first message is
     `COVERAGE_FILE_MISSING` at level `warn` naming `coverage/lcov.info` and `coverage.file`, and no
     `(auto-discovered)` on stderr. (`fakeDeps` has no `listDir`, so the old row would now fail with a TypeError,
     not with the old message.)
   - `packages/action/test/run.test.ts` — the `[{ "coverage-file": "" }, "no coverage file"]` row of `fails clearly
     for invalid inputs %j`. Remove that row and add, in the same file, a test that runs the harness with
     `"coverage-file": ""` and `h.deps.listDir = async () => null`, and asserts the returned report's
     `COVERAGE_FILE_MISSING` message names the candidates and `h.failed` is empty.
   No other existing test is edited. `packages/cli/test/fake-deps.ts` and `packages/action/test/harness.ts` stay as
   they are (a default `listDir` there could change other tests).
10. **Fixtures for AC-6** (built by this build, before the AC tests can pass): one directory per case under
    `fixtures/coverage-discovery/`, each with an unrelated `src/a.ts` beside its candidate files (see `## Files`).
    Candidate files hold a small valid report (an lcov record for `src/a.ts`, or a minimal Cobertura document).
    Only `/coverage/` at the repo root is git-ignored (`.gitignore`, read this run), so these paths commit. The
    `node_modules`, directory-at-candidate and symlink cases of AC-7 are built in a temp dir by its test (SPEC
    Assumptions), never committed.
11. **Examples.** Write `examples/workflows/{vitest,jest,pytest,dotnet,cargo}.yml`, each with the README quick
    start's top-level `permissions` (`contents: read`, `pull-requests: write`) and `concurrency` block verbatim,
    `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` with `fetch-depth: 0`, the toolchain
    setup, the SPEC's AC-16 test command verbatim as a plain `run:` scalar, then
    `- uses: pharn-dev/pharn-ci@v0.1.0 # or, better, the tag's full commit SHA` with `timeout-minutes: 5` and no
    `with:`. Toolchains: vitest and jest use
    `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` (the pin `.github/workflows/` already
    uses) and `npm ci`; vitest also installs `@vitest/coverage-v8` (SPEC Assumptions); pytest uses
    `actions/setup-python` and `pip install pytest pytest-cov`; dotnet uses `actions/setup-dotnet`; cargo uses
    `taiki-e/install-action` with `tool: cargo-llvm-cov` (the runner image has rustup; add `llvm-tools-preview`).
    Look up the setup-python, setup-dotnet and install-action SHAs from their real latest release tags with
    `gh api` (dereference an annotated tag to its commit) and write `@<40-hex> # vX.Y.Z`. A comment in each file
    says no threshold is set, so the step reports and never fails.
12. **Docs.** README `## Quick start`: a short paragraph after the workflow saying `coverage-file` may be omitted
    when the report is at a discovery candidate (the five paths; several found is an error asking you to set the
    path; none found is `COVERAGE_FILE_MISSING`) and pointing to `examples/workflows/`; the YAML block and its
    single pharn-ci step stay as they are. README `## CLI`: the `--coverage` bullet says that without it and without
    `coverage.file` the CLI auto-discovers from the repo root and prints `coverage: <path> (auto-discovered)` on
    stderr, and names `examples/workflows/`. Do not add or change any `uses:` line in README.md
    (`packages/core/test/ac-release-docs.test.ts` counts exactly 4 `uses: pharn-dev/pharn-ci@` lines and requires
    `# vX.Y.Z` on every other `uses:` line). `action.yml`: append to the `coverage-file` description that the path
    is auto-discovered when unset. `CHANGELOG.md`: one line under `## [Unreleased]` / `### Added` naming coverage
    auto-discovery and `examples/workflows/`. `docs/THREAT-MODEL.md`: a NEW row `A3` in section 2 for coverage
    auto-discovery (the probe reads files at fixed paths the PR's own test run can write; no link followed, `.git`
    and `node_modules` skipped, the shared walk limits, ambiguity refused rather than guessed), naming
    `packages/node-io/test/ac-discovery-walk-rules.test.ts` as its test. Rows A1 and A2 are left as they are:
    `packages/core/test/ac-stream-docs.test.ts` asserts on row A1's residual text.
13. **Build.** `pnpm build` refreshes `packages/action/dist/index.js` (AGENTS.md rule 7); `pnpm lint` and
    `pnpm test` green; `pnpm format` only on the files named below, one by one.

## Files

- `packages/core/src/coverageDiscovery.ts` — new: candidate list, pure choice rule, log, error and message text builders
- `packages/core/src/index.ts` — export the discovery API, and `walkGlob`, `WalkLimitError`, `WalkBudget`
- `packages/core/src/inputs.ts` — opt-in `discoverCoverage` option; `coverageFile` may resolve to `{ discover: true }`
- `packages/core/src/check.ts` — `CheckInput.coverage` accepts the not-found discovery value; early `COVERAGE_FILE_MISSING` return
- `packages/core/src/report.ts` — `coverage-not-discovered` missing reason mapped to `COVERAGE_FILE_MISSING` with the candidates text
- `packages/node-io/src/coverage.ts` — opt-in `literal` option on `readCoverageFiles`
- `packages/node-io/src/discovery.ts` — new: `discoverCoverage` and `readDiscoveredCoverage`, shared by the CLI and the Action
- `packages/node-io/src/index.ts` — export the discovery helpers
- `packages/cli/src/main.ts` — discovery when no coverage path is set; HELP and `listDir` doc text
- `packages/action/src/run.ts` — discovery when no coverage path is set; `listDir` doc text
- `packages/action/dist/index.js` — rebuilt with `pnpm build`
- `packages/cli/test/main.test.ts` — replace the obsolete `["check"]` exit-2 row with a test of the new not-found report (step 9)
- `packages/action/test/run.test.ts` — replace the obsolete empty `coverage-file` failure row with a test of the new not-found report (step 9)
- `fixtures/coverage-discovery/coverage-lcov/coverage/lcov.info` — AC-6 case: only `coverage/lcov.info`
- `fixtures/coverage-discovery/coverage-lcov/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/lcov-root/lcov.info` — AC-6 case: only `lcov.info`
- `fixtures/coverage-discovery/lcov-root/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/coverage-xml/coverage.xml` — AC-6 case: only `coverage.xml`
- `fixtures/coverage-discovery/coverage-xml/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/cobertura-coverage/coverage/cobertura-coverage.xml` — AC-6 case: only `coverage/cobertura-coverage.xml`
- `fixtures/coverage-discovery/cobertura-coverage/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/dotnet-one/tests/App.Tests/TestResults/abc/coverage.cobertura.xml` — AC-6 case: one coverlet file
- `fixtures/coverage-discovery/dotnet-one/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/a1/coverage.cobertura.xml` — AC-6 case: several coverlet files (1 of 3)
- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/b2/coverage.cobertura.xml` — AC-6 case: several coverlet files (2 of 3)
- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/c3/coverage.cobertura.xml` — AC-6 case: several coverlet files (3 of 3)
- `fixtures/coverage-discovery/dotnet-many/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/two-kinds/coverage/lcov.info` — AC-6 ambiguous case (1 of 2)
- `fixtures/coverage-discovery/two-kinds/lcov.info` — AC-6 ambiguous case (2 of 2)
- `fixtures/coverage-discovery/two-kinds/src/a.ts` — unrelated file for that case
- `fixtures/coverage-discovery/none/src/a.ts` — AC-6 not-found case: only an unrelated file
- `examples/workflows/vitest.yml` — new example workflow
- `examples/workflows/jest.yml` — new example workflow
- `examples/workflows/pytest.yml` — new example workflow
- `examples/workflows/dotnet.yml` — new example workflow
- `examples/workflows/cargo.yml` — new example workflow
- `README.md` — Quick start and CLI section mention auto-discovery and `examples/workflows/`
- `action.yml` — `coverage-file` description says the path is auto-discovered when unset
- `CHANGELOG.md` — Unreleased line for coverage auto-discovery
- `docs/THREAT-MODEL.md` — new row A3: coverage auto-discovery as disk probing of untrusted files, with its covering test

### Explicitly not touched

- `schema/report.v1.json` — no field and no message code is added (the not-found case reuses `COVERAGE_FILE_MISSING`)
- `packages/core/src/render/markdown.ts` — message text is already escaped by `inlineText`
- `packages/core/src/globWalk.ts` — reused as is, only re-exported
- `packages/core/src/coverageEntries.ts` — reused as is (limits)
- `packages/cli/test/fake-deps.ts` — shared test helper, left as is
- `packages/action/test/harness.ts` — shared test helper, left as is
- `packages/core/test/inputs.test.ts` — keeps passing because discovery is opt-in in `resolveInputs`
- `scripts/check-action-pins.mjs` — not extended to `examples/` (SPEC non-goal); it scans only `.github/workflows` and `.github/actions`
- `fixtures/golden/report.md` — no golden file changes (SPEC Constraints)
- `docs/LIMITS.md` — the walk limits it states are reused unchanged
- `AGENTS.md` — no standing convention changes
- `vitest.config.ts` — its `packages/*/test/**/*.test.ts` include already runs node-io tests

## Acceptance mapping

- AC-1 → `chooseDiscoveredCoverage` returns `found` with the single path for each literal candidate and for one .NET match (step 1).
- AC-2 → the glob candidate's matches are one kind, returned sorted (step 1).
- AC-3 → two or more kinds → `ambiguous` with every found path and no `files` (step 1).
- AC-4 → no match → `not-found`; `COVERAGE_DISCOVERY_CANDIDATES` is the exact ordered list (step 1).
- AC-5 → `check()` with the not-found value returns `diffCoverage: null` and one `COVERAGE_FILE_MISSING` (warn/warn, or error/fail with 80) naming the five candidates and `coverage.file`; valid against the unchanged schema (step 4).
- AC-6 → `discoverCoverage(deps, fixtureDir)` is `chooseDiscoveredCoverage` over what the walk finds; one fixture per case (steps 6, 10).
- AC-7 → `walkGlob` skips `node_modules` below `**`, matches only `kind: "file"`, never follows links; node-io's `listDir` reports links as links (steps 2, 6).
- AC-8 → CLI discovers from `rev-parse --show-toplevel`, logs the `(auto-discovered)` line on stderr, reads lcov (step 7).
- AC-9 → CLI ambiguity is a `ConfigError` caught by `main` → exit 2, stderr names both files and `--coverage`, stdout empty (step 7).
- AC-10 → CLI not-found → report with `COVERAGE_FILE_MISSING`; exit 0 without a threshold, 1 with 80; no discovery line (steps 4, 7).
- AC-11 → an explicit `--coverage` or `coverage.file` keeps the existing branch; discovery is never called (steps 3, 7).
- AC-12 → Action discovers `coverage.xml`, logs through `info`, report has `format: cobertura` (step 8).
- AC-13 → Action ambiguity throws before the diff and the comment code; `run()`'s catch fails the step naming both files and `coverage-file` (step 8).
- AC-14 → Action not-found → `COVERAGE_FILE_MISSING`; the step fails only with threshold 80, through the existing verdict path; an explicit `coverage-file: missing.info` keeps today's branch (steps 3, 4, 8).
- AC-15 → example workflow shape and SHA pins (step 11).
- AC-16 → the five SPEC test commands verbatim (step 11).
- AC-17 → README, `action.yml`, CHANGELOG and THREAT-MODEL edits (step 12).

## Risks & open questions

- **Two existing test rows are replaced (step 9).** The SPEC's Constraints allow it explicitly ("A test that asserts
  the old 'no coverage file' stop is replaced by a test of the new not-found behaviour"); each replacement asserts
  at least as much as the row it replaces. Both must be named, with the reason, in the PR description.
- **The `**/coverage.cobertura.xml` walk visits the whole repo** (minus `.git` and `node_modules`) on every run with
  no configured path. A repo with more than 100,000 entries outside those two (a large cargo `target/`, a Python
  `.venv`, .NET `bin/`/`obj/`) gets the walk-limit error instead of a report. The SPEC accepts this (Assumptions:
  exceeding the limits "is an error naming the limit"); the error text tells the user to set the coverage path.
- **Example SHAs need the network at build time** (`gh api`) for `actions/setup-python`, `actions/setup-dotnet` and
  `taiki-e/install-action`; no offline test can prove a SHA is the named release (SPEC Assumptions).
- **The prior run's record `pharn/features/coverage-auto-discovery/` claims `ac-coverage-discovery-*` test names**
  in its AC-TESTS.md, so this feature's AC tests use the distinct `ac-discovery-*` names.
- **Run on this repository itself**: `.pharn/ci.yml` sets `coverage.file` and the dogfood step in
  `.github/workflows/ci.yml` sets `coverage-file`, so discovery never runs here. Without them, tracked fixtures that
  match `**/coverage.cobertura.xml` (in `fixtures/coverage-multi/coverlet/` and the new `dotnet-*` fixtures) plus a
  root `coverage/lcov.info` would be ambiguous: the intended refusal, not a defect.
