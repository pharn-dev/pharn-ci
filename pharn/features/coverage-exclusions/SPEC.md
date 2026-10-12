---
spec_id: coverage-exclusions
state: Approved
spec_content_hash: "281c8618464de784e1a66053efff1417c7718c4a096a4bf8d74ba8ccd0dbc242"
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
approved_by: model
---

## Intent

pharn-ci counts every changed file the coverage report knows in diff coverage. Generated code,
vendored code and similar files that a project never means to test drag the percent down and fail
the gate for reasons the author cannot act on; `docs/LIMITS.md` says plainly that there is no
exclude list yet. The user wants a way to exclude files from diff coverage by glob, set in the
config file, on the CLI and in the Action, merged together, with the report stating exactly which
changed files were excluded so nothing disappears silently. Because the config file travels with
the pull request, a PR can exclude its own files: the docs must say so, and must say the gate is
only as honest as the config the PR carries. This is run 4 of 5 of "Finish Phase 0 of pharn-ci".

## Scope

**In scope:**

- A `coverage.exclude` list of glob patterns in `.pharn/ci.yml`, a repeatable `--exclude <glob>`
  CLI flag, and an `exclude` Action input (newline- or comma-separated) declared in `action.yml`;
  the three sources are merged as a union, never one overriding another.
- A hand-written glob subset over repo-relative paths: `*` (any run of characters except `/`),
  `**` (any number of whole path segments) and `?` (one character except `/`); no braces, no
  negation, no character classes. Matching time grows linearly with path length for a given pattern.
- Validation of patterns, so a pattern using unsupported syntax is reported as an error, never
  silently matching nothing.
- Excluded changed files leave diff coverage entirely (covered count, coverable count, percent and
  the files table) and are listed, sorted, in a new optional report field
  `diffCoverage.excludedFiles`.
- A one-line "Excluded: N files" summary with the list of paths, inside a `<details>` block, in the
  Diff coverage section of the rendered markdown.
- Extending the config YAML subset to read a list of strings for `coverage.exclude` only.
- Fixture-based tests: a pattern semantics table, hostile paths, linear-time matching, config
  parsing, the three-source merge, and a golden case in `fixtures/golden-exclusions/`.
- The documentation and release bookkeeping AGENTS.md requires (Constraints).

**Out of scope (non-goals):**

- Coverage parsing, coverage format selection or detection, and the Action's lcov-only restriction
  (other runs).
- Any change to the agent setup inventory, which exclusions never affect.
- Brace expansion, negated patterns, character classes, case-insensitive matching, and
  gitignore-style unanchored patterns.
- Excluding files from the coverage report itself, or from the `COVERAGE_FILE_EMPTY` decision.
- A new message code, a change to the verdict rules, or any required field in the report.
- Input size limits.
- Protecting the config file from the PR; the docs recommend CODEOWNERS instead.
- Any refactor of code this change does not need to touch.

## Acceptance Criteria

- **AC-1** Given the glob matcher exported from `@pharn-ci/core` When each pattern and path below is
  matched Then it returns: `*.ts` matches `a.ts` and `.ts` but not `src/a.ts`; `src/*.ts` matches
  `src/a.ts` but not `src/x/a.ts`; `src/**` matches `src`, `src/a.ts` and `src/x/y/a.ts` but not
  `srcx/a.ts`; `**/test/**` matches `test/a.ts` and `a/b/test/c.ts` but not `a/testing/c.ts`;
  `**/*.gen.ts` matches `a.gen.ts` and `x/y/a.gen.ts` but not `a.gen.tsx`; `a?c.ts` matches
  `abc.ts` but not `ac.ts` or `a/c.ts`; `**` matches `a` and `x/y/z.ts`; `a**b.ts` matches
  `axyb.ts` but not `ax/yb.ts`; `*.TS` does not match `a.ts`; `a.ts` does not match `abts`; and
  `a+(b)|$.ts` matches `a+(b)|$.ts` and nothing else in this table
  - verify: unit
- **AC-2** Given the pattern validation exported from `@pharn-ci/core` When it is given `./src/**`,
  and then each of the empty string, `./`, `/src/**`, `!src/**`, `src/`, `a//b`, `../x`,
  `a/../b`, `src\gen\*.ts`, `{a,b}.ts`, `[ab].ts` and `a]b` Then `./src/**` is accepted and matches
  exactly the paths `src/**` matches, and each of the others throws a `ConfigError` whose message
  contains that pattern
  - verify: unit
