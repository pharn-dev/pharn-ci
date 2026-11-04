---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: 73ed546bc52c926fdf86c6d3ce12f5de86e4d82c
date: 2026-10-25
---

# LOOP — ti10-ti13-script-and-coverage-ignore-signals

Backlog item 6 of Epic 1 (pharn-ci v0.2.0): signal TI10 (a test script weakened in `package.json`) and signal TI13 (a
coverage-ignore comment added to source), computed from added and removed diff lines, since the local diff has no
context lines.

- Stages that ran: spec (agent:opus, approved by the model, 12 criteria), plan plus the AC mapping (agent:opus), grill
  (inline, floor-only), test (agent:opus, 12 AC tests written and shown failing before the build), build
  (agent:sonnet), regress and verify (inline). Each agent ran in the background and its hand-back arrived as a message;
  `finish` was run once the artifacts were on disk and read `done`.
- Iteration 1: build gate GREEN (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none. Entry gates (lint, base test, test, build) were green on the tree the run started from.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md` (declares the departure from the plan:
  `src/app.ts` also added to `common` in the existing `ac-ti1411-selector.test.ts`, with a positive assertion that it
  keeps its added line).

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The existing TI03, TI04, TI11 and TI14 detectors, `signalFiles.ts` (which files keep line text), `testFiles.ts`, and
`docs/PRECISION.md` for the must-not-block cases of TI10. With `--unified=0` the diff shows no context, so a
`package.json` script is read only from one-line `"key": "value"` diff lines, and a ignore marker only from its own line.

### learned

TI10 treats a weakening already on a removed line of the same script key as not added, and exempts
`--passWithNoTests` only when no tracked file is a test file and the diff deletes none. TI13 matches removed markers
against added ones one-to-one in line order. The diff reader now keeps text for `package.json` and for JS/TS/Python
source files, so the existing selector test had to stop asserting that `src/app.ts` keeps none. `ti13.ts` builds its
patterns from parts so the file holds no literal marker and does not trip TI13 on pharn-ci's own PR.

### next_steps

Backlog item 7: the accept label (`test_integrity.accept_label`, else the `accept-label` input, else `pharn/accepted`,
honoured only when applied by a non-author user). The TI03, TI10 and TI13 hints say the accept label "will record that
sign-off once it ships" and should be updated to name the label when it lands.
