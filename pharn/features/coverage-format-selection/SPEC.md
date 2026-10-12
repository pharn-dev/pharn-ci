---
spec_id: coverage-format-selection
state: Approved
spec_content_hash: "734e074e751d0e556c0e297ef80316589d1943d7b96d66bf0ef8bdd12b0d75a1"
approved_by: model
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci core can now read Cobertura XML, but users cannot fully reach it: the Action rejects every
coverage format except lcov, the CLI has no flag to choose a format, and every entry point defaults
to lcov, so a Cobertura report read as lcov comes out as an empty report. The user wants the coverage
format to be selectable everywhere (Action input, CLI flag, config key) as `lcov`, `cobertura` or
`auto`, with `auto` as the new default. Under `auto`, pharn-ci looks at the start of the report and
picks the format itself. A report it cannot recognize, including the look-alike Clover and JaCoCo
native XML formats, gets its own clear message instead of being misread. The report also records
which format was read, and both the CLI and the Action log one line saying which format was used and
how it was chosen. This is run 2 of 5 of "Finish Phase 0 of pharn-ci". The coverage file is untrusted
input, so detection must be safe on hostile text.

## Scope

**In scope:**

- Accepting `lcov`, `cobertura` and `auto` in the Action input `coverage-format`, in a new CLI flag
  `--coverage-format`, and in the config key `coverage.format`, with `auto` as the default everywhere.
  An explicit `lcov` or `cobertura` skips detection. The existing CLI output flag `--format md|json`
  is unchanged.
- Pure auto-detection in core over the first 1 KiB of the report (after an optional byte-order mark).
  It skips whitespace, an XML declaration, comments and a DOCTYPE, then picks: a `<coverage` first
  element means Cobertura, unless it is Clover (first child element `<project>`, or a `clover`
  attribute on the root); text starting with `TN:` or `SF:` means lcov; anything else is unknown.
- A new message code `COVERAGE_FORMAT_UNSUPPORTED` for an unknown or unsupported format. It is
  handled like `COVERAGE_FILE_EMPTY`: an error with a threshold, a warning without, and no diff
  coverage.
- An optional `diffCoverage.format` field (`lcov` or `cobertura`) in Report v1, set when a coverage
  file was parsed.
- One log line naming the format and how it was chosen: the CLI writes it to stderr, the Action
  through its info log.
- Fixtures `fixtures/cobertura/clover.xml` and `fixtures/cobertura/jacoco-native.xml`, and a golden
  end-to-end fixture set in `fixtures/golden-cobertura/`.
- Replacing the Action test that asserts `cobertura` is rejected, since that behaviour is removed on
  purpose.
- The schema, type, documentation, `action.yml`, changelog and rebuilt-dist changes AGENTS.md
  requires for this change (Constraints).

**Out of scope (non-goals):**

- Any change to the agent setup inventory, or coverage exclusions (other runs).
- Parsing Clover, JaCoCo native XML or any format other than lcov and Cobertura.
- Changing the Cobertura or lcov parsers' behaviour on text they are given.
- Detecting the format from the file name or extension.
- Changing the CLI `--format md|json` flag, the report's `tool` field, or the markdown rendering of
  the report.
- Input size limits for coverage files.
- Any refactor of code this change does not need to touch.

## Acceptance Criteria

- **AC-1** Given the text of every fixture in `fixtures/cobertura/` except `empty.xml`,
  `garbage.xml`, `clover.xml` and `jacoco-native.xml` When core's auto-detection runs on it Then it
  returns `cobertura` for each
  - verify: unit
- **AC-2** Given the text of every fixture in `fixtures/lcov/` except `empty.info` and
  `garbage.info`, and the golden `coverage.info` When core's auto-detection runs on it Then it
  returns `lcov` for each
  - verify: unit
