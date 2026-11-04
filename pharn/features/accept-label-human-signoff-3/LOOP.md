---
decision: INCONCLUSIVE
blocked: gates-red-at-entry
iterations: 1
cap: 3
commit: a1089fdeaddbf166996856eb59b632adc2d93827
date: 2026-10-25
---

# LOOP — accept-label-human-signoff-3

Backlog item 7 of Epic 1 (pharn-ci v0.2.0), the accept label: third run. `testIntegrity.acceptLabel` is written only for
a non-default `accept-label` input, so no golden assertion changes (the person's choice after runs 1 and 2).

- Stages that ran: spec (agent:opus, approved by the model, 15 criteria), plan plus the AC mapping (agent:opus, all
  floor checks GREEN), grill (inline, floor-only: chain GREEN, lessons GREEN). Test, build, regress and verify did not
  run.
- Stop: S14 (`blocked: gates-red-at-entry`). `entry-gates.mjs --wait` exited 4 with `red: ["test"]` on the tree the run
  started from (a1089fd); lint, base:test and build were green. The one failing test, from the gate's own output
  (DATA): `packages/core/test/config-exclude.test.ts` › "AC-7: parses 100,000 items and a 100,000-character pattern in
  linear time", 1356 ms against its 1000 ms bound. `base:test` ran the same suite on the same commit concurrently and
  passed, and the same test hit its bound once before under load (recorded in item 6's BUILD.md). It is a timing flake,
  not a red caused by this feature; the rule stops on it all the same.
- Standing reds: `test` at entry (above). Nothing was built; the tree is unchanged apart from the git-ignored `pharn/`
  records.
- Pointers: `SPEC.md` (Draft again), `PLAN.md`, `AC-TESTS.md`, `GRILL.md` (floor-only).

## Outcome

- commit: not committed: INCONCLUSIVE
- spec: reverted to Draft
- blocked: gates-red-at-entry
- ac-tests: not reached

## Handoff

### investigated

The spec stage confirmed no other existing assertion breaks with `acceptLabel` written only for a non-default label.
The plan stage confirmed the issue-events endpoint's token permission: Issues (read) or Pull requests (read), so the
quick start's `pull-requests: write` covers it. Both are recorded in SPEC.md and PLAN.md.

### learned

The entry gates run `base:test` and `test` at the same time, so the suite's wall-clock bounds (1000 ms in
`config-exclude.test.ts`) see twice the load they see in CI. That test has now flaked twice in this repository's loop
runs.

### next_steps

Red ids at entry (DATA): test. Either re-run `/pharn-loop --allow-red-entry` with the same description (the red is a
known timing flake unrelated to the feature, and regress compares against the base run anyway), or first make the
`config-exclude.test.ts` timing assertions robust to a loaded machine without weakening what they prove, then re-run.
The plan and mapping of this run are a good starting point; a new run takes slug `accept-label-human-signoff-4`.