- **AC-3** Given paths a pull request can name, `src/../secret.ts`, `./a.ts`, `src\a.ts`, `é.ts`,
  `😀.ts` and `docs/ünï.md` When they are matched Then they are matched as given, without
  normalization: `src/**` matches `src/../secret.ts`; `*.ts` does not match `./a.ts` while `**/a.ts`
  does; `src/*.ts` does not match `src\a.ts` while `*.ts` does; `?.ts` matches `é.ts` and `😀.ts`;
  `docs/*` matches `docs/ünï.md`; and no call throws
  - verify: unit
- **AC-4** Given a single-segment path of 100,000 `a` characters and a path of at least 100,000
  characters made of many short segments When the first is matched against `*a*a*a*a*a*a*a*a*b`
  and the second against `**/*/**/*/**/*/**/*.x` Then each returns false within 1000 ms, and each
  returns true within 1000 ms for the same path with a suffix the pattern requires (`b` and `.x`)
  - verify: unit
- **AC-5** Given `.pharn/ci.yml` text whose `coverage.exclude` is a block list, with items indented
  deeper than the `exclude` key in one text and at the key's own column in another, written
  double-quoted, single-quoted and plain, some followed by a `#` comment When it is parsed with
  `parseConfig` Then `coverage.exclude` equals the item strings in order and the other coverage
  fields are read as before; and `exclude:` with no value yields no `exclude` field
  - verify: unit
- **AC-6** Given config texts where `coverage.exclude` is a scalar string, holds a number item, a
  `key: value` mapping item, an empty-string item, an unquoted item starting with `*`, an item that
  AC-2 rejects, or a flow list `[a, b]`, and the existing text `coverage:` followed by
  `  - file: x` When each is parsed Then each throws a `ConfigError`; the unquoted `*` item and the
  flow list messages contain "unsupported YAML syntax", the `- file: x` message contains "lists are
  not supported", and the rejected-pattern message contains the pattern
  - verify: unit
- **AC-7** Given a config whose `coverage.exclude` holds 100,000 items, and one whose single item is
  a valid pattern of 100,000 characters When each is parsed Then each returns the expected list
  within 1000 ms
  - verify: unit
- **AC-8** Given `check()` with a diff that adds coverable lines to a file the exclusion patterns
  match and to a file they do not, a coverage report covering both, and a threshold When it runs
  Then `diffCoverage.coveredLines`, `coverableLines` and `percent` count only the file that is not
  excluded, `diffCoverage.files` holds no excluded path, `diffCoverage.excludedFiles` lists the
  excluded paths sorted the same way as `files`, the verdict follows the recomputed percent, and the
  report is valid against `schema/report.v1.json`
  - verify: unit
- **AC-9** Given `check()` with exclusion patterns and a diff holding a matching file the coverage
  report does not know, a matching deleted file, a renamed file whose new path matches and old path
  does not, and a renamed file whose old path matches and new path does not When it runs Then
  `excludedFiles` lists the unknown file and the first renamed file under its new path, and lists
  neither the deleted file nor the second renamed file, which is measured as usual
  - verify: unit
- **AC-10** Given `check()` with a threshold of 100 and patterns that match every changed file with
  coverable lines When it runs Then `diffCoverage.percent` is null, `coverableLines` is 0, `files`
  is empty, `excludedFiles` lists those files, the messages include `NO_COVERABLE_CHANGES`, and the
  verdict is `pass`
  - verify: unit
- **AC-11** Given `check()` with no exclusion patterns, with an empty pattern list, and with
  patterns that match no changed file When each runs Then the report's `diffCoverage` has no
  `excludedFiles` property
  - verify: unit
- **AC-12** Given `check()` with the pattern `**` and repo files that include agent setup files When
  it runs Then `agentSetup.files` equals the `agentSetup.files` of the same check without patterns
  - verify: unit
- **AC-13** Given `check()` called with a pattern that AC-2 rejects When it runs Then it throws a
  `ConfigError` whose message contains that pattern
  - verify: unit
- **AC-14** Given `schema/report.v1.json` When a report whose `diffCoverage` carries
  `excludedFiles: ["a.ts"]`, one without the property, one with `excludedFiles: [""]` and one with
  `excludedFiles: [1]` are validated Then the first two are valid, the last two are invalid, and
  `excludedFiles` is not among the `diffCoverage` required properties
  - verify: unit