- **AC-3** Given a Cobertura document and an lcov document, each also written with a leading
  byte-order mark, with leading whitespace and CRLF line endings, and the Cobertura one also with an
  XML declaration, comments containing `<project>` markup and a DOCTYPE before the root When
  auto-detection runs on each form Then every Cobertura form returns `cobertura` and every lcov form
  returns `lcov`
  - verify: unit
- **AC-4** Given the Clover fixture, a `<coverage>` root whose first child element is `<project>`
  with no `clover` attribute, and a `<coverage>` root carrying a `clover` attribute whose first child
  is not `<project>` When auto-detection runs on each Then none of them returns `cobertura` or `lcov`
  - verify: unit
- **AC-5** Given the JaCoCo native fixture (a DOCTYPE then a `<report>` root), the garbage fixtures
  `fixtures/cobertura/garbage.xml` and `fixtures/lcov/garbage.info`, a document whose first element
  is `<coverageReport>`, and a Cobertura document whose `<coverage` root starts after the first
  1 KiB of text When auto-detection runs on each Then none of them returns `cobertura` or `lcov`
  - verify: unit
- **AC-6** Given hostile texts of several megabytes (only whitespace, an unterminated comment, an
  unterminated DOCTYPE, an unterminated XML declaration, and a long run of `<` characters) When
  auto-detection runs on each Then it returns without throwing, within 1000 ms, and returns neither
  `cobertura` nor `lcov`
  - verify: unit
- **AC-7** Given the Clover fixture and the JaCoCo native fixture passed to `check()` with format
  `auto`, once with threshold 80 and once with no threshold When the check runs Then each report is
  valid against `schema/report.v1.json`, has `diffCoverage` null and carries exactly one coverage
  message, `COVERAGE_FORMAT_UNSUPPORTED`, at level `error` with verdict `fail` when the threshold is
  set, and at level `warn` with verdict `warn` when it is not
  - verify: integration
- **AC-8** Given an empty text, a text of only whitespace and a byte-order mark, and the self-closing
  document `<coverage/>`, each passed to `check()` with format `auto` and threshold 80 When the check
  runs Then each report is schema-valid, has `diffCoverage` null and carries `COVERAGE_FILE_EMPTY`,
  not `COVERAGE_FORMAT_UNSUPPORTED`
  - verify: integration
- **AC-9** Given the golden lcov inputs passed to `check()` with format `auto` and with format `lcov`
  When the check runs Then both reports are equal and schema-valid, and their `diffCoverage.format`
  is `lcov`
  - verify: integration
- **AC-10** Given a Cobertura fixture passed to `check()` with format `auto` and with format
  `cobertura` When the check runs Then both reports are equal and schema-valid, and their
  `diffCoverage.format` is `cobertura`
  - verify: integration
- **AC-11** Given the Clover fixture passed to `check()` with explicit format `cobertura`, and a
  Cobertura fixture passed with explicit format `lcov` When the check runs Then neither report
  carries `COVERAGE_FORMAT_UNSUPPORTED`, because an explicit format skips detection
  - verify: integration
- **AC-12** Given a report whose `diffCoverage.format` is `lcov`, one whose `diffCoverage.format` is
  `cobertura`, one with no `diffCoverage.format`, one whose `diffCoverage.format` is `clover`, and
  one with a message of code `COVERAGE_FORMAT_UNSUPPORTED` When each is validated against
  `schema/report.v1.json` Then the `clover` report is rejected and every other report is accepted
  - verify: unit
- **AC-13** Given `fixtures/golden-cobertura/` (a diff, a Cobertura coverage file and a files list)
  passed to `check()` with format `auto`, its repo root and a threshold When the check runs and the
  report is rendered Then the report is schema-valid, its `diffCoverage.format` is `cobertura`, its
  JSON equals `fixtures/golden-cobertura/report.json` and its markdown equals
  `fixtures/golden-cobertura/report.md`
  - verify: integration
