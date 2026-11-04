---
spec_id: report-v2-skeleton
spec_content_hash: 857eeaf250c6967df6efe40ff22283f2110bab459691055564d288d627684c30
applied_lessons: none
---

## Approach

Publish `schema/report.v2.json` from the draft, move every producer (core `check()`, the CLI's `--format json`, the
Action's `report.json`) to v2, and move every test that validates a produced report to the v2 schema. The report's
shape changes in three places only:

1. `schemaVersion` is the number 2.
2. `testIntegrity` is always present, built as a constant default (`mode: "warn"`, `source: "default"`,
   `verdict: "pass"`, `signals: []`, `languages: []`). It does not feed `verdictOf`, so no verdict changes.
3. `meta` is present only when the caller passes one: `CheckInput.meta` is carried into `BuildReportInput.meta` and
   copied into the report as given (core stays pure, AGENTS.md rule 1). The Action builds it from its run context in
   a new pure module; the CLI passes none.

Key order in the report: v1's six keys in their v1 order, then `testIntegrity`, then `meta`. A v1 golden file then
changes only in `schemaVersion` and an appended block, which keeps the golden diffs reviewable.

`schema/report.v1.json` is not touched. The v2 schema `$ref`s v1 for `tool`, `diffCoverage`, `agentSetup` and
`messages` (as the draft does), so every validator loads v1 with `addSchema` first. The v2 `$id` becomes
`https://pharn.dev/schemas/ci/report.v2.json`, beside v1's `$id`, so the relative `report.v1.json#/...` refs resolve. A
probe this run showed strict Ajv 2020 refuses the draft's `"format": "date-time"` / `"uri"` as unknown formats. The
schema keeps them as annotations, and validators compile with `{ strict: true, allErrors: true, validateFormats:
false }`, so no new dependency (`ajv-formats`) is added. Neither field is emitted in this increment.

## Applied lessons

- none — the project has no `memory-bank/lessons-learned.md` (`check-lessons-index.mjs --verdict` printed
  `NO_CANON`), so there are no promoted lessons to apply.

## Steps

### Schema

1. Create `schema/report.v2.json` from `product/schema/report.v2.draft.json`:
   - `$id` `https://pharn.dev/schemas/ci/report.v2.json`;
   - title `pharn-ci Report v2`, and a description saying v2 is v1 plus optional top-level objects, that
     `schemaVersion` is the number 2, and that within v2 fields are only added;
   - `meta.headSha` pattern `^([0-9a-f]{40}|[0-9a-f]{64})$`;
   - everything else as drafted.

### Core

2. In `packages/core/src/report.ts`:
   - `Report.schemaVersion: 2` (update the doc comment to name `schema/report.v2.json`);
   - add the exported types `ReportTestIntegrity` and `TestIntegritySignal`. The signal type matches the schema and
     is unused for now;
   - add `ReportMeta` (event union incl. `"other"`, the required fields, and the optional `repositoryId`,
     `prNumber`, `baseSha`, `mergeBase`, `actor`; the item 7 fields are out of scope);
   - add `Report.testIntegrity` (required) and `Report.meta?`, and `BuildReportInput.meta?`;
   - `buildReport` returns `schemaVersion: 2`, then `testIntegrity: { mode: "warn", source: "default", verdict:
     "pass", signals: [], languages: [] }` after `messages`, then `meta` when given;
   - export the default block as a function `emptyTestIntegrity()` so nothing shares a mutable array.
3. In `packages/core/src/check.ts`:
   - add `CheckInput.meta?: ReportMeta`, and pass it in `base` only when defined;
   - change the doc comment "Report v1 out" to "Report v2 out".
4. In `packages/core/src/index.ts`, export the new types if the barrel re-exports report types (check the live file).
5. In `packages/core/src/version.ts`, change the comment "Report v1" to "Report v2".
6. `packages/core/src/render/markdown.ts` already prints `report schema v${report.schemaVersion}`. Change only what
   typechecking requires, and the footer then reads `report schema v2`.

### Action

7. Create `packages/action/src/run-meta.ts` with a pure `runMeta(context, compared)`:
   - `compared` is `{ headSha, baseSha, prNumber }`, the commits the run actually compared;
   - it returns a `ReportMeta`, or `undefined` when a required field is missing or invalid: no repository, a
     `runId` that is not an integer, a `runAttempt` below 1, or a `headSha` that is not 40/64 lowercase hex. The
     caller then logs one `info` line and the report carries no `meta`;
   - `event` is `context.eventName` when it is one of `pull_request`, `merge_group`, `push`, `workflow_run` or
     `workflow_dispatch`, else `"other"`;
   - `repository` is `payload.repository.full_name`, and `repositoryId` is `payload.repository.id` when it is an
     integer;
   - `scope` is `${workflow}/${job}`, the same pair `commentScopeLine` uses;
   - `actor` comes from `context.actor` when non-empty;
   - `upload` is `{ status: "skipped" }`.
8. In `packages/action/src/run.ts`:
   - extend `ActionContext` with the optional `runId?: number`, `runAttempt?: number`, `actor?: string` and
     `payload.repository?: { full_name?: string; id?: number }`. `github.context` already carries them, so
     `index.ts` is unchanged;
   - pass `meta: runMeta(...)` into `checkInput` when defined;
   - compared commits:
     - `pull_request`: the PR head and base shas from the payload;
     - pr-number mode (`target`): the PR's head and base from the API, which the run already fetches;
     - `merge_group`: `head_sha` / `base_sha`;
     - otherwise: `context.sha` and the resolved base, or null.
   - Reuse the values `getDiff` already resolves rather than re-deriving them. `prNumber` comes from the PR (payload
     or `pr-number`), else null.
9. In `action.yml`, change the `report-path` description to "Path to report.json (Report v2, see
   schema/report.v2.json)."
