---
spec_id: diff-unavailable-fails-with-threshold
state: Approved
spec_content_hash: "f2b7db693ba449ff7b36647aedfcb649776089af84170ce4e19ecdcec85191a2"
approved_by: model
spec_kind: quick
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

When pharn-ci cannot get the diff of the change under review, it reports `DIFF_UNAVAILABLE` as a
warning, always, even when a coverage threshold is set. So a broken diff acquisition in the Action
(a shallow clone with an API failure, the API refusing a large diff, a diff over the size limit, a
`pull_request_target` run that checked out the base branch, a push with no previous commit, no base
at all) gives verdict `warn`, and the step passes although the user asked for a gate. This is
review finding F-02. The user wants the gate to fail closed: with a threshold set, an unavailable
diff is an error and the verdict is `fail`; without a threshold it stays a warning. This is the same
rule pharn-ci already applies to a missing, empty or unrecognized coverage file, and the user wants
that rule to live in one place for all four cases.

## Scope

**In scope:**

- `DIFF_UNAVAILABLE` becomes level `error` when a threshold is set (a threshold of 0 counts as set)
  and stays level `warn` when no threshold is set. The verdict follows from the message levels as
  today.
- One shared rule for the level of `DIFF_UNAVAILABLE`, `COVERAGE_FILE_MISSING`,
  `COVERAGE_FILE_EMPTY` and `COVERAGE_FORMAT_UNSUPPORTED` (error with a threshold, warning without),
  so the rule is stated once.
- Updating exactly three existing tests that assert the old warning with threshold 80 to expect
  `error` and `fail`: `packages/core/test/report.test.ts` "warns when the diff is unavailable",
  `packages/core/test/golden.test.ts` "warns when the diff is unavailable", and
  `packages/action/test/run.test.ts` "refuses to measure a pull_request_target run that checked out
  the base branch". Their titles may be renamed to match the new behaviour.
- Rebuilding `packages/action/dist`.
- Documentation: `docs/LIMITS.md` section 2 says the run fails closed with a threshold and that
  `fetch-depth: 0` or the API fallback avoids it; `README.md` no longer says the gate is soft when
  the diff is unavailable; `docs/THREAT-MODEL.md` no longer lists the soft gate on an unavailable diff
  as a residual; `CHANGELOG.md` gains an Unreleased > Changed line for the behaviour change, telling
  shallow-clone users with a threshold to use `fetch-depth: 0` or rely on the API fallback.

**Out of scope (non-goals):**

- Any change to the message code `DIFF_UNAVAILABLE` or its text (stable API).
- Any change to `schema/report.v1.json`.
- A new Action input, CLI flag or config key, for example an opt-out of the new failure.
- Any change to the CLI: it never builds a `DIFF_UNAVAILABLE` report, since a failed `git diff`
  already exits 2.
- Any source change to the Action's `packages/action/src/run.ts`: it already fails the step on a
  `fail` verdict when `fail-on-threshold` is true.
- Changing how the diff is acquired (local git, the API fallback, size limits).
- Any change to golden fixture files under `fixtures/golden*/`.
- Changing or retitling any existing test other than the three named above; tests without a
  threshold keep expecting `warn`.

## Acceptance Criteria

- **AC-1** Given a report input with no diff coverage and reason diff-unavailable When core's
  `buildReport` runs with threshold 80, with threshold 0 and with no threshold Then the report
  carries `DIFF_UNAVAILABLE` at level `error` with verdict `fail` for threshold 80 and for
  threshold 0, and at level `warn` with verdict `warn` with no threshold; and given the reasons
  coverage-file-missing, coverage-file-empty and coverage-format-unsupported When `buildReport` runs
  with threshold 80 and with no threshold Then `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY` and
  `COVERAGE_FORMAT_UNSUPPORTED` are at level `error` with the threshold and `warn` without; and every
  one of these reports passes `expectValidReport`
  - verify: unit
- **AC-2** Given the golden lcov text from `fixtures/golden/` and an unavailable diff When core's
  `check()` runs with threshold 80 and with no threshold Then the verdict is `fail` with the
  threshold and `warn` without, the report carries `DIFF_UNAVAILABLE`, and both reports pass
  `expectValidReport`
  - verify: integration
- **AC-3** Given the Action with no local git history and a GitHub compare API that refuses the diff
  When it runs with input `threshold` 80 Then its `verdict` output is `fail` and the step is failed
  with a message containing `Diff coverage was not computed`; and When it runs with no threshold
  Then its `verdict` output is `warn` and the step is not failed
  - verify: integration

## Constraints

- `packages/core/src` stays pure (AGENTS.md rule 1), and `packages/core/test/purity.test.ts` passes.
- `schema/report.v1.json` is unchanged; the message code `DIFF_UNAVAILABLE` and its text are
  unchanged (AGENTS.md rule 2).
- Reports produced in the new and updated tests are validated with `expectValidReport` (AGENTS.md
  rule 3).
- No existing test is weakened, skipped or deleted; only the three named tests change their expected
  level and verdict, because the behaviour changes on purpose, and the reason is recorded where the
  change is described (AGENTS.md rule 4).
- Golden files under `fixtures/golden*/` do not change.
- No dependency is added (AGENTS.md rule 6).
- `packages/action/dist` is rebuilt with `pnpm build` and is current (AGENTS.md rule 7).
- The product docs are `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and `CHANGELOG.md`; the
  root-level `LIMITS.md` and `THREAT-MODEL.md` and other PHARN tooling are not touched.
- Code, test and doc style follow the existing files; `pnpm lint` and `pnpm test` pass.

## Assumptions

- "A threshold is set" means the report input's threshold is a number, whatever its source (Action
  input, CLI flag or config); `null` means no threshold.
- The Action's failure message is the existing `pharn-ci: ` prefix followed by the error messages'
  texts, so a `DIFF_UNAVAILABLE` error puts `Diff coverage was not computed: <detail>` in it.
- `docs/LIMITS.md` section 2, now titled "When the gate is soft", may be retitled, since an
  unavailable diff no longer makes the gate soft when a threshold is set.
- In `docs/THREAT-MODEL.md`, the D3 row's residual note and the numbered residual "The gate is soft
  when the diff is unavailable" are both removed or reworded, and the remaining residuals are
  renumbered with any cross-references to them kept correct.
- The README sentence "Without a threshold, pharn-ci reports and never fails the step" stays true
  and is kept.
- The new Action test for AC-3 reuses the existing harness's no-local-history and compare-error
  options; the existing "warns when the diff cannot be fetched at all" test has no threshold and
  keeps expecting a warning.
- The project's test runner is vitest (`pnpm test`, `vitest run`); integration-level criteria run
  in the same suite as unit ones.
- This run opens no pull request; the update of the three existing tests is explained in the run's
  record and commit message, and carried into the PR description when one is opened.
