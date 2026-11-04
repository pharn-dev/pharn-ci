---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: feb9cae77215c8a1cf34415addd972d9017427d8
date: 2026-10-25
---

# LOOP — skylos-nine-vitest

Backlog item 8 of Epic 1 (pharn-ci v0.2.0), "Skylos nine, part 1": the nine hide-a-failing-test cases reproduced as
vitest fixtures in `fixtures/skylos-nine/` (a `change.diff` and a `files.txt` per case) and pinned as AC tests through
`check()` and the comment renderer. Two cases are pinned as caught (deleted test, TI01; added skip, TI03); the other
seven are pinned as expected misses that must not crash, each naming the signal that will catch it later. Fixtures and
tests only: no product code, schema, `action.yml`, `dist` or CHANGELOG change.

- Stages that ran: spec (agent:opus, approved by the model, 6 criteria), plan plus the AC mapping (agent:opus), grill
  (inline, floor-only), test (agent:opus, 6 AC test files, 23 tests, written and shown failing before the build), build
  (agent:sonnet), regress and verify (inline).
- Entry gates: lint, base:test, test and build all green on the starting tree.
- Iteration 1: build gate passed (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md`.

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

`product/DELIVERY-PLAN.md` "Skylos nine cases (E1)", the TI01 and TI03 fixtures under `fixtures/test-integrity/`, and
how the existing TI AC tests drive `check()` with a diff, a file list and `testIntegrityMode`.

### learned

The seven misses are only honest while no shipped signal fires on them, so each case's diff was shaped to avoid TI01,
TI03, TI04, TI10, TI11, TI13 and TI14 (the deselect case edits `vitest.config.ts` only; the replaced-test case swaps
a test inside one file). When TI02, TI05, TI06, TI07, TI09 or TI15 ships, that case's miss assertion in
`ac-skylos-nine-misses.test.ts` and the table in `ac-skylos-nine-table.test.ts` must be turned into a catch assertion.

### next_steps

Backlog item 9: LIMITS + README + CHANGELOG for v0.2.0 ("What test integrity does not catch" must name the
always-true matcher as an expected miss with no signal planned, TI17 candidate), the post-release smoke job and the
fork-PR step in RELEASING.md, then the release.