10. Run `pnpm build` so `packages/action/dist` is rebuilt and committed (AGENTS.md rule 7); the CLI bundle is
    built too but is git-ignored.

### Tests

11. Point the test validator at v2. In `packages/core/test/schema.ts`:
    - load v1 and v2, `addSchema(v1)`, and compile v2 with `validateFormats: false`;
    - `validateReport` / `expectValidReport` now validate v2, and the failure message names
      `schema/report.v2.json`;
    - also export `validateReportV1`, compiled from v1, for tests about the v1 file itself.
12. Re-pin the tests and fixtures that pin v1 output. These are intentional output changes, never a weakened
    assertion, and the PR description says so (AGENTS.md rule 4):
    - Regenerate the golden reports with `pnpm test -u`: `fixtures/*/report.json`, `fixtures/*/report.md` and
      `packages/core/test/__snapshots__/markdown.test.ts.snap`. Review that the diff is only `schemaVersion`, the
      appended `testIntegrity` block and the footer's `v2`.
    - Hand-maintained fixtures (`fixtures/setup-expect/*.json`, `fixtures/coverage-paths/package-relative/*`): set
      `schemaVersion` to 2 and append `testIntegrity`.
    - `exclusions-report.test.ts` `BASE_REPORT`: v2 literal with `testIntegrity`.
    - `packages/cli/test/ac-coverage-format.test.ts`: `toBe(2)`.
    - The footer expectations in `ac-comment-bold-footer.test.ts`, `ac-comment-look-footer.test.ts` and
      `ac-format-golden.test.ts`: `report schema v2`.
    - The `describe` titles in `golden.test.ts` and `exclusions-golden.test.ts`: "Report v2".
    - `report.test.ts`: keep every rejection case; they now run against v2.
    - `ac-format-schema.test.ts` and `ac-paths-schema.test.ts`: still about v1 message codes. Their imports stay,
      and their titles change only if a test now validates against v2.

### Docs

