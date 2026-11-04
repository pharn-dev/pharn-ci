---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: 8cc31571e0fa196543f8452deaa8e1eb3b116939
date: 2026-10-12
---

# LOOP — coverage-exclusions

- Stages that ran: `/pharn-spec --model-approve` (agent:opus), `/pharn-plan` (agent:opus), `/pharn-grill --floor-only`
  (inline, policy), entry gates (green: lint, base:test, test, build), `/pharn-test --unattended` (agent:opus),
  then iteration 1: `/pharn-build` (agent:sonnet, `done gate:pass`), `/pharn-regress` (inline, policy),
  `/pharn-verify` (inline, policy).
- Iteration 1: regress `no-regressions`, verify `PASS` (gates build, instruction-growth, lint, reconcile, test all
  exit 0; completeness: build complete; AC gate `PASS`, test-first). `check-loop-fresh.mjs --front`: `FRESH`.
  `check-loop.mjs --iter 1 --cap 3`: exit 0, `STOP_GREEN`.
- Standing reds: none.
- Pointers: `GRILL.md` (floor-only: chain GREEN, lessons GREEN, two advisory scan-plan-i18n findings),
  `REGRESSION.md`, `VERIFY.md`, `BUILD.md`.

## Outcome

commit: committed pharn-loop/coverage-exclusions
spec: approved by the model
blocked: none
ac-tests: test-first

## Handoff

### investigated

The SPEC stage found that the existing config YAML subset rejects lists and any plain value starting with `*`, so
the SPEC allows a block list only as the value of `coverage.exclude` and requires patterns beginning with `*` to be
quoted. The existing test that rejects a list under `coverage` was kept unchanged. No prior LOOP.md existed for this
intent.

### learned

Choices the model made where the description was silent (SPEC Assumptions, untrusted DATA): patterns are anchored at
the repo root; unsupported syntax (braces, brackets, leading `!`, absolute paths, backslashes, `..`, `//`, trailing
`/`) is rejected with a ConfigError rather than matched literally; a leading `./` is stripped; `excludedFiles` is
written only when non-empty, so `fixtures/golden/` output is unchanged; an all-excluded diff reuses the existing
`NO_COVERABLE_CHANGES` pass. The plan also caps the rendered Excluded list at `maxRows` (50), which the SPEC did not
ask for. The build's `pnpm vitest run -u` with a file filter ran the whole suite with `-u`; it wrote only the two new
golden files.

### next_steps

A person reviews branch pharn-loop/coverage-exclusions, in particular the model-made SPEC assumptions listed above
and the `maxRows` cap on the Excluded list, then decides whether to open a PR.
