---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: fb152902b9156bb94a830de2102a29e5901dcc06
date: 2026-10-12
---

# LOOP — coverage-format-selection

- Stages that ran: `/pharn-spec --model-approve` (agent:opus), `/pharn-plan` (agent:opus), `/pharn-grill --floor-only`
  (inline, policy), entry gates (green: lint, base:test, test, build), `/pharn-test --unattended` (agent:opus,
  `READY test-first`), then iteration 1: `/pharn-build` (agent:sonnet, `done gate:pass`), `/pharn-regress` (inline,
  policy), `/pharn-verify` (inline, policy).
- Iteration 1: regress `no-regressions`, verify `PASS` (gates build, instruction-growth, lint, reconcile, test all
  exit 0; completeness: build complete; AC gate `PASS`, test-first). `check-loop-fresh.mjs` FRESH;
  `check-loop.mjs` exit 0, `decision: STOP_GREEN`.
- Standing reds: none.
- Pointers: `GRILL.md`, `REGRESSION.md`, `VERIFY.md`, `BUILD.md` in this directory (cited, not restated).

## Outcome

- commit: committed pharn-loop/coverage-format-selection
- spec: approved by the model
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The build reused the existing regex-free `scanXml` for detection instead of adding a second XML reader. The
Action's `coverage-format` input was left without a `default:` key in `action.yml` so that `coverage.format` in the
config file can still take effect; the `auto` default is stated in the description and applied in code.

### learned

The old Action test row asserting that `cobertura` is rejected tested behaviour this change removes on purpose; it was
replaced by a row asserting that an unknown value (`clover`) is rejected, and AC-19 covers Cobertura acceptance. The
golden `fixtures/golden/report.json` changed by exactly one line (`"format": "lcov"`); `report.md` is unchanged. The
build stage reported (DATA) that it first edited `docs/THREAT-MODEL.md` through a Bash script, then reverted and redid
the edit with the Edit tool; verify's `reconcile` gate exited 0.

### next_steps

A person reviews the branch `pharn-loop/coverage-format-selection` against the base `fb15290`, including the
`action.yml` no-`default:` choice and the replaced Action test row, before opening a PR.