13. `docs/RELEASING.md`: add a paragraph under "Tag policy" saying v0.2.0 is a breaking release for report
    consumers. Report v2 sets `schemaVersion` to the number 2 (v1 used the string "1"). `report.v1.json` has
    `additionalProperties: false`, so a v2 report does not validate against it, and consumers that validate must
    switch on `schemaVersion`. Also update the two "Report v1 stays compatible / held by schema/report.v1.json"
    sentences to name v1 and v2.
14. `CHANGELOG.md` Unreleased:
    - a **Changed** entry: "**Breaking for report consumers:** Report v2 (`schema/report.v2.json`): `schemaVersion`
      is 2 and every report carries `testIntegrity`; the Action's report adds `meta`. Report v1 fields keep their
      names, types and meaning." Plus the CLI `--format json` note;
    - keep the existing section headings.
15. Change the lines that state the current output is Report v1 to v2:
    - `README.md`: lines that do so, e.g. the stability note, the `report-path` row, the footer example, the
      architecture diagram label, the layout table and the "Report v1" section. Keep its anchor link working by
      renaming the TOC entry with it. The skills-plugin line about 0.1.x stays (it is true of the plugin);
    - `docs/MARKETPLACE.md` (the "Report v1 JSON file" sentence);
    - `docs/THREAT-MODEL.md` E1 row ("validated against `schema/report.v2.json`");
    - `.github/PULL_REQUEST_TEMPLATE.md` (the schema checkbox names both files).

    `docs/LIMITS.md` stays for item 9.
16. Run `pnpm lint`, `pnpm test` and `pnpm build`.

## Files

- `schema/report.v2.json` — new: the published Report v2 schema
- `packages/core/src/report.ts` — v2 types, `schemaVersion: 2`, `testIntegrity` default, optional `meta`
- `packages/core/src/check.ts` — `CheckInput.meta` passed through; doc comment
- `packages/core/src/index.ts` — re-export the new report types (`ReportTestIntegrity`, `TestIntegritySignal`, `ReportMeta`)
- `packages/core/src/version.ts` — doc comment names Report v2
- `packages/core/src/render/markdown.ts` — only if typechecking needs it (the footer reads the version already)
- `packages/action/src/run-meta.ts` — new: pure `runMeta()` builder for the report's `meta`
- `packages/action/src/run.ts` — `ActionContext` gains run fields; `meta` passed into `check()`
- `packages/action/dist/index.js` — rebuilt bundle (AGENTS.md rule 7)
- `action.yml` — `report-path` description names Report v2
- `packages/core/test/schema.ts` — validator compiles v2 (with v1 added); `validateReportV1` kept
- `packages/core/test/report.test.ts` — schema cases run against v2
- `packages/core/test/exclusions-report.test.ts` — `BASE_REPORT` becomes a v2 literal
- `packages/core/test/golden.test.ts` — title names Report v2
- `packages/core/test/exclusions-golden.test.ts` — title names Report v2
- `packages/core/test/ac-comment-bold-footer.test.ts` — footer expects `report schema v2`
- `packages/core/test/ac-comment-look-footer.test.ts` — footer expects `report schema v2`
- `packages/core/test/ac-format-golden.test.ts` — footer expects `report schema v2`
- `packages/core/test/ac-format-schema.test.ts` — re-pinned only if its golden-based base report needs it
- `packages/core/test/ac-paths-schema.test.ts` — re-pinned only if it validates a produced report
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated footer
- `packages/core/test/ac-comment-bold-data.test.ts` — added during build (iteration 1): its v1-era golden JSON hash is kept, compared after mapping the v2 golden back to its v1 shape
- `packages/core/test/ac-header-logo-data.test.ts` — added during build (iteration 1): same v1-shape mapping before its pinned hash
- `packages/core/test/ac-header-logo-golden.test.ts` — added during build (iteration 1): footer mapped back to `report schema v1` before its pinned hash
- `packages/core/test/ac-paths-partial.test.ts` — added during build (iteration 1): v1-shape mapping of JSON and footer before its pinned hashes
- `packages/core/test/ac-verdict-callout-data.test.ts` — added during build (iteration 1): same v1-shape mapping before its pinned hash
- `packages/core/test/ac-verdict-callout-golden.test.ts` — added during build (iteration 1): footer mapped back before its pinned hashes
- `packages/cli/test/ac-coverage-format.test.ts` — `schemaVersion` expected to be 2
- `fixtures/golden/report.json` — regenerated v2 golden
- `fixtures/golden/report.md` — regenerated footer
- `fixtures/golden-cobertura/report.json` — regenerated v2 golden
- `fixtures/golden-cobertura/report.md` — regenerated footer
- `fixtures/golden-exclusions/report.json` — regenerated v2 golden
- `fixtures/golden-exclusions/report.md` — regenerated footer
- `fixtures/golden-multi/report.json` — regenerated v2 golden
- `fixtures/golden-multi/report.md` — regenerated footer
- `fixtures/coverage-paths/package-relative/report.json` — re-pinned to v2
- `fixtures/coverage-paths/package-relative/report-warn.json` — re-pinned to v2
- `fixtures/coverage-paths/package-relative/report.md` — re-pinned footer
- `fixtures/setup-expect/report-files-missing.json` — re-pinned to v2
- `fixtures/setup-expect/report-no-files-missing.json` — re-pinned to v2
- `docs/RELEASING.md` — v0.2.0 breaking for report consumers; v1/v2 compatibility sentences
- `CHANGELOG.md` — Unreleased entry for Report v2
- `README.md` — current-output references move to Report v2
- `docs/MARKETPLACE.md` — "Report v2 JSON file"
- `docs/THREAT-MODEL.md` — E1 row names the v2 schema
- `.github/PULL_REQUEST_TEMPLATE.md` — schema checkbox names v1 and v2