- **AC-14** Given the existing golden lcov inputs in `fixtures/golden/` When the golden test runs
  Then `fixtures/golden/report.md` is unchanged and `fixtures/golden/report.json` differs from its
  previous content only by `"format": "lcov"` inside `diffCoverage`
  - verify: integration
- **AC-15** Given config texts with `coverage.format` set to `lcov`, `cobertura` and `auto`, and one
  with `coverage.format: clover` When each is parsed as config Then the first three return that
  format, and the fourth is rejected with an error naming `lcov`, `cobertura` and `auto`
  - verify: unit
- **AC-16** Given a repo whose coverage file is the golden Cobertura file and no format in config
  When `pharn-ci check --coverage <file> --format json` runs Then the report it prints has
  `diffCoverage.format`
  `cobertura`, and stderr carries exactly one line `coverage: cobertura (auto-detected)`
  - verify: integration
- **AC-17** Given an lcov coverage file When `pharn-ci check` runs with `--coverage-format lcov`,
  and again with no flag but `coverage.format: lcov` in config Then each run's stderr carries exactly
  one line `coverage: lcov (configured)`; and given `--coverage-format cobertura` with
  `coverage.format: lcov` in config Then the stderr line is `coverage: cobertura (configured)`
  - verify: integration
- **AC-18** Given `pharn-ci check --format json --coverage-format auto` on an lcov file When it runs
  Then stdout is exactly the JSON report and the format line appears on stderr only; and given
  `--coverage-format clover` Then the CLI exits with code 2 and stderr names the invalid value
  - verify: integration
- **AC-19** Given the Action with input `coverage-format` set to `cobertura`, and with no input and no
  config format, each over a Cobertura coverage file When the Action runs Then it does not fail,
  the report written to `report-path` has `diffCoverage.format` `cobertura`, and its info log
  carries exactly one line `coverage: cobertura (configured)` and `coverage: cobertura
  (auto-detected)` respectively
  - verify: integration
- **AC-20** Given the Action with input `coverage-format` set to `clover` When the Action runs Then
  the step fails with a message naming `clover` and the accepted values `lcov`, `cobertura` and
  `auto`; and given the Action with no format set over the Clover fixture and a threshold Then the
  `verdict` output is `fail` and the report carries `COVERAGE_FORMAT_UNSUPPORTED`
  - verify: integration

## Constraints

- `packages/core/src` stays pure (AGENTS.md rule 1): detection does no I/O and uses no `process`,
  `require`, `fetch` or `globalThis`, and `packages/core/test/purity.test.ts` passes.
- Detection reads at most the first 1 KiB of the report after an optional byte-order mark, runs in
  linear time, and runs no regular expression that can backtrack over the untrusted text. No
  dependency is added (AGENTS.md rule 6).
- `schema/report.v1.json` changes only by adding the optional `diffCoverage.format` field (enum
  `lcov`, `cobertura`) and documenting `COVERAGE_FORMAT_UNSUPPORTED` among the known codes; nothing
  is removed, renamed or retyped. `packages/core/src/report.ts` is updated to match (AGENTS.md
  rule 2).
- Every core change ships with fixture-based tests, and reports produced in tests are validated with
  `expectValidReport` (AGENTS.md rule 3).
- No existing test is weakened, skipped or deleted. The Action test row asserting that `cobertura`
  is rejected is replaced by a test of the new behaviour, and the reason is recorded where the change
  is described. Existing tests whose expected reports gain `diffCoverage.format` are updated to the
  new expected value (AGENTS.md rule 4).
- Golden files change only where output intentionally changes: `fixtures/golden/report.json` gains
  only the `format` field, regenerated with `pnpm test -u` on the golden test file and reviewed.
  `fixtures/golden-cobertura/` is compared the way `packages/core/test/golden.test.ts` compares
  `fixtures/golden/` (`toMatchFileSnapshot`).
- `action.yml` describes the `coverage-format` input as accepting `lcov`, `cobertura` and `auto`,
  defaulting to `auto`.
