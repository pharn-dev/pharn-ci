---
spec_id: cobertura-parser
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci measures diff coverage from an lcov report only. Many projects, in Python (coverage.py,
pytest-cov), Java (JaCoCo, through its Cobertura-converted form) and .NET (coverlet), produce Cobertura
XML instead, and today pharn-ci cannot read it: the core's Cobertura parser is a stub that throws. The
user wants pharn-ci core to read a Cobertura XML report into the same per-file, per-line hit map the lcov
parser produces, reachable through the core's single coverage entry point when the format is
`cobertura`, so those projects can be measured. This is run 1 of 5 of "Finish Phase 0 of pharn-ci" and
delivers the parser alone; the coverage report is untrusted input, so it must be read safely.

## Scope

**In scope:**

- A Cobertura XML parser in pharn-ci core that returns the same shape as the lcov parser (repo-relative
  path to line number to hit count) and is reached through `parseCoverage()` with format `cobertura`.
- Reading only `<source>` text under `<sources>`, `<class filename="...">`, and `<line number="..."
  hits="...">` inside that class; everything else is ignored.
- Tolerating XML surface variation: attribute order, single or double quotes, self-closing and
  open/close tags, comments, CDATA, a DOCTYPE line, a byte-order mark, CRLF line endings.
- Resolving class file paths to repo-relative paths using the repo root and the `<source>` prefixes.
- Merging the same file and line reported in several `<class>` or `<package>` blocks by maximum hits.
- An empty, garbage or line-less Cobertura report yielding an empty map, so `check()` reports
  `COVERAGE_FILE_EMPTY` exactly as it does for lcov.
- Fixtures in `fixtures/cobertura/` (coverage.py, pytest-cov, JaCoCo converted, coverlet, and the edge
  cases named in the criteria) and fixture-based tests, including a linear-time test on hostile input.
- Replacing the existing test that asserts the Cobertura stub throws, since it becomes wrong.
- The documentation and release bookkeeping AGENTS.md requires for this change (Constraints).

**Out of scope (non-goals):**

- Coverage format auto-detection, an `auto` default format, the `COVERAGE_FORMAT_UNSUPPORTED` message
  code, a `diffCoverage.format` report field (all run 2).
- Any CLI, Action or config plumbing change, including making the Action accept `cobertura` (run 2).
- A log line naming the format, and a golden end-to-end test for Cobertura (run 2).
- Any change to `schema/report.v1.json` or the Report v1 types.
- Reading `<method>` blocks, branch attributes, `condition-coverage`, or any rate or summary attribute.
- Input size limits for coverage files.
- Any refactor of the lcov parser or of code this change does not need to touch.

## Acceptance Criteria

- **AC-1** Given the coverage.py fixture whose `<source>` is an absolute path under the repo root and
  whose class filenames are relative to it When it is parsed with format `cobertura` and that repo root
  Then the returned map equals the fixture's expected repo-relative paths and line hits
  - verify: unit
- **AC-2** Given the pytest-cov fixture When it is parsed with format `cobertura` and its repo root Then
  the returned map equals the fixture's expected repo-relative paths and line hits
  - verify: unit
- **AC-3** Given the JaCoCo Cobertura-converted fixture, in which one source file appears in several
  `<class>` blocks (outer and inner classes) with differing hits for the same line When it is parsed
  with format `cobertura` and its repo root Then the returned map holds that file once, each line
  carrying the maximum hits reported for it across the blocks
  - verify: unit
- **AC-4** Given the coverlet (.NET) fixture When it is parsed with format `cobertura` and its repo root
  Then the returned map equals the fixture's expected repo-relative forward-slash paths and line hits
  - verify: unit
- **AC-5** Given one Cobertura document written in several surface forms (attributes in different
  orders, single and double quotes, self-closing and open/close `<line>` tags, a leading BOM, CRLF line
  endings, a DOCTYPE line, an XML declaration, and comments and CDATA sections that themselves contain
  `<class>` and `<line>` markup) When each form is parsed Then every form returns the same map, and no
  line from inside a comment or CDATA section appears in it
  - verify: unit
- **AC-6** Given a class whose filename attribute contains the predefined XML entity `&amp;` When it is
  parsed Then the returned map's key for that class contains a literal `&`
  - verify: unit
- **AC-7** Given a class with a `<line>` that has no `hits` attribute, a `<line>` whose `number` is
  non-numeric, and a `<line>` whose `hits` is non-numeric When it is parsed Then the line without `hits`
  appears with 0 hits and the two non-numeric lines are absent from the returned map
  - verify: unit
- **AC-8** Given a class whose `<methods>` block contains a `<line>` with a number that the class's own
  `<lines>` block does not list, and a class-level `<line>` carrying `branch` and `condition-coverage`
  attributes When it is parsed Then the method-only line number is absent from the returned map and the
  branch line appears with its `hits` value
  - verify: unit
- **AC-9** Given a class whose filename is an absolute path under the repo root When it is parsed with
  that repo root Then the returned key is the repo-relative path; and given a class whose filename is an
  absolute path outside the repo root Then the returned key is that absolute path, normalized
  - verify: unit
- **AC-10** Given a report with several `<source>` entries, where the first source joined with a class
  filename lies outside the repo root and a later one lies under it When it is parsed with that repo root
  Then the returned key is the repo-relative path built from the first source whose join lies under the
  root
  - verify: unit