- **AC-15** Given reports with two excluded paths, with one excluded path, with no coverable lines
  plus excluded paths, and without `excludedFiles` When each is rendered with `renderMarkdown` Then
  the first shows, after the diff coverage table and before `### Agent setup`, a `<details>` block
  whose `<summary>` reads `Excluded: 2 files` followed by one list item per excluded path, each a
  code span, in report order; the second's summary reads `Excluded: 1 file`; the third shows the
  same block after the `_No coverable lines changed._` line; and the fourth contains no `Excluded:`
  text
  - verify: unit
- **AC-16** Given a report whose `excludedFiles` are the hostile paths in
  `fixtures/render/hostile-paths.json` When it is rendered Then it has exactly as many lines as the
  same report with harmless paths, no line starting with `## ` other than the verdict heading, and
  no raw `<img` outside code spans
  - verify: unit
- **AC-17** Given `fixtures/golden-exclusions/` holding a unified diff, an lcov coverage file, a
  tracked-files list and at least two changed files that the fixture's patterns exclude, one through
  a `**` pattern and one through a `*` pattern When `check()` runs on them with those patterns and a
  threshold and the report is rendered Then the report is schema-valid, its `excludedFiles` equals
  the fixture's excluded paths, none of them is in `diffCoverage.files`, and the JSON and markdown
  equal `fixtures/golden-exclusions/report.json` and `report.md`, compared with
  `toMatchFileSnapshot` as `packages/core/test/golden.test.ts` compares `fixtures/golden/`
  - verify: unit
- **AC-18** Given `.pharn/ci.yml` with one `coverage.exclude` pattern and a CLI run with
  `--exclude` given twice, once repeating the config's pattern and once naming another When
  `pharn-ci check --format json` runs Then the printed report's `excludedFiles` lists, once each,
  the changed files matching any of the patterns, its coverage counts leave them out, and the exit
  code follows the recomputed verdict; and `pharn-ci --help` prints `--exclude <glob>`
  - verify: integration
- **AC-19** Given a CLI run with an `--exclude` pattern that AC-2 rejects, and a run whose config
  holds such a pattern When `pharn-ci check` runs Then it exits 2 and its stderr contains that
  pattern
  - verify: integration
- **AC-20** Given `.pharn/ci.yml` with one `coverage.exclude` pattern and the Action's `exclude`
  input holding three other patterns separated by a comma and a newline, with blank entries and
  surrounding spaces When the Action runs Then the written `report.json` has `excludedFiles` listing
  the changed files matching any of the four patterns, blank entries are ignored, and the
  `diff-coverage` output equals the report's recomputed percent
  - verify: integration
- **AC-21** Given the Action's `exclude` input holding a pattern that AC-2 rejects When the Action
  runs Then the step fails with a message containing that pattern
  - verify: integration

## Constraints

- `packages/core/src` stays pure (AGENTS.md rule 1): no I/O, no `process`, `require`, `fetch` or
  `globalThis`, and it passes `packages/core/test/purity.test.ts`. Pattern matching and validation
  live in core; the CLI and the Action only gather the patterns.
- `schema/report.v1.json` gains only the optional `diffCoverage.excludedFiles` (an array of
  non-empty strings, documented as sorted repo-relative paths); nothing is removed, renamed or
  retyped, and `packages/core/src/report.ts` is updated to match (AGENTS.md rule 2).
- Every core change ships with fixture-based tests, and reports produced in tests are validated with
  `expectValidReport` (AGENTS.md rule 3).
- No existing test is weakened, skipped or deleted (AGENTS.md rule 4). In particular the config test
  that rejects `coverage:` / `  - file: x` with "lists are not supported" and the
  `fixtures/golden/` tests pass unchanged, and `fixtures/golden/report.json` and `report.md` do not
  change.
- The glob matcher and the config list reader are hand-written; no dependency is added (AGENTS.md
  rule 6). No regular expression that can backtrack runs over a path or a pattern, and matching is
  linear in path length for a given pattern.
- `packages/action/dist` is rebuilt with `pnpm build` and current, since core is bundled into the
  Action (AGENTS.md rule 7).
- `action.yml` declares the `exclude` input, not required, with a description naming its separators
  and that it adds to `coverage.exclude`.
- `CHANGELOG.md` gains lines under **Unreleased** for the exclusion sources and the
  `excludedFiles` report field.
- `docs/THREAT-MODEL.md` covers the new parsing of untrusted input (the config list and the glob
  matcher, citing their hostile-input tests) and states that exclusions come from the PR, that a PR
  can exclude its own files, and that the gate is as honest as the config the PR carries, as with
  the coverage file.
