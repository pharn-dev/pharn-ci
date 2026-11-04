---
decision: STOP_GREEN_QUICK
iterations: 1
cap: 3
mode: quick
commit: 7a041cd6a2e4aa60b25aa48d13f654d8aa384586
date: 2026-10-13
---

# LOOP — diff-unavailable-fails-with-threshold

- Invoked as `/pharn-loop --quick`; base `7a041cd6a2e4aa60b25aa48d13f654d8aa384586`. Third attempt at
  review finding F-02: `diff-unavailable-fail-closed` stopped blocked S10 (the SPEC did not authorize the
  third test asserting the old `warn`, `golden.test.ts`), and `diff-unavailable-fail-closed-2` stopped
  blocked S14 (lint and build red at entry because the worktree had no `node_modules`). Neither earlier
  run's directory is part of this commit.
- Stages: `/pharn-spec --quick --model-approve` (agent:opus), `/pharn-plan` (agent:opus),
  `/pharn-grill --quick` (inline: chain GREEN, lessons GREEN), entry gates green (lint, base:test, test,
  build), `/pharn-test --unattended` (agent:opus, `READY test-first`, 3 ACs red before the build),
  `/pharn-build` iteration 1 (agent:sonnet, `done gate:pass`).
- Iteration 1: quick scope check exit 0 (nothing escaped); `/pharn-verify` PASS;
  `check-loop-fresh.mjs` FRESH; `check-loop.mjs` exit 0, decision `STOP_GREEN_QUICK`.
- Pointers: GRILL.md, BUILD.md, VERIFY.md, verify-report.json.

## Not checked in quick mode

- regressions outside the feature — no base comparison ran; the scope check did;
- the plan interrogation — `/pharn-grill --quick` ran its two floor stops only;
- `RUN-REPORT.md` — not rendered; `cost.json` is.

## Outcome

commit: committed pharn-loop/diff-unavailable-fails-with-threshold
spec: approved by the model
blocked: none
ac-tests: test-first

## Handoff

### investigated

The CLI never builds a DIFF_UNAVAILABLE report: a failed `git diff <base>...HEAD` throws and exits 2,
which is already fail-closed, so the CLI was left unchanged. The Action already fails the step on a
`fail` verdict (when fail-on-threshold is true), so packages/action/src needed no change; only the
bundle was rebuilt. The schema documents no per-code levels, so it was not changed.

### learned

Three pre-existing tests encoded the old soft gate with threshold 80 (report.test.ts, golden.test.ts,
run.test.ts pull_request_target) and were updated to expect `fail`. The build saw two wall-clock
linear-time assertions in untouched files (cobertura-hostile.test.ts AC-16, config-exclude.test.ts AC-7)
exceed their 1000 ms limit once under load and pass on re-run.

### next_steps

Open a PR for the branch; in its description, explain the three updated tests and the user-visible
behaviour change (shallow-clone users with a threshold should use fetch-depth: 0 or the API fallback).
