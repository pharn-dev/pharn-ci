---
spec_id: coverage-auto-discovery
spec_content_hash: "c2ecffbfe055ee729424799c2704c34c688015003d2158cc6cbdcb4c561b5cb2"
applied_lessons: none
---

> ADVISORY: this plan is model work. Only its frontmatter shape, its `## Files` scope and the AC mapping are
> floor-checked. Every claim about the repo below comes from a read made this run.

## Approach

When no coverage path is set (no `--coverage` flag, an empty `coverage-file` input, no `coverage.file`), the CLI
and the Action stop calling `readCoverageFiles` on a configured setting and instead run a shared discovery from
`packages/node-io`. Discovery has three layers, so that core stays pure (AGENTS.md rule 1):

1. **core, pure choice** (`packages/core/src/coverageDiscovery.ts`, new): the fixed candidate list
   `COVERAGE_DISCOVERY_CANDIDATES` (`coverage/lcov.info`, `lcov.info`, `coverage.xml`,
   `coverage/cobertura-coverage.xml`, `**/coverage.cobertura.xml`, in that order) and
   `chooseDiscoveredCoverage(paths)`, which takes any set of existing repo-relative paths, keeps those that equal a
   literal candidate or match the glob candidate (via `compileGlob`; a path with a `.git` or `node_modules` segment
   never matches, the walk's own rule), and returns one of
   `{ kind: "found"; files: string[] }` (exactly one candidate kind matched; the glob's matches count as one kind and
   are all returned, sorted, de-duplicated), `{ kind: "ambiguous"; found: string[] }` (two or more kinds; every found
   path, in candidate order, glob matches sorted) or `{ kind: "not-found" }`.
2. **core, pure walk over an injected listing** (same file): `walkCoverageCandidates(listDir: ListDir)` walks every
   candidate with the existing `walkGlob` (`packages/core/src/globWalk.ts`) under ONE shared budget and the existing
   limits (`MAX_COVERAGE_GLOB_FILES`, `MAX_COVERAGE_WALK_ENTRIES` from `coverageEntries.ts`). `walkGlob` already gives
   the SPEC's file rules for free: a literal pattern lists only its literal parents; only `kind: "file"` entries
   match, so a directory or a symbolic link at a candidate path never counts; `.git` and `node_modules` are skipped
   below a `**`. A `WalkLimitError` becomes a `ConfigError` naming the limit and the candidate, worded like
   `expandCoverageEntries`' messages. Like `expandCoverageEntries`, this is async over a caller-supplied listing and
   does no I/O itself.
3. **node-io, the I/O** (`packages/node-io/src/discovery.ts`, new): `discoverCoverage(deps, repoRoot)` =
   `chooseDiscoveredCoverage(await walkCoverageCandidates((dir) => deps.listDir(deps.resolvePath(repoRoot, dir))))`
   (the existence checks are the real `listDir`, which reports links as links and never follows them), and
   `readDiscoveredCoverage(deps, options)`, which the CLI and the Action both call: ambiguous → throws a
   `ConfigError` whose text (from core `coverageDiscoveryAmbiguousText(found, howToSet)`) lists every found path and
   the adapter's own way to set the path; not-found → returns `{ kind: "not-found" }` for `check()`; found → logs
   `coverage: <path> (auto-discovered)` once per file (core `coverageDiscoveryLine(path)`), then reads the files
   through the existing `readCoverageFiles` with `baseDir: repoRoot`, names that are repo-relative as found, the
   resolved `coverage-format` and `coverage-root`, and a new `literal: true` option so a discovered path that
   happens to contain `*`, `?`, `[`, `]`, `{` or `}` is read as that file, never re-parsed as a glob.

**Inputs.** `resolveInputs` gains an optional fourth argument `{ discoverCoverage?: boolean }`. Only when it is true
and no coverage path is given does `coverageFile` resolve to `{ discover: true }` instead of pushing the
`noCoverageFile` error. Without the option the behaviour (and every existing `resolveInputs` test, including the
`["coverageFile", "no coverage file"]` row of `packages/core/test/inputs.test.ts`) is byte-for-byte unchanged. An
explicit flag, input or config entry resolves exactly as today (AC-11, AC-14 third run).

**check().** `CheckInput.coverage` gains a fourth variant, the not-found discovery result itself
(`{ kind: "not-found" }`, the type core exports as `CoverageDiscoveryNotFound`). `check()` treats it like a missing
file: early return, before the diff-unavailable branch, with `diffCoverage: null` and a new internal
`BuildReportInput.missing` reason `{ reason: "coverage-not-discovered" }`. `buildReport` maps that reason to the
EXISTING code `COVERAGE_FILE_MISSING`, with the same level rule as today (error with a threshold, warn without), and
a text that names the five candidates and how to set the path, for example: `No coverage file was set, and none was
found at the default paths: coverage/lcov.info, lcov.info, coverage.xml, coverage/cobertura-coverage.xml,
**/coverage.cobertura.xml. Set the path with coverage.file in .pharn/ci.yml, the coverage-file input or --coverage.`
The renderer's `inlineText` already escapes the `*`, so `packages/core/src/render/markdown.ts` needs no change.
No report field and no message code is added, so `schema/report.v1.json` and the `Report` type are unchanged
(SPEC Assumptions: "No new message code is needed"; the report gains no discovery field).

**Adapters.** CLI (`packages/cli/src/main.ts`): call `resolveInputs(config, raw, FLAG_ERRORS, { discoverCoverage:
true })`; on `{ discover: true }` call `readDiscoveredCoverage` with the repo root from `git rev-parse
--show-toplevel` (so a run from a subdirectory discovers from the root), stderr as the log, and the CLI's
`howToSet` (`pass --coverage <file> or set coverage.file in .pharn/ci.yml`); an ambiguity reaches the existing
`main` catch, so exit 2, stderr only, stdout empty (AC-9). The HELP line for `--coverage` says the default is
`coverage.file`, then auto-discovery. Action (`packages/action/src/run.ts`): the same, with `deps.workspace` as the
root, `deps.info` as the log and the Action's `howToSet` (`set the coverage-file input or coverage.file in
.pharn/ci.yml`). Discovery runs where the coverage read runs today, i.e. after `resolvePrNumberTarget` and before
the diff, the summary and `upsertComment`, so an ambiguity fails the step through `run()`'s catch with no comment
created or updated (AC-13), and PR-number mode probes the workspace like any run.

**Examples and docs.** Five workflows under `examples/workflows/`, each a copy of the README quick start's shape
(`permissions`, the same `concurrency` group, `actions/checkout` at the SHA the README already pins with
`fetch-depth: 0`, the toolchain, the SPEC's exact test command, then `uses: pharn-dev/pharn-ci@v0.1.0` with
`timeout-minutes: 5` and no `with:`). Docs per SPEC Scope.

## Applied lessons

- none — `check-lessons-index.mjs --verdict` printed `NO_CANON`: this project has no `memory-bank/lessons-learned.md`
  yet, so there is no lesson to apply.

## Steps

1. **core: discovery module.** Add `packages/core/src/coverageDiscovery.ts` with `COVERAGE_DISCOVERY_CANDIDATES`
   (a frozen readonly tuple), the `CoverageDiscovery` union and `CoverageDiscoveryNotFound`,
   `chooseDiscoveredCoverage(paths: Iterable<string>): CoverageDiscovery`, `walkCoverageCandidates(listDir:
   ListDir): Promise<string[]>`, `coverageDiscoveryLine(path: string): string` (exactly
   `coverage: ${path} (auto-discovered)`), `coverageDiscoveryAmbiguousText(found: readonly string[], howToSet:
   string): string` and `coverageNotDiscoveredText(): string` (the not-found message text, built from the candidate
   list so the two cannot drift). Imports only relative modules (`glob.js`, `globWalk.js`, `coverageEntries.js`,
   `config.js`), no I/O, no clock.
2. **core: exports.** Export the above from `packages/core/src/index.ts`.
3. **core: inputs.** In `packages/core/src/inputs.ts` add the optional `options?: { discoverCoverage?: boolean }`
   parameter to `resolveInputs` and widen `ResolvedInputs.coverageFile` to
   `{ path: string | readonly string[]; fromConfig: boolean } | { discover: true }`. Keep `noCoverageFile` in
   `InputErrorText` (still used without the option).
4. **core: check and report.** In `packages/core/src/check.ts` add the `CoverageDiscoveryNotFound` variant to
   `CheckInput.coverage` (doc comment) and handle it as described above, before the diff-unavailable return, without
   changing any existing branch. In `packages/core/src/report.ts` add `{ reason: "coverage-not-discovered" }` to
   `BuildReportInput.missing` and its branch in `buildReport` (code `COVERAGE_FILE_MISSING`, existing level rule,
   text from `coverageNotDiscoveredText()`); update the "Diff coverage could not be computed" comment. The
   `Report`, `Message` and `MessageCode` types stay as they are.
5. **node-io: literal option.** In `packages/node-io/src/coverage.ts` add `literal?: boolean` to
   `ReadCoverageFilesOptions`; when true, every entry is `{ kind: "literal", entry }` and `parseCoverageEntries` /
   `expandCoverageEntries` are skipped. The default path is unchanged.
6. **node-io: discovery.** Add `packages/node-io/src/discovery.ts` with `discoverCoverage(deps: Pick<CoverageReadDeps,
   "listDir" | "resolvePath">, repoRoot: string): Promise<CoverageDiscovery>` and `readDiscoveredCoverage(deps:
   CoverageReadDeps, options: { repoRoot: string; format: CoverageFormatSelection; coverageRoot?: string; howToSet:
   string; log(line: string): void }): Promise<CheckInput["coverage"]>` (returns `{ files, format }` when found,
   `{ kind: "not-found" }` when not). Export both from `packages/node-io/src/index.ts`.
7. **CLI.** In `packages/cli/src/main.ts`: pass `{ discoverCoverage: true }` to the second `resolveInputs` call;
   branch on `"discover" in coverageFile` to `readDiscoveredCoverage` (else the existing `readCoverageFiles` call,
   untouched); feed the result into `CheckInput.coverage`; update HELP's `--coverage` default text. The first,
   flags-only `resolveInputs` call stays as it is.
8. **Action.** In `packages/action/src/run.ts`: the same, with `deps.workspace`, `deps.info` and the Action's
   `howToSet`; the explicit branch keeps its current options exactly.
9. **Existing tests made wrong by the approved intent (AGENTS.md rule 4: fix, and explain in the PR).** Two table
   rows assert the old stop that the SPEC removes (Intent: today the run "stops with 'no coverage file'"; AC-10 and
   AC-14 now require a `COVERAGE_FILE_MISSING` report instead):
   - `packages/cli/test/main.test.ts` — the `[["check"], "no coverage file"]` row of `exits 2 for %j`. Replace it with
     a test in the same file that runs `main(["check", "--format", "json"], deps)` on `fakeDeps({})` with
     `deps.listDir = async () => null` and asserts at least as much: exit `EXIT_OK`, the first message is
     `COVERAGE_FILE_MISSING` at level `warn`, its text contains `coverage/lcov.info` and `coverage.file`, and stderr
     has no `(auto-discovered)` line.
   - `packages/action/test/run.test.ts` — the `[{ "coverage-file": "" }, "no coverage file"]` row of `fails clearly for
     invalid inputs %j`. Replace it with a test in the same file that runs the harness with `"coverage-file": ""`,
     `files` without `coverage/lcov.info` and `h.deps.listDir = async () => null`, and asserts the report's message
     is `COVERAGE_FILE_MISSING` naming the candidates and `h.failed` is empty.
   No other existing test is edited; the shared helpers `packages/cli/test/fake-deps.ts` and
   `packages/action/test/harness.ts` stay as they are (a default `listDir` there could change other tests). Name both
   replacements in the PR description.
10. **Fixtures** for AC-6 (built by this step, before the AC tests run green): one directory per case under
    `fixtures/coverage-discovery/`, each with an unrelated `src/a.ts` beside its candidate files (see `## Files`).
    Candidate files hold a small valid report (an lcov record for `src/a.ts`, or a minimal Cobertura document), so a
    fixture is also readable if a later test parses it. The `node_modules`, directory-at-candidate-path and symlink
    cases of AC-7 are built in a temp dir by the test (SPEC Assumptions), not committed.
11. **Examples.** Write `examples/workflows/{vitest,jest,pytest,dotnet,cargo}.yml`. Reuse the SHAs the repo already
    pins: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` and
    `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0` (from `.github/workflows/`). Resolve the
    others from their real release tags with `gh api` (dereference annotated tags to the commit):
    `actions/setup-python`, `actions/setup-dotnet`, and `taiki-e/install-action` (installs `cargo-llvm-cov`). Write
    each pin as `@<40-hex> # vX.Y.Z`, the README's comment form. The test commands are the SPEC's AC-16 strings,
    verbatim. No `with:` on the pharn-ci step.
12. **Docs.** README: in `## Quick start`, a short paragraph after the workflow saying the coverage path is
    auto-discovered when unset (the five candidates; several found is an error; none found is
    `COVERAGE_FILE_MISSING`) and pointing to `examples/workflows/`; in `## CLI`, a bullet for `--coverage` saying the
    same for the CLI (discovery from the repo root, the `(auto-discovered)` stderr line) and naming
    `examples/workflows/`. Leave the Quick start YAML and every `uses:` line as they are:
    `packages/core/test/ac-release-docs.test.ts` counts exactly 4 `uses: pharn-dev/pharn-ci@` lines in README.md and
    requires `# vX.Y.Z` on every other `uses:` line, and `ac-globs-docs.test.ts` reads the Quick start section.
    `action.yml`: append to the `coverage-file` description that it is auto-discovered when unset. `CHANGELOG.md`:
    one line under `## [Unreleased]` / `### Added` naming coverage auto-discovery and `examples/workflows/`.
    `docs/THREAT-MODEL.md`: extend row A2 (path handling) or add a row in section 2 for coverage auto-discovery — the
    probe reads files at fixed paths the PR's own test run can write; no link followed, `.git` and `node_modules`
    skipped, shared walk limits, ambiguity refused rather than guessed — naming
    `packages/node-io/test/ac-coverage-discovery-walk.test.ts` as the test that covers it.
13. **Build.** `pnpm build` to refresh `packages/action/dist/index.js` (AGENTS.md rule 7); `pnpm lint` and
    `pnpm test` green.

## Files

- `packages/core/src/coverageDiscovery.ts` — new: candidate list, pure choice, pure walk over an injected listing, log and message text builders
- `packages/core/src/index.ts` — export the discovery API
- `packages/core/src/inputs.ts` — optional `discoverCoverage` option; `coverageFile` may resolve to `{ discover: true }`
- `packages/core/src/check.ts` — `CheckInput.coverage` accepts the not-found discovery result; early `COVERAGE_FILE_MISSING` return
- `packages/core/src/report.ts` — `coverage-not-discovered` missing reason mapped to `COVERAGE_FILE_MISSING` with the candidates text
- `packages/node-io/src/coverage.ts` — `literal` option on `readCoverageFiles`
- `packages/node-io/src/discovery.ts` — new: `discoverCoverage` and `readDiscoveredCoverage`, shared by CLI and Action
- `packages/node-io/src/index.ts` — export the discovery helpers
- `packages/cli/src/main.ts` — discovery when no coverage path is set; HELP text
- `packages/action/src/run.ts` — discovery when no coverage path is set
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
- `docs/THREAT-MODEL.md` — coverage auto-discovery as disk probing of untrusted files, with its covering test

### Explicitly not touched

- `schema/report.v1.json` — no field and no message code is added (the not-found case reuses `COVERAGE_FILE_MISSING`)
- `packages/core/src/render/markdown.ts` — message text is already escaped by `inlineText`; this file also carries another feature's uncommitted change
- `packages/core/src/globWalk.ts` — reused as is
- `packages/core/src/coverageEntries.ts` — reused as is (limits and messages)
- `packages/cli/test/fake-deps.ts` — shared test helper, left as is
- `packages/action/test/harness.ts` — shared test helper, left as is
- `packages/core/test/inputs.test.ts` — keeps passing because discovery is opt-in in `resolveInputs`
- `scripts/check-action-pins.mjs` — not extended to `examples/` (SPEC non-goal)
- `fixtures/golden/report.md` — no golden file changes (SPEC Constraints)
- `AGENTS.md` — no standing convention changes
- `vitest.config.ts` — the existing `packages/*/test/**/*.test.ts` include already runs node-io tests

## Acceptance mapping

- AC-1 → `chooseDiscoveredCoverage` returns `found` with the single path for each literal candidate and for one `.NET` match (step 1).
- AC-2 → the glob candidate's matches are one kind; all returned sorted (step 1).
- AC-3 → two or more kinds → `ambiguous` with every found path, no chosen file (step 1).
- AC-4 → no match → `not-found`; `COVERAGE_DISCOVERY_CANDIDATES` is the exact ordered list (step 1).
- AC-5 → `check()` with `coverage: { kind: "not-found" }` returns `diffCoverage: null` and one `COVERAGE_FILE_MISSING` (warn/warn or error/fail by threshold) naming the five candidates and `coverage.file`; valid against the unchanged schema (step 4).
- AC-6 → `discoverCoverage(deps, fixtureDir)` = `chooseDiscoveredCoverage` over the listed tree; fixtures per case (steps 6, 10).
- AC-7 → `walkGlob` skips `node_modules` below `**`, matches only `kind: "file"`, never follows links; node-io's `listDir` reports links as links (steps 1, 6).
- AC-8 → CLI discovers from `rev-parse --show-toplevel`, logs the `(auto-discovered)` line on stderr, reads lcov (step 7).
- AC-9 → CLI ambiguity is a `ConfigError` caught by `main` → exit 2, stderr names both files and `--coverage` (step 7).
- AC-10 → CLI not-found → report with `COVERAGE_FILE_MISSING`; exit 0 without a threshold, 1 with 80; no discovery line (steps 4, 7).
- AC-11 → explicit `--coverage` or `coverage.file` keeps the existing branch; discovery is never called (steps 3, 7).
- AC-12 → Action discovers `coverage.xml`, logs via `info`, report has `format: cobertura` (step 8).
- AC-13 → Action ambiguity throws before the comment code; `run()`'s catch calls `setFailed` with both files and `coverage-file` (step 8).
- AC-14 → Action not-found → `COVERAGE_FILE_MISSING` report; step failed only with threshold 80 via the existing verdict path; an explicit `coverage-file: missing.info` keeps today's branch (steps 3, 4, 8).
- AC-15 → example workflow shape and SHA pins (step 11); `scripts/check-action-pins.mjs` does not read `examples/`, so it stays green.
- AC-16 → the five SPEC test commands verbatim (step 11).
- AC-17 → README, `action.yml`, CHANGELOG and THREAT-MODEL edits (step 12).

## Risks & open questions

- **Two existing test rows change (step 9).** The SPEC's Constraints say no existing test is weakened or deleted, while
  its Intent and AC-10/AC-14 remove the very stop those two rows assert. The plan replaces each row with a test of the
  new behaviour that asserts at least as much, and names them for the PR description (AGENTS.md rule 4). `/pharn-grill`
  should check that this reading is acceptable.
- **The `**/coverage.cobertura.xml` walk visits the whole repo** (minus `.git` and `node_modules`) on every run with no
  configured path. A repo with more than 100,000 entries outside those two directories (a large cargo `target/`, a
  Python `.venv`, .NET `bin/`/`obj/`) gets the walk-limit error instead of a report. The SPEC accepts this (Assumptions:
  exceeding the limits "is an error naming the limit"); the error text should tell the user to set the coverage path.
- **Uncommitted work from another feature is in this checkout** (`pr-comment-verdict-callout`: `markdown.ts`, goldens,
  `dist`, its AC tests). This plan touches none of those files except `packages/action/dist/index.js`, which
  `pnpm build` regenerates from the whole tree, so the rebuilt bundle contains that other change too.
- **Example SHAs need the network at build time** (`gh api`) for `actions/setup-python`, `actions/setup-dotnet` and
  `taiki-e/install-action`; no offline test can prove a SHA is the named release (SPEC Assumptions).
- **`ResolvedInputs.coverageFile` widens to a union.** Only `packages/cli/src/main.ts` and `packages/action/src/run.ts`
  read it (grep this run); both are in scope.