- **AC-11** Given a report with no `<sources>` element, and a report whose every source join lies outside
  the repo root When each is parsed Then each returned key is the class filename as written, with
  backslashes turned to forward slashes and `./` segments resolved
  - verify: unit
- **AC-12** Given a source join or a filename containing `..` segments that would climb above the repo
  root When it is parsed with that repo root Then that join is not chosen as a repo-relative key, and no
  returned key begins with a `..` segment produced by a source join
  - verify: unit
- **AC-13** Given an empty text, a non-XML garbage text, a Cobertura document whose classes contain no
  `<line>` records, and a document in which one class has valid lines and another has only invalid ones
  When each is parsed Then the first three return an empty map, and the fourth returns a map holding only
  the class with valid lines
  - verify: unit
- **AC-14** Given the empty and the line-less Cobertura fixtures passed to `check()` with format
  `cobertura` and a threshold When the check runs Then the returned report is valid against
  `schema/report.v1.json`, has `diffCoverage` null, and carries exactly one `COVERAGE_FILE_EMPTY` message
  - verify: integration
- **AC-15** Given any Cobertura fixture When it is parsed through `parseCoverage(text, "cobertura")` Then
  the returned map equals the one `parseCobertura` returns for the same text and options
  - verify: unit
- **AC-16** Given hostile inputs of several megabytes (an unterminated comment, an unterminated CDATA
  section, an unterminated quoted attribute, a long run of `<` characters, and many thousands of nested
  open tags around a valid class) When each is parsed Then it returns its expected map without throwing,
  within 1000 ms
  - verify: unit

## Constraints

- `packages/core/src` stays pure (AGENTS.md rule 1): no I/O, no `process`, `require`, `fetch` or
  `globalThis` use, and the source text, comments included, passes `packages/core/test/purity.test.ts`.
- The parser is hand-written, non-recursive and linear-time over the input; no XML library and no
  dependency is added (AGENTS.md rule 6), and no regular expression that can backtrack runs over the
  untrusted text.
- `schema/report.v1.json` and `packages/core/src/report.ts` are unchanged (AGENTS.md rule 2).
- Every core change ships with fixture-based tests; reports produced in tests are validated with
  `expectValidReport` (AGENTS.md rule 3). No existing test is weakened, skipped or deleted except the
  stub test "cobertura is a stub until M3", which asserts behaviour this change removes and is replaced
  by real-behaviour tests; the reason is recorded where the change is described (AGENTS.md rule 4).
- Malformed Cobertura content is skipped, never thrown, as for lcov.
- `packages/action/dist` is rebuilt with `pnpm build` and current, since core is bundled into the Action
  (AGENTS.md rule 7); CI fails on a stale dist.
- `CHANGELOG.md` gains a line under **Unreleased** for Cobertura parsing in core.
- `docs/THREAT-MODEL.md` rows A1 (parsing untrusted input) and A2 (path handling) cover the Cobertura
  parser and its `<source>`-based path resolution, citing its tests, in the same change.
- `docs/LIMITS.md` stops saying the CLI exits with an error for `cobertura`, states what this run
  delivers (the CLI reads `coverage.format: cobertura` from config; the Action still rejects it), and
  documents the monorepo path caveat for Cobertura as it does for lcov.
- The product docs are `docs/LIMITS.md` and `docs/THREAT-MODEL.md`; PHARN's own root-level documents
  and tooling are not touched.
- Code, test and doc style follow the existing files; `pnpm lint` and `pnpm test` pass.

## Data

- A Cobertura report: optional `<sources>` holding ordered `<source>` path prefixes, then `<packages>`
  holding `<package>` blocks, each holding `<class>` blocks; a class names one source file by its
  `filename` and lists `<line>` records, each a line number and a hit count.
- A coverage map: repo-relative path to line number to hit count; a line present is coverable, and
  covered when its hit count is above 0. It is the same shape the lcov parser returns.
- The repo root: the absolute path the caller passes, against which absolute and source-joined paths
  are judged "under the repo root".

## Assumptions

- A `<line>` is valid on the same rule as an lcov `DA` record: `number` a positive integer, `hits` a
  finite number of 0 or more; a `number` of 0, a negative or fractional `number`, or a negative `hits`
  is skipped like a non-numeric one.
- `<source>` text is trimmed of surrounding whitespace before use, and an empty `<source>` is skipped.
- An absolute class filename is never joined to a `<source>`: under the root it is relativized,
  otherwise it stays absolute (normalized) and matches no diff path, as lcov's absolute paths do today.
- A relative source joined with a relative filename counts as "under the repo root" when its normalized
  form does not begin with `..`; an absolute join counts when it lies under the repo root on a
  whole-segment match, using the existing path normalization.
- When no repo root is passed, only a relative join can count as under the root; otherwise the
  filename is used as written (normalized).
- Attribute values and `<source>` text decode the five predefined XML entities and numeric character
  references; other markup (namespaces, processing instructions) is skipped.
- A `<line>` outside any `<class>`, or inside a `<method>` block, contributes nothing.
- The realistic fixtures are small hand-written files that follow each tool's published output shape;
  they are not generated by running the tools, which this repo does not install.
- The Cobertura merge rule (maximum hits) intentionally differs from lcov's (summed hits), as the
  intent states.
- The project's test runner is vitest (`pnpm test`, `vitest run`), with per-test results configured for
  PHARN as `vitest-json`; integration-level criteria run in the same suite as unit ones.
- This run opens no pull request; the replacement of the stub test is explained in the run's record and
  commit message, and carried into the PR description when one is opened.
