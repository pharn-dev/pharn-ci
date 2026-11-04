---
spec_id: report-v2-skeleton
state: Approved
spec_content_hash: 857eeaf250c6967df6efe40ff22283f2110bab459691055564d288d627684c30
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci v0.2.0 (epic E1) adds test integrity, and every E1 signal needs a place in the report to land. Today
`check()` emits Report v1 (`schemaVersion: "1"`), whose schema forbids unknown top-level keys, so nothing can be
added without a new report version. This increment ships the Report v2 skeleton: the published v2 schema, a
report that carries an empty `testIntegrity` block on every run and a `meta` block when the Action runs, and the
CLI, the Action's `report.json` and every golden fixture moved to v2. Consumers that validate the report must
switch on `schemaVersion`, so the release notes have to say plainly that v0.2.0 is a breaking release for report
consumers. Later E1 items fill `testIntegrity` without touching the report's shape again.

## Scope

**In scope:**

- `schema/report.v2.json`, built from `product/schema/report.v2.draft.json`, published next to an unchanged
  `schema/report.v1.json`.
- `check()` emitting a v2 report: every v1 field with its v1 name, type and meaning, `schemaVersion` 2, and an
  empty `testIntegrity` block (mode, source, verdict, signals, languages).
- An optional `meta` block that `check()` carries through when its caller gives one; the Action fills it from
  its GitHub run context; the CLI gives none.
- The CLI `--format json` output, the Action's `report.json`, the markdown footer and every golden and fixture
  report re-pinned to v2.
- Tests that validate every produced report against the v2 schema (`expectValidReport`).
- `docs/RELEASING.md` naming v0.2.0 as breaking for report consumers, a `CHANGELOG.md` Unreleased line, and the
  `report-path` output description in `action.yml` naming Report v2.

**Out of scope (non-goals):**

- Any test-integrity detection or signal (items 3–6); `testIntegrity.signals` stays empty.
- The `test-integrity` input, the `.pharn/ci.yml` `test_integrity.mode` key and mode precedence (item 2); the
  mode is the default on every run here.
- The "🔍 Test integrity" comment section and the v2 summary-table columns (item 2).
- The accept label, `testIntegrity.accepted`, and the `meta` fields only it needs: `prAuthor`, `prLabels`,
  `coAuthors`, `agentHint` (item 7).
- The `policy` and `flaky` objects: they are in the schema but no run emits them.
- New message codes, and any change to how the verdict is computed.
- README, LIMITS and Marketplace rewrites beyond the lines that would otherwise state Report v1 is the current
  output (item 9), and the release itself.
- The pharn-ci agent skills in pharn-dev/skills (item 10).

## Acceptance Criteria

- **AC-1** Given `schema/report.v2.json` loaded together with `schema/report.v1.json` When a strict JSON Schema
  2020-12 validator compiles it Then compilation succeeds, and `schema/report.v1.json` is byte-identical to the
  base commit's copy
  - verify: unit
- **AC-2** Given the golden fixture inputs and no `meta` input When `check()` runs Then the returned report has
  `schemaVersion` equal to the number 2, `testIntegrity` equal to `{ "mode": "warn", "source": "default",
  "verdict": "pass", "signals": [], "languages": [] }`, no `meta` key, and `verdict`, `diffCoverage`,
  `agentSetup` and `messages` equal to what the v1 golden report recorded for the same inputs
  - verify: unit
- **AC-3** Given a `meta` object with the schema's required fields When `check()` runs with it Then the returned
  report's `meta` deep-equals the given object and the report passes `expectValidReport`
  - verify: unit
- **AC-4** Given the v2 validator When it checks a report with `schemaVersion` "2" (a string), one with
  `schemaVersion` "1", one whose `testIntegrity` carries an unknown key, and one with a signal id `TI17` Then
  each is rejected
  - verify: unit
- **AC-5** Given every golden and fixture report pharn-ci's tests produce When each is validated Then it passes
  the v2 schema through `expectValidReport`, and the rendered markdown footer reads `report schema v2`
  - verify: unit
- **AC-6** Given the golden fixture repository When `pharn-ci check --format json` runs Then stdout parses to a
  report with `schemaVersion` 2, an empty `testIntegrity` block and no `meta` key, and it passes the v2 schema
  - verify: integration
- **AC-7** Given a `pull_request` run of the Action in the test harness When it writes `report.json` Then the
  file at `report-path` has `schemaVersion` 2 and a `meta` block whose `event` is "pull_request", whose
  `repository`, `prNumber`, `headSha`, `baseSha`, `runId` and `runAttempt` equal the run context's values, whose
  `upload.status` is "skipped", and the file passes the v2 schema
  - verify: integration
- **AC-8** Given an Action run triggered by an event outside the schema's `meta.event` list When it writes
  `report.json` Then `meta.event` is "other" and the file passes the v2 schema
  - verify: integration
- **AC-9** Given the repository docs When they are read Then `docs/RELEASING.md` states that v0.2.0 is a breaking
  release for report consumers because `schemaVersion` becomes 2, `CHANGELOG.md` has an Unreleased entry naming
  Report v2 and `schemaVersion` 2, and `action.yml`'s `report-path` description names Report v2 and
  `schema/report.v2.json`
  - verify: unit

## Constraints

- AGENTS.md rule 2: the schema file is the source of truth; `schema/report.v1.json` is not edited; every v1 field
  keeps its name, type and meaning in v2, and no message code is removed or renamed.
- AGENTS.md rule 1: `packages/core` stays pure; `meta` reaches `check()` as plain data from its caller.
- AGENTS.md rule 3: every report a test produces is validated against the schema, now v2.
- AGENTS.md rule 4: no test is weakened or skipped; golden files change only because the output changes on
  purpose, regenerated with `pnpm test -u` and reviewed.
- AGENTS.md rule 7: `packages/action/dist` is rebuilt and committed.
- CLAUDE.local.md: Report v2 is additive to v1, and nothing leaves the job except what
  `product/ACTION-APP-CONTRACT.md` names; `meta` carries run metadata only.
- No new runtime dependency, no new GitHub API call and no new network call.

## Assumptions

- `schemaVersion` is the number 2, as `product/schema/report.v2.draft.json` (`"const": 2`), REPORT-V2.md and
  BACKLOG item 1 all say, although v1 used the string "1"; a consumer switching on it sees a type change too.
- The empty block's mode is `warn` with source `default`, the default mode in DECISIONS and TEST-INTEGRITY-SPEC,
  since the input that changes it lands in item 2; its verdict is `pass` and it changes no report verdict.
- `meta` is optional in the report: a CLI run has no GitHub run, and REPORT-V2.md says a missing object means
  "this part did not run".
- The Action's `meta` carries the schema's required fields plus `prNumber`, `baseSha` and `actor` when the run
  context has them; `upload.status` is "skipped" because nothing uploads before the app ships.
- The v2 schema's `$id` sits beside v1's (`https://pharn.dev/schemas/ci/`) so its relative `$ref`s to
  `report.v1.json` resolve; the draft's `$id` path differs from v1's and is a draft detail.
- `meta.headSha` accepts 40 or 64 hex characters, matching the `head-sha` input's rule for SHA-256
  repositories, where the draft allowed only 40.
- The project's `test` script runs vitest, which PHARN's gate discovery finds, so the criteria above have a
  runner.
