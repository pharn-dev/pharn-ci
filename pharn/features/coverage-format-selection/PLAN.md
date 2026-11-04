---
spec_id: coverage-format-selection
spec_content_hash: 734e074e751d0e556c0e297ef80316589d1943d7b96d66bf0ef8bdd12b0d75a1
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/{check,config,report,diffCoverage,index}.ts`,
> `packages/core/src/coverage/{index,types,xml}.ts`, `packages/core/src/render/markdown.ts`,
> `packages/core/test/{golden,helpers,schema,purity,config,cobertura,cobertura-check,ac-setup-summary}.test.ts`
> (and helpers), `packages/cli/src/{main,nodeDeps,index}.ts`, `packages/cli/test/main.test.ts`,
> `packages/action/src/{run,index}.ts`, `packages/action/test/run.test.ts`, `action.yml`, `schema/report.v1.json`,
> `fixtures/golden/*`, the heads of every `fixtures/cobertura/*.xml` and `fixtures/lcov/*.info`, `README.md`,
> `docs/LIMITS.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`, `.pharn/ci.yml`, `vitest.config.ts`, `package.json`,
> the package manifests, and `pharn/features/cobertura-parser/{PLAN,AC-TESTS}.md` for this repo's conventions.

Three layers, each with one job:

1. **Core detection and choice — new `packages/core/src/coverage/detect.ts`** (pure, no I/O, no regex over the
   input). It exports:
   - `detectCoverageFormat(text: string): DetectedCoverageFormat`, where
     `DetectedCoverageFormat = CoverageFormat | "unknown" | "empty"`.
   - `chooseCoverageFormat(text: string, selection: CoverageFormatSelection): CoverageFormatChoice`, where
     `CoverageFormatChoice = { format: DetectedCoverageFormat; how: "configured" | "auto-detected" }`. An explicit
     `lcov` or `cobertura` returns `{ format: selection, how: "configured" }` without running detection; `auto`
     returns `{ format: detectCoverageFormat(text), how: "auto-detected" }`.
   - `coverageChoiceLine(choice: CoverageFormatChoice): string` → exactly `coverage: <format> (<how>)`, e.g.
     `coverage: cobertura (auto-detected)`, `coverage: unknown (auto-detected)`, `coverage: lcov (configured)`.
     The CLI and the Action both print this, so the wording lives in one place.

   **Detection rule** (SPEC Scope and Assumptions), in order:
   1. `start` = 1 if `text.charCodeAt(0) === 0xfeff`, else 0. `window = text.slice(start, start + 1024)` — the only
      part of the text ever read. `text.length` is consulted, nothing else past the window.
   2. Skip whitespace (space, tab, CR, LF — character checks) from the start of the window. If the window is all
      whitespace: return `"empty"` when the window reaches the end of the text (`start + 1024 >= text.length`),
      otherwise `"unknown"` (a whitespace prefix longer than the window; the first 1 KiB rule).
   3. If the window continues with `TN:` or `SF:` (case-sensitive, `startsWith` at that index) → `"lcov"`.
   4. If the next character is not `<` → `"unknown"`.
   5. Otherwise run the existing `scanXml` from `coverage/xml.ts` over `window` (from the first non-space index; it is
      at most 1024 characters, so its cost is bounded whatever the input size) with a small state machine that
      ignores every event after it has decided:
      - **before the root**: a `text` event with non-whitespace content → `unknown`; an `end` event → `unknown`; a
        `start` event is the root: its name must equal `coverage` exactly (the scanner's name stops at whitespace or
        `/`, and the tag at `>`, which gives the SPEC's "followed by whitespace, `>` or `/`"; `coverageReport` is a
        different name) else `unknown`; a root carrying an attribute named exactly `clover` → `unknown`; a
        self-closing root → `cobertura`; otherwise move to "after the root".
      - **after the root**: `text` events are ignored; the first `start` event is the first child: `project` →
        `unknown` (Clover), anything else → `cobertura`; an `end` event (the root closed with no child) → `cobertura`.
      - **scan ended**: still before the root → `unknown` (no root in the window: a long prolog, an unterminated
        comment/DOCTYPE/declaration, a root start tag cut by the window edge, or a run of `<`); after the root →
        `cobertura` (no child in the window and no `clover` attribute — SPEC Assumptions).
      The scanner already skips comments, processing instructions (the XML declaration included), CDATA and `<!`
      declarations (DOCTYPE), and stops at an unterminated one; it is the hardened, linear scanner the Cobertura
      parser uses (`cobertura-hostile.test.ts`), so no second XML reader is written. `xml.ts` itself is not changed.

2. **Core plumbing.**
   - `coverage/types.ts`: add `CoverageFormatSelection = CoverageFormat | "auto"` and
     `COVERAGE_FORMAT_SELECTIONS: readonly CoverageFormatSelection[] = ["lcov", "cobertura", "auto"]`.
     `CoverageFormat` and `COVERAGE_FORMATS` stay as they are (what a file is read as).
   - `config.ts`: `PharnConfig.coverage.format` becomes `CoverageFormatSelection`; the `format` key accepts the
     three selections and otherwise throws `"coverage.format" must be one of: lcov, cobertura, auto` (built from
     `COVERAGE_FORMAT_SELECTIONS`). Add an exported `isCoverageFormatSelection(value: string)`; keep
     `isCoverageFormat` unchanged (public export).
   - `check.ts`: `CheckInput.coverage.format` widens to `CoverageFormatSelection` (still required; existing callers
     that pass `lcov`/`cobertura` compile unchanged). After the existing missing-file and diff-unavailable branches:
     `choice = chooseCoverageFormat(text, format)`; `"empty"` → `missing: coverage-file-empty`; `"unknown"` →
     `missing: coverage-format-unsupported`; otherwise parse with `choice.format`, an empty map stays
     `coverage-file-empty` as today, and a non-empty one builds the report with `coverageFormat: choice.format`.
     So `<coverage/>` detects as `cobertura`, parses empty and is `COVERAGE_FILE_EMPTY` (AC-8), and an explicit
     format never yields `COVERAGE_FORMAT_UNSUPPORTED` (AC-11).
   - `report.ts`: `MessageCode` gains `COVERAGE_FORMAT_UNSUPPORTED`; `ReportDiffCoverage` gains optional
     `format?: CoverageFormat`; `BuildReportInput` gains optional `coverageFormat?: CoverageFormat` and the missing
     reason `{ reason: "coverage-format-unsupported"; coverageFile: string | null }`. The new reason pushes
     `COVERAGE_FORMAT_UNSUPPORTED` at `error` with a threshold and `warn` without (the `COVERAGE_FILE_EMPTY` rule),
     with text `Coverage file <file> is not in a recognized coverage format; pharn-ci reads lcov and Cobertura XML.`
     (`The coverage report …` when the file is unknown). When `diffCoverage` is an object and `coverageFormat` is
     given, `format` is the **first** key of the emitted `diffCoverage` object, so `fixtures/golden/report.json`
     gains exactly one line, `"format": "lcov",`, right after `"diffCoverage": {` (AC-14). `buildReport` called
     without `coverageFormat` (the existing report and markdown tests) emits no `format`, as today.
   - `index.ts`: export `detectCoverageFormat`, `chooseCoverageFormat`, `coverageChoiceLine`, the types
     `DetectedCoverageFormat`, `CoverageFormatChoice`, `CoverageFormatSelection`, `COVERAGE_FORMAT_SELECTIONS` and
     `isCoverageFormatSelection`.
   - `schema/report.v1.json`: `$defs.diffCoverage.properties.format` = `{ "description": …, "enum": ["lcov",
     "cobertura"] }`, not in `required`; `COVERAGE_FORMAT_UNSUPPORTED` appended to the message `code` description's
     known codes. Nothing else changes.
   - The markdown renderer is untouched: it never reads `diffCoverage.format`, and the new message renders through
     the generic message line.

3. **Entry points.** Precedence everywhere: Action input / CLI flag, then `coverage.format` in config, then `auto`.
   - CLI (`packages/cli/src/main.ts`): new string option `coverage-format`. Validate it in `runCheck` before any git
     call, next to the `--format` check: not a selection → `ConfigError` `--coverage-format must be one of: lcov,
     cobertura, auto (got "<value>")` → exit 2 with the value on stderr (AC-18). Selection =
     flag ?? `config.coverage?.format` ?? `"auto"`; drop the old `isCoverageFormat` check and the `"lcov"` default.
     When the coverage file was read (not missing), write `coverageChoiceLine(chooseCoverageFormat(text,
     selection))` + `\n` to `deps.stderr` once, before `check()`; nothing on a missing file (SPEC Assumptions).
     `--format md|json` is unchanged and stdout still carries only the report. HELP: `--coverage <file>` loses
     "(lcov)"; add `--coverage-format <f>  lcov, cobertura or auto. Default: coverage.format, then auto`.
   - Action (`packages/action/src/run.ts`): selection = `coverage-format` input || `config.coverage?.format` ||
     `"auto"`; not a selection → throw `coverage-format "<value>" is not supported (supported: lcov, cobertura,
     auto)` (the existing `run()` catch turns it into `setFailed`, AC-20). When the coverage file was read, call
     `deps.info(coverageChoiceLine(chooseCoverageFormat(text, selection)))` once, before `check()`. Pass the
     selection as `format`.
   - `action.yml`: the `coverage-format` description says it accepts `lcov`, `cobertura` or `auto` (detect from the
     start of the file) and defaults to `coverage.format` in `.pharn/ci.yml`, then `auto`. **No `default:` key** —
     a `default: auto` would make `getInput` always return `auto` and silently override `coverage.format` in the
     config file.

The fixtures are hand-written to each tool's published shape (SPEC Assumptions); their contents are fixed below so the
AC tests (written first) and the build agree on them.

## Applied lessons

- none — `check-lessons-index.mjs --verdict` returned `NO_CANON`: this project has no `memory-bank/lessons-learned.md`
  yet, so there are no lessons to apply.

## Steps

- Add `CoverageFormatSelection` and `COVERAGE_FORMAT_SELECTIONS` to `coverage/types.ts`.
- Write `coverage/detect.ts` as in Approach (imports only `./types.js` and `./xml.js`). Comments in core source must
  not contain `process`, `require`, `fetch` or `globalThis` followed by `.` or `(` — the purity test greps comments.
- Update `report.ts` (code, optional field, missing reason, `format` first in `diffCoverage`), then `check.ts`, then
  `config.ts`, then `index.ts`.
- Update `schema/report.v1.json` (the optional `format` enum and the known-codes description only).
- Update `packages/cli/src/main.ts` and `packages/action/src/run.ts` as in Approach; update `action.yml`.
- Update the existing tests whose expectations change on purpose (AGENTS.md rule 4 — new expected values, nothing
  weakened):
  - `packages/cli/test/main.test.ts`: "prints JSON to stdout and exits 1 when below the threshold" expects
    `deps.err` to be `coverage: lcov (auto-detected)\n` instead of `""`; "produces the expected report" (end to end)
    expects `format: "lcov"` as the first key of `diffCoverage`. Nothing else changes.
  - `packages/action/test/run.test.ts`: the `it.each` row `[{ "coverage-format": "cobertura" }, 'coverage-format
    "cobertura" is not supported yet']` is replaced by `[{ "coverage-format": "clover" }, 'coverage-format "clover"
    is not supported (supported: lcov, cobertura, auto)']`. Reason (to carry into the run record, commit message
    and PR description): the row asserted that the Action rejects `cobertura`, which this change removes on purpose;
    the row now tests the new rejection of an unknown value. Cobertura acceptance itself is covered by AC-19.
- Write the fixtures below.
- Regenerate `fixtures/golden/report.json` with `pnpm vitest run -u packages/core/test/golden.test.ts` and check that
  `git diff fixtures/golden/` shows exactly one added line, `    "format": "lcov",`, and no change to `report.md`.
- Generate `fixtures/golden-cobertura/report.json` and `report.md` by running the AC-13 test file with `-u`
  (`pnpm vitest run -u packages/core/test/ac-format-golden.test.ts`; this writes only those two snapshot files, never
  the test file). Check that `report.json` equals `fixtures/golden/report.json` except `"format": "cobertura"`, and
  that `report.md` equals `fixtures/golden/report.md` (the renderer does not show the format).
- Update `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and `CHANGELOG.md` (details under Files). Cite AC
  tests by their exact `file › title`, read from the test files `/pharn-test` wrote — never invented.
- Regenerate the committed Action bundle with `pnpm --filter @pharn-ci/action build` (writes only
  `packages/action/dist/index.js`; core is bundled from source). Do not run the root `pnpm build`: it also writes
  the gitignored `packages/core/dist/` and `packages/cli/dist/`, outside this plan's scope. The CI dist check
  compares only `packages/action/dist`.
- Run `pnpm lint` and `pnpm test`; format only the TypeScript and JSON files this plan names, one by one
  (`pnpm biome check --write <file>`).

### Fixture contents (the contract between the AC tests and the build)

All LF, no BOM (BOM, CRLF and whitespace forms are built inside the tests).

- `fixtures/cobertura/clover.xml` — Clover XML shape: `<?xml version="1.0" encoding="UTF-8"?>`, then
  `<coverage generated="1728750000000" clover="4.5.2">`, first child `<project timestamp="1728750000000"
  name="demo">` holding a `<metrics …/>`, a `<package name="src">` with `<file name="math.ts"
  path="/home/runner/work/demo/demo/src/math.ts">`, its `<metrics …/>`, a `<class name="Math">` with `<metrics
  …/>`, and `<line num="1" count="4" type="stmt"/>`-style records. No element anywhere carries a `filename`
  attribute and no `<line>` carries `number`/`hits`, so the Cobertura parser returns an empty map for it (AC-11's
  explicit-`cobertura` case yields `COVERAGE_FILE_EMPTY`).
- `fixtures/cobertura/jacoco-native.xml` — JaCoCo native shape: `<?xml version="1.0" encoding="UTF-8"
  standalone="yes"?>`, `<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd">`, root `<report
  name="demo">` with `<sessioninfo id="host-1" start="1728750000000" dump="1728750001000"/>`, a `<package
  name="com/example">` with `<class name="com/example/Calculator" sourcefilename="Calculator.java">` holding
  `<method …><counter …/></method>`, a `<sourcefile name="Calculator.java">` with `<line nr="3" mi="0" ci="4" mb="0"
  cb="0"/>`-style records and `<counter type="LINE" …/>` totals. No `filename` attribute anywhere, so the Cobertura
  parser returns an empty map for it too.
- `fixtures/golden-cobertura/pr.diff` — byte copy of `fixtures/golden/pr.diff`.
- `fixtures/golden-cobertura/files.txt` — byte copy of `fixtures/golden/files.txt`.
- `fixtures/golden-cobertura/coverage.xml` — the Cobertura translation of `fixtures/golden/coverage.info`:
  `<?xml version="1.0" ?>`, `<coverage version="7.6.1" timestamp="1728750000000" line-rate="0.8" …>`,
  `<sources><source>/home/runner/work/demo/demo</source></sources>`, one package `src` with classes (filename:
  lines as `number:hits`) `src/math.ts`: 1:4, 3:4, 4:1, 5:1, 10:0, 11:4; `src/new.ts`: 4:1, 5:0;
  `src/utils/new-name.ts`: 1:2, 2:2; `src/legacy.ts`: 1:1. With repo root `/home/runner/work/demo/demo` it parses to
  the same coverage map as the lcov golden, so with the same diff, files and threshold 80 the report equals the lcov
  golden report except `diffCoverage.format` (`cobertura`), verdict `fail`, percent 71.43.
- `fixtures/golden-cobertura/report.json`, `fixtures/golden-cobertura/report.md` — generated by the AC-13 test
  (`toMatchFileSnapshot`), never hand-written; reviewed as in Steps.

## Files

- `packages/core/src/coverage/detect.ts` — new: `detectCoverageFormat`, `chooseCoverageFormat`, `coverageChoiceLine` over the first 1 KiB, reusing `scanXml`
- `packages/core/src/coverage/types.ts` — add `CoverageFormatSelection` and `COVERAGE_FORMAT_SELECTIONS`
- `packages/core/src/config.ts` — `coverage.format` accepts `lcov`, `cobertura`, `auto`; add `isCoverageFormatSelection`; error names all three
- `packages/core/src/check.ts` — format selection, auto-detection, `coverage-format-unsupported`, passes `coverageFormat` to the report
- `packages/core/src/report.ts` — `COVERAGE_FORMAT_UNSUPPORTED` code and message, optional `diffCoverage.format` (first key), new missing reason
- `packages/core/src/index.ts` — export the new functions, types and constants
- `schema/report.v1.json` — optional `diffCoverage.format` enum `lcov`/`cobertura`; document `COVERAGE_FORMAT_UNSUPPORTED`
- `packages/cli/src/main.ts` — `--coverage-format` flag, `auto` default, one stderr format line, help text
- `packages/action/src/run.ts` — accept `lcov`/`cobertura`/`auto`, `auto` default, one info format line, new rejection message
- `action.yml` — `coverage-format` description: `lcov`, `cobertura` or `auto`, default `auto` (no `default:` key)
- `packages/cli/test/main.test.ts` — two expectations updated to the new output (stderr format line; `format` in the end-to-end `diffCoverage`)
- `packages/action/test/run.test.ts` — replace the `cobertura`-is-rejected row with a `clover`-is-rejected row
- `fixtures/cobertura/clover.xml` — new: Clover look-alike fixture
- `fixtures/cobertura/jacoco-native.xml` — new: JaCoCo native XML fixture
- `fixtures/golden-cobertura/pr.diff` — new: copy of the golden diff
- `fixtures/golden-cobertura/files.txt` — new: copy of the golden files list
- `fixtures/golden-cobertura/coverage.xml` — new: Cobertura translation of the golden lcov file
- `fixtures/golden-cobertura/report.json` — new: generated golden report (AC-13 snapshot)
- `fixtures/golden-cobertura/report.md` — new: generated golden markdown (AC-13 snapshot)
- `fixtures/golden/report.json` — regenerated: gains only `"format": "lcov"` in `diffCoverage`
- `README.md` — "What pharn-ci is" names lcov and Cobertura XML (Clover, JaCoCo native XML not supported); Action reference `coverage-format` row (`lcov`, `cobertura`, `auto`; default `auto`); CLI usage block and a `--coverage-format` bullet; config example `format: auto` with a comment naming the three values; `COVERAGE_FORMAT_UNSUPPORTED` row in the codes table; the architecture diagram's "lcov file" label and the "lcov-producing test run" sentence widened to Cobertura; roadmap line "Cobertura (and more coverage formats)" becomes "More coverage formats (Clover, JaCoCo native XML)"; quick start unchanged
- `docs/LIMITS.md` — §3 only: the first bullet becomes lcov and Cobertura everywhere, selectable as `lcov`/`cobertura`/`auto` (default `auto`); a new bullet with the detection rule (first 1 KiB after a BOM, skipped prolog, `<coverage` root, `TN:`/`SF:`, the Clover rule, a root start tag that does not end within 1 KiB is unknown) and what unknown means (`COVERAGE_FORMAT_UNSUPPORTED`; explicit `cobertura` on Clover or JaCoCo native is `COVERAGE_FILE_EMPTY`); the "Action still rejects cobertura" text removed
- `docs/THREAT-MODEL.md` — row A1: auto-detection reads only the first 1 KiB of the untrusted file, reuses the regex-free scanner, never throws and is linear on hostile text, citing the AC-6 and AC-4/AC-5 tests; row E1: an unrecognized format is `COVERAGE_FORMAT_UNSUPPORTED`, error with a threshold, citing the AC-7 test; statuses unchanged
- `CHANGELOG.md` — under Unreleased: rewrite the Cobertura line (the Action now accepts it too); add lines for format selection (`coverage-format` input, `--coverage-format`, `coverage.format`), the `auto` default, `COVERAGE_FORMAT_UNSUPPORTED`, and the optional `diffCoverage.format` report field
- `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build`

### Explicitly not touched

- `packages/core/src/coverage/xml.ts` — reused as is by detection
- `packages/core/src/coverage/cobertura.ts` — parser behaviour unchanged (SPEC non-goal)
- `packages/core/src/coverage/lcov.ts` — parser behaviour unchanged (SPEC non-goal)
- `packages/core/src/coverage/index.ts` — `parseCoverage(text, CoverageFormat)` keeps its signature; detection happens before it
- `packages/core/src/diffCoverage.ts` — format-agnostic; the format reaches the report through `buildReport`
- `packages/core/src/render/markdown.ts` — markdown rendering unchanged (SPEC non-goal)
- `packages/core/src/setup/scan.ts` — agent setup inventory is another run
- `packages/core/test/golden.test.ts` — unchanged; only its snapshot `fixtures/golden/report.json` is regenerated
- `packages/core/test/config.test.ts` — its `jacoco` row still matches the new message as a substring
- `packages/core/test/report.test.ts` — `buildReport` without `coverageFormat` emits no `format`
- `fixtures/golden/report.md` — must stay byte-identical (AC-14)
- `packages/cli/src/nodeDeps.ts` — I/O unchanged
- `packages/action/src/index.ts` — I/O unchanged
- `.pharn/ci.yml` — this repo's own config keeps `format: lcov`
- `LIMITS.md` — PHARN's root-level document, not a product doc
- `THREAT-MODEL.md` — PHARN's root-level document, not a product doc
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 → detection step 5: every listed `fixtures/cobertura/*.xml` has its `<coverage` root at byte offset 212 or less
  (measured this run; every root start tag ends by offset 293, inside the window) and a non-`project` first child.
- AC-2 → detection step 3: every listed lcov fixture and `golden/coverage.info` starts with `TN:` or `SF:` (measured).
- AC-3 → step 1 (BOM), step 2 (whitespace incl. CR), and the scanner skipping the declaration, comments (with
  `<project>` markup inside — never an event) and DOCTYPE before the root.
- AC-4 → the Clover rule: first child `project` → unknown; a `clover` attribute on the root → unknown.
- AC-5 → JaCoCo native root `report` ≠ `coverage`; garbage has no `<` and no `TN:`/`SF:` (step 4); `coverageReport`
  is a different name; a root past 1 KiB is never in the window.
- AC-6 → only `text.slice(start, start + 1024)` is read, so every hostile input costs a bounded scan; whitespace-only
  of several MB is `unknown` (window all whitespace, text longer), the unterminated constructs and the `<` run never
  produce a root event.
- AC-7 → `check()`: `unknown` → `coverage-format-unsupported` → one `COVERAGE_FORMAT_UNSUPPORTED`, error/fail with a
  threshold, warn/warn without; `diffCoverage` null; schema-valid.
- AC-8 → `empty` → `COVERAGE_FILE_EMPTY`; `<coverage/>` → `cobertura` → empty map → `COVERAGE_FILE_EMPTY`.
- AC-9 / AC-10 → `auto` resolves to the same format as the explicit value, so the same parse and report;
  `diffCoverage.format` set from the resolved format.
- AC-11 → an explicit format skips detection; the parsers return empty maps → `COVERAGE_FILE_EMPTY`, never
  `COVERAGE_FORMAT_UNSUPPORTED`.
- AC-12 → schema: `format` enum `lcov`/`cobertura`, optional; `clover` fails the enum; the code pattern already
  accepts the new code, which is now documented.
- AC-13 → `fixtures/golden-cobertura/` inputs above; report and markdown compared by `toMatchFileSnapshot`.
- AC-14 → `format` emitted as the first `diffCoverage` key, so `report.json` gains one line; markdown unchanged.
- AC-15 → `config.ts` accepts the three selections; the error lists `lcov, cobertura, auto`.
- AC-16 / AC-17 → CLI selection precedence and the single `coverageChoiceLine` on stderr.
- AC-18 → stdout carries only the report; an invalid `--coverage-format` is a `ConfigError` → exit 2 naming the value.
- AC-19 / AC-20 → Action selection precedence, the single info line, the new rejection message through `setFailed`,
  and the `verdict` output `fail` for Clover under `auto` with a threshold.

## Risks & open questions

- **For `/pharn-test` (red run):** import every target and read every fixture inside the test body, never at module
  top level or in an `it.each` table built from a fixture read: `detect.ts`, `clover.xml`, `jacoco-native.xml` and
  `fixtures/golden-cobertura/` do not exist before the build. Each leaf title must start `AC-<n>:`.
- **AC-13 snapshot ordering:** in the AC-13 test, assert `diffCoverage.format === "cobertura"` and schema validity
  **before** the `toMatchFileSnapshot` calls. Before the build the inputs are missing and the test fails first; a
  local (non-CI) vitest run otherwise writes a missing file snapshot and passes that assertion.
- **AC-14 "previous content":** the test cannot read the old file once the build regenerates it. A workable shape:
  pin the sha256 of today's `fixtures/golden/report.md` and `report.json` (read from HEAD when the test is written),
  then assert the current `report.md` hash is unchanged, the current `report.json` contains `"format": "lcov"` inside
  `diffCoverage`, and removing that one line yields the pinned `report.json` hash. Before the build it is red (no
  `format` line). This relies on `format` being the first `diffCoverage` key (Approach).
- **CLI tests and stderr:** the CLI's end-to-end tests use `nodeDeps`, so after the build they print the format line
  to the real stderr. That is noise in the test log, not a failure.
- **Window edge:** a real Cobertura report whose prolog plus root start tag runs past 1 KiB is `unknown` under
  `auto` (SPEC Assumptions); the remedy is an explicit `cobertura`. Documented in `docs/LIMITS.md` §3, not a defect.
- **`action.yml` default:** deliberately no `default:` on `coverage-format` (Approach); a reviewer expecting
  `default: auto` there should read the reason.
- **Replaced Action test row** (AGENTS.md rule 4): the reason must be recorded in the run's record and commit message
  and later in the PR description (SPEC Assumptions). `/pharn-plan` writes neither; the loop's commit step owns it.
- **Purity test greps comments too:** no `process`, `require`, `fetch` or `globalThis` followed by `.` or `(` in
  `detect.ts`, comments included.
- The SPEC's Constraints mention `pnpm build`; this plan uses the action-only build, as the previous run did, because
  it writes exactly the committed bundle and nothing outside scope.