- `packages/action/dist` is rebuilt with `pnpm build` and current (AGENTS.md rule 7).
- `CHANGELOG.md` gains lines under **Unreleased** for the format selection, the `auto` default, the
  Action accepting Cobertura, the new message code and the new report field.
- `docs/THREAT-MODEL.md` covers auto-detection reading untrusted input in the same change, citing its
  tests.
- `README.md` documents the `coverage-format` input with default `auto`, the `--coverage-format` CLI
  flag, `coverage.format` in the config example, the `COVERAGE_FORMAT_UNSUPPORTED` code in the
  message-codes table, and the supported formats (lcov and Cobertura; Clover and JaCoCo native XML
  not supported). The quick start changes only if it is affected.
- `docs/LIMITS.md` §3 states the supported formats and the detection rule including the Clover rule,
  and no longer says the Action rejects `cobertura`.
- The product docs are `README.md`, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`; the root-level
  `LIMITS.md` and `THREAT-MODEL.md` and other PHARN tooling are not touched.
- Code, test and doc style follow the existing files; `pnpm lint` and `pnpm test` pass.

## Data

- A coverage format: `lcov` or `cobertura` (what a file is read as), plus the selection value `auto`
  (pick by detection).
- A format choice: the format used and how it was chosen, either configured (an explicit value from
  the Action input, CLI flag or config key) or auto-detected.
- A detection result: `lcov`, `cobertura`, unknown (including Clover, JaCoCo native XML and garbage),
  or empty (nothing but whitespace and an optional byte-order mark).

## Assumptions

- The report's message level for "warning" is the schema's existing `warn`.
- Precedence follows the existing pattern: the Action input or CLI flag, then `coverage.format` in
  config, then `auto`.
- "Configured" covers every explicit value, whether it came from the Action input, the CLI flag or
  the config key; only `auto` produces "auto-detected".
- When the coverage file is missing, no format line is logged, since no format was read; the report
  is `COVERAGE_FILE_MISSING` as today.
- When auto-detection finds an unknown format, the single log line is `coverage: unknown
  (auto-detected)`; for an empty file under `auto` it is `coverage: empty (auto-detected)`.
- The `COVERAGE_FORMAT_UNSUPPORTED` text names the coverage file when it is known, says its format
  was not recognized, and names the supported formats; the text is not stable API.
- 1 KiB means the first 1024 UTF-16 code units of the decoded text after the byte-order mark; a
  prolog (comments, DOCTYPE) longer than that leaves the format unknown.
- Leading whitespace is skipped before the `TN:` and `SF:` check as well; both prefixes are
  case-sensitive.
- The first element must be named exactly `coverage`, followed by whitespace, `>` or `/`.
- Any processing instruction (`<?...?>`) before the root is skipped like the XML declaration.
- The Clover attribute rule matches an attribute named exactly `clover` on the root element; the
  first child is the first element after the root's start tag, skipping whitespace and comments.
  If no child element appears within the 1 KiB window and the root has no `clover` attribute, the
  report is Cobertura.
- With an explicit `cobertura`, a Clover or JaCoCo native file is given to the Cobertura parser
  unchanged, which finds no Cobertura lines and yields `COVERAGE_FILE_EMPTY`; detection is not run.
- `diffCoverage.format` is set whenever `diffCoverage` is an object, including when no added line
  is coverable; it is absent only when `diffCoverage` is null.
- The CLI help text lists `--coverage-format lcov|cobertura|auto` with default `auto`, and drops the
  "(lcov)" note on `--coverage`.
- The fixtures `clover.xml` and `jacoco-native.xml` are small hand-written files that follow each
  tool's published output shape; they are not generated by running the tools.
- The project's test runner is vitest (`pnpm test`, `vitest run`), with per-test results configured
  for PHARN as `vitest-json`; integration-level criteria run in the same suite as unit ones.
- This run opens no pull request; the replacement of the Action test is explained in the run's
  record and commit message, and carried into the PR description when one is opened.