- `README.md` documents the `exclude` Action input in the inputs table, the `--exclude <glob>` CLI
  flag, `coverage.exclude` in the config example, that the three sources merge rather than
  override, the glob subset (including that a pattern starting with `*` must be quoted in YAML), and
  suggests protecting `.pharn/ci.yml` with CODEOWNERS.
- `docs/LIMITS.md` replaces "There is no exclude list yet" with what exclusions do and do not do,
  and documents the glob subset and what it does not support.
- The product docs are `README.md`, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`; the root-level
  `LIMITS.md`, `THREAT-MODEL.md` and other PHARN tooling files are not touched.
- Code, test and doc style follow the existing files; `pnpm lint` and `pnpm test` pass.

## Data

- An exclusion pattern: a repo-relative glob string from one of three sources (the config file's
  `coverage.exclude`, the CLI's `--exclude` flags, the Action's `exclude` input); the patterns in
  effect are the union of all three.
- A changed file: a path from the unified diff (the new path for a rename) with its added lines. A
  changed file is excluded when any pattern matches its path; a deleted file is never measured or
  listed.
- The excluded files: the changed, non-deleted files that a pattern matches, reported in
  `diffCoverage.excludedFiles` and in the rendered summary; they are removed from every diff
  coverage count and from the files table.
- The agent setup inventory: built from the tracked files, independent of exclusions.

## Assumptions

- Patterns are anchored at the repo root and match the whole path: `*.ts` matches only root-level
  files, and `generated` does not match `generated/a.ts` (write `generated/**`). This is glob, not
  gitignore, semantics.
- `**` matches zero or more whole segments only when it is a complete path segment, so `src/**`
  also matches a file named `src`; elsewhere (`a**b`) it behaves like `*`.
- `*` and `?` match any characters except `/`, including a leading `.`; there is no dotfile special
  case, and matching is case-sensitive.
- `?` matches exactly one Unicode code point, so a character outside the Basic Multilingual Plane
  counts as one.
- Paths are matched exactly as the diff reports them, without normalization: `/` is the only
  separator, and a backslash, `.` or `..` is an ordinary character or segment. Git does not
  produce `..` segments or leading `./`, so this only matters for hostile input.
- Patterns are trimmed and a leading `./` (repeated) is removed. A pattern is rejected, with a
  `ConfigError` naming it, when it is then empty, starts with `/` or `!`, ends with `/`, contains
  `//`, a `..` segment, a backslash, or any of `{`, `}`, `[`, `]`. Rejecting beats treating them
  literally, because a literal match would silently exclude nothing.
- Validation is the same for every source and is applied by `check()` too, so no caller can bypass
  it. In the CLI a rejected pattern is a usage error (exit 2); in the Action it fails the step.
- In the Action input, entries are split on commas and newlines, trimmed, and blank entries are
  ignored; in the config and on the CLI an empty pattern is an error.
- The union removes duplicate patterns; source order never changes the result, since a file is
  excluded when any pattern matches and `excludedFiles` is sorted.
- `--exclude` patterns are repo-relative like the config's, not relative to the directory the CLI
  runs in.
- `excludedFiles` is present only when at least one changed file was excluded, so a report without
  exclusions is byte-identical to today's. It lists matching changed files whether or not the
  coverage report knows them.
- Exclusions apply to changed files only; an empty coverage report is still `COVERAGE_FILE_EMPTY`,
  whatever the patterns.
- When every changed file is excluded, the existing `NO_COVERABLE_CHANGES` pass applies; no new
  message code is added, and the docs name this as the way a PR can exclude its own files.
- The config YAML subset accepts a block list only as the value of `coverage.exclude`, with `- `
  items indented deeper than the key or at its column; items follow the existing scalar rules, so a
  pattern starting with `*` must be quoted, as in real YAML. Flow lists stay unsupported. A list
  anywhere else keeps today's errors.
- The rendered summary uses `<details><summary>Excluded: N files</summary>` with a blank line before
  the list so GitHub renders it, "file" in the singular for one, and paths escaped the way the files
  table escapes them.
- `fixtures/golden-exclusions/report.json` and `report.md` are produced the repo's documented way,
  `pnpm test -u` run on the golden test file only, and reviewed against the expected rendering
  before they are committed. Fixture names are chosen so no excluded path is a substring of a kept
  path, and AC tests match rendered output on distinctive substrings, so their assertions can all
  hold together.
- The project's test runner is vitest (`pnpm test`, `vitest run`), with per-test results configured
  for PHARN as `vitest-json`; integration-level criteria run in the same suite through the CLI and
  Action test harnesses.
- This run opens no pull request.