### Explicitly not touched

- `schema/report.v1.json` — the v1 contract stays byte-identical (AGENTS.md rule 2)
- `product/schema/report.v2.draft.json` — the draft stays as the design record
- `docs/LIMITS.md` — item 9
- `packages/action/src/index.ts` — `github.context` already carries the run fields

## Acceptance mapping

- AC-1 → step 1, plus the shared validator options. v1 is untouched (not in `## Files`).
- AC-2 → steps 2–3: `schemaVersion` 2, the constant default block, no `meta` without input, and the v1 fields
  computed exactly as before (no change to `verdictOf` or the message builders).
- AC-3 → steps 2–3: `meta` copied as given.
- AC-4 → step 1: `const: 2`, `additionalProperties: false` on `testIntegrity`, and the signal id pattern
  `^TI(0[1-9]|1[0-6])$`.
- AC-5 → steps 11–12 (goldens validated against v2) and step 6 (footer).
- AC-6 → the CLI prints `check()`'s report unchanged (`packages/cli/src/main.ts` needs no change).
- AC-7, AC-8 → steps 7–8.
- AC-9 → steps 9, 13 and 14.

## Risks & open questions

- **The v2 schema `$ref`s v1's `messages`.** E1's later items add `TEST_INTEGRITY_*` codes, which v1's code enum
  does not list, so item 2 or item 5 must give v2 its own `messages` definition. That is not done here, to keep this
  increment to the skeleton.
- **Format keywords are not enforced** (`validateFormats: false`). Neither `policy.fetchedAt` nor
  `meta.upload.runUrl` is emitted yet. Adding `ajv-formats` would be a new dependency, needing its own
  justification.
- **The schema's `type` change.** `schemaVersion` changes from the string "1" to the number 2, as the draft and
  REPORT-V2.md say. A consumer must compare by version and by type.
- **Run fields in tests.** Existing Action tests use contexts without run fields, so `runMeta()` returns `undefined`
  and their reports carry no `meta`. Their assertions do not change.
- **Hidden v1 assertions.** A test that pins v1 in a way the grep this run did not catch (e.g. a computed string)
  will fail at verify. The loop then rebuilds, but only within `## Files`.
