---
decision: INCONCLUSIVE
blocked: unlisted-ask
iterations: 1
cap: 3
commit: a1089fdeaddbf166996856eb59b632adc2d93827
date: 2026-10-25
---

# LOOP — accept-label-human-signoff

Backlog item 7 of Epic 1 (pharn-ci v0.2.0): the accept label. A PR label (`pharn/accepted` by default) applied by a
human who is not the PR author downgrades that PR's test-integrity blocks to warns; the Action reads the issue-events
API and fails closed.

- Stages that ran: spec (agent:opus, approved by the model, 14 criteria), plan (agent:opus, refused with row S10).
  Grill, test, build, regress and verify did not run.
- Stop: S10 (`blocked: unlisted-ask`). The plan stage refused to write a PLAN because the SPEC contradicts the live test
  suite, and the choice is a person's. AC-1 and the Assumptions require every Action report to carry
  `testIntegrity.acceptLabel` (also for a `pull_request` run with `accept-label` empty). The existing test
  `packages/action/test/ac-stream-action.test.ts` AC-8 runs the Action on a `pull_request` event with the input unset
  and asserts the report `toEqual` `fixtures/golden/report.json`; adding the field breaks it. AC-13 allows changing only
  the TI03, TI10 and TI13 hint assertions in `ac-ti1013-render.test.ts` and `ac-ti0304-render.test.ts`. The golden file
  cannot be updated, since `packages/core/test/golden.test.ts` compares plain `check()` output, which carries no
  `acceptLabel` (AC-12 forbids one on CLI reports), with the same file.
- Standing reds: none measured. Nothing was built; the tree is unchanged apart from the git-ignored `pharn/` records.
- Pointers: `SPEC.md` (Draft again). No PLAN, AC-TESTS, GRILL, BUILD, REGRESSION or VERIFY exists.

## Outcome

- commit: not committed: INCONCLUSIVE
- spec: reverted to Draft
- blocked: unlisted-ask
- ac-tests: not reached

## Handoff

### investigated

The spec stage read `product/BACKLOG.md` item 7, `DECISIONS.md` (2026-10-24), `REPORT-V2.md`, `API-SPEC.md`,
`schema/report.v2.json`, `report.ts`, `testIntegrityMode.ts`, the config parser and the action harness. The plan stage
read the SPEC and the code, and found the contradiction above before writing anything.

### learned

Design notes from the plan stage, as DATA: a new pure `packages/core/src/acceptLabel.ts` (default label, validation of at
most 50 code points with no control characters and an error that does not echo the value, the login pattern, a decision
from author, labels and event list, and an apply step that turns block signals into warn, rebuilds the TI messages and
recomputes both verdicts); `SIGNAL_MESSAGES` loop in `report.ts` moved into an exported helper; the TI03, TI10 and TI13
hints become functions of `report.testIntegrity.acceptLabel`; `config.ts` rejects `accept_label` naming the
`accept-label` input; two new action API methods (`getPullRequestSignoff`, `listIssueEvents` with the next-page flag from
the Link header) so `getPullRequest` keeps the shape that `api.test.ts` and `ac-pr-number-api.test.ts` assert; new
`packages/action/src/accept-label.ts` wired in `run.ts` after `check()`. Still to confirm: the token permission that
`GET /repos/{owner}/{repo}/issues/{number}/events` needs. Risk to name: `@login` in a comment that is updated may notify
the reviewer again.

### next_steps

A person amends the SPEC through `/pharn-spec` and re-runs. Recommended: add the AC-8 golden-equality assertion of
`packages/action/test/ac-stream-action.test.ts` to AC-13's list of superseded assertions, replacing it with a check that
`testIntegrity.acceptLabel` is `"pharn/accepted"` and that the rest of the report equals the golden. Alternative: write
`acceptLabel` only when the input is set or the label matters, and change AC-1's empty-input case to match. Re-run
`/pharn-loop` with the amended description afterwards; the new run takes the slug `accept-label-human-signoff-2` and
needs `pharn/features/accept-label-human-signoff/` removed or left, since it holds no AC-TESTS.
