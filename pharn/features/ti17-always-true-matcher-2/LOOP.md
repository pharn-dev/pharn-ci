---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: 12036e8c485a656eeb9a4a9beb869e51e37b7d80
date: 2026-11-10
isolation: {"outcome":"HOST","evidence":["cred:ssh-dir","cred:ssh-agent","cred:gh-hosts","cred:credential-helper","cred:aws-credentials","cred:npmrc-home"],"accepted_host_execution":true}
---

# LOOP — ti17-always-true-matcher-2

- Stages: `/pharn-spec --model-approve` (agent), `/pharn-plan` (agent), `/pharn-grill --floor-only` (inline), entry
  gates (green: lint, base:test, test, build), `/pharn-test --unattended` (agent; `check-test-stage.mjs
  --require-test-first` READY test-first, 25 ACs), then one `build → regress → verify` iteration. The loop ended at
  `check-loop.mjs` exit 0, `STOP_GREEN`.
- Per-iteration verdicts read: iteration 1 verify `PASS`, regress `no-regressions` (check-loop exit 0, STOP_GREEN).
  `check-loop-fresh.mjs` was FRESH; no stage re-run.
- Standing reds: none.
- Pointers: `GRILL.md`, `REGRESSION.md`, `VERIFY.md`, `BUILD.md` (cited, not restated).
- This is the second run of the intent; the first (`ti17-always-true-matcher`, STOP_CAP) is kept in git stash
  "ti17 loop run 1 (STOP_CAP)", outside the tree.

## Outcome

commit: committed pharn-loop/ti17-always-true-matcher-2
spec: approved by the model
blocked: none
ac-tests: test-first

## Handoff

### investigated

Run 1 stopped because `packages/action/test/ac-accept-signoff-regression.test.ts`, which walks every
`fixtures/test-integrity/` directory, was outside its plan's `## Files`. This run's plan declared it; the TI17
fixtures were added to its `ADDED_AFTER_BASE` set with `BEFORE_COUNT` and `BEFORE_DIGEST` unchanged, and its sha256
was refreshed in `ac-ti09y-regression.test.ts` and `ac-pyparity2-unchanged.test.ts` (AC-25).

### learned

A sweep for tests that pin today's behaviour has to include tests that enumerate a whole fixture directory, not only
tests that name an id or a count. The build agent reported host load averages of 80 to 108 from other processes,
which made vitest's 5 s timeouts fire until the load dropped.

### next_steps

A person reviews branch `pharn-loop/ti17-always-true-matcher-2`, then pushes it and opens the pull request; its body
lists every re-pinned test with its reason (BUILD.md) and the line "pharn-starter must vendor schema/ and deploy
before this is released". Run 1's stash can be dropped once this merges.
