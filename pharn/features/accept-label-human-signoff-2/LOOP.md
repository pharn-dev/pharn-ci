---
decision: INCONCLUSIVE
blocked: needs-clarification
iterations: 1
cap: 3
commit: a1089fdeaddbf166996856eb59b632adc2d93827
date: 2026-10-25
---

# LOOP — accept-label-human-signoff-2

Backlog item 7 of Epic 1 (pharn-ci v0.2.0), the accept label: second run, after the first stopped at the plan stage
(`pharn/features/accept-label-human-signoff/LOOP.md`). The description was amended to supersede the AC-8
golden-equality assertion in `packages/action/test/ac-stream-action.test.ts`.

- Stages that ran: spec (agent:opus, refused with row S6b). The Draft SPEC (15 criteria) passes `check-spec.mjs` as a
  valid Draft but carries one clarification marker, so the model did not approve it. Plan, grill, test, build, regress
  and verify did not run.
- Stop: S6b (`blocked: needs-clarification`). The marker (SPEC.md, Assumptions) names a second exact-equality
  assertion against `fixtures/golden/report.json` on an Action report:
  `packages/cli/test/ac-stream-adapters.test.ts:321` (its AC-11) runs the Action's `run()` on a `pull_request` event
  with `accept-label` unset. Writing `testIntegrity.acceptLabel` on every Action report breaks it, and the amendment
  says only the two named groups may change. Confirmed by a grep this run: these two are the only Action-report
  `toEqual` comparisons with the golden file; the others compare `check()` output or CLI reports.
- Standing reds: none measured. Nothing was built; the tree is unchanged apart from the git-ignored `pharn/` records.
- Pointers: `SPEC.md` (Draft, never approved).

## Outcome

- commit: not committed: INCONCLUSIVE
- spec: not approved
- blocked: needs-clarification
- ac-tests: not reached

## Handoff

### investigated

The spec stage searched the suite for exact-equality assertions on Action reports before writing the SPEC and found the
second one. This run's grep of `golden/report.json` across `packages/*/test` confirms the two Action-report comparisons
(`packages/action/test/ac-stream-action.test.ts:166`, `packages/cli/test/ac-stream-adapters.test.ts:321`).

### learned

Writing a new field on every Action report touches every test that compares a whole Action report with the shared
golden file. Two options remove the conflict: list both assertions as superseded, or write `acceptLabel` only on reports
where the label matters (or only when it differs from the default), so a default run's report stays byte-equal to the
golden and no existing assertion changes. The plan-stage design notes in the first run's record still apply.

### next_steps

A person answers the marker. Option A: add `packages/cli/test/ac-stream-adapters.test.ts:321` to item 9 with the same
replacement as the AC-8 one. Option B: drop "written on every Action report" from item 6 so `testIntegrity.acceptLabel`
is written only when the `accept-label` input is set to a non-default name (hints fall back to `pharn/accepted`), which
leaves both golden assertions unchanged and drops item 9(b). Then re-run `/pharn-loop`; the new run takes slug
`accept-label-human-signoff-3`.
