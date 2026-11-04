---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: be11155dc701478902b77983a2fa7a5db358a806
date: 2026-10-25
---

# LOOP — ti03-ti04-skip-only-signals

Backlog item 5 of Epic 1 (pharn-ci v0.2.0): signal TI03 (a test skipped) and signal TI04 (run narrowed with `.only`,
`fit`, `fdescribe`), computed from added and removed diff lines of test files, since the local diff has no context lines.

- Stages that ran: spec (agent:opus, approved by the model, 14 criteria), plan plus the AC mapping (agent:opus), grill
  (inline, floor-only), test (agent:opus, 14 AC tests written and shown failing before the build), build
  (agent:sonnet), regress and verify (inline). Each agent ran in the background and its hand-back arrived as a message;
  `finish` was run once the artifacts were on disk and read `done`.
- Iteration 1: build gate GREEN (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none. Entry gates (lint, base test, test, build) were green on the tree the run started from.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md` (declares the departures from the plan: the
  CHANGELOG bullets written through a Bash heredoc, `test.skip(true, "reason")` read as a skip the diff cannot place, and
  the name of a `.each` table chain).

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The existing TI01, TI11 and TI14 detectors, the test-file helpers (`isTestFile`, `definesTests`), the diff reader's kept
line text for test files, and `docs/PRECISION.md` for the must-not-block cases. With `--unified=0` the diff shows no
context, so whether a skipped test exists at base is decided only from evidence in the diff: a removed line of the same
file that opens a test with the same name, or a Python decorator added alone above an unchanged `def`.

### learned

Every in-body skip (`pytest.skip()`, `t.Skip`, `test.skip()`) and every conditional skip is `warn` by design, because the
diff cannot show an enclosing `if` or whether the test exists. Each negative AC starts with a positive control so that the
test fails in the red run for the right reason. The AC test files were checked with `biome check` before the lock.

### next_steps

Backlog item 6: TI10 and TI13 (package.json test scripts weakened, coverage-ignore comments added in source). TI13 reads
source files, so `keepSignalFileText` will need to keep text for non-test source files (bounded), unlike TI03 and TI04.
Backlog item 7 (the accept label) should update the TI03 hint to name the label, and flaky quarantine (A6) should extend
it again.
