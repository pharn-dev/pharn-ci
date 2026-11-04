---
decision: STOP_GREEN_QUICK
iterations: 1
cap: 3
mode: quick
commit: 7a041cd6a2e4aa60b25aa48d13f654d8aa384586
date: 2026-10-13
---

# LOOP — require-agent-setup

- Stages: pharn-spec (quick, model-approved), pharn-plan, pharn-grill --quick (both floor stops GREEN), entry gates
  green, pharn-test (test-first, 3 ACs red before the build), pharn-build iteration 1 (gate pass), quick scope check
  (exit 0, nothing escaped), pharn-verify (PASS), check-loop-fresh (FRESH), check-loop.mjs exit 0.
- Iteration 1: verify `PASS`; scope check: no escaped path.
- No standing reds.
- An earlier attempt of this intent in the same worktree stopped `blocked: gates-red-at-entry` because the worktree
  had not been `pnpm install`ed; its artifacts were set aside and this run started fresh after an install.
- Pointers: GRILL.md, VERIFY.md, BUILD.md (cited, not restated).

## Outcome

commit: committed pharn-loop/require-agent-setup
spec: approved by the model
blocked: none
ac-tests: test-first

## Not checked in quick mode

- regressions outside the feature — no base comparison ran; the scope check did.
- the plan interrogation — `/pharn-grill --quick` ran its two floor stops only.
- `RUN-REPORT.md` — not rendered; `cost.json` is.

## Handoff

### investigated

The finding F-03: the agent setup inventory could never affect the verdict. The run added an opt-in requirement
(config `setup.require`, Action input `require-agent-setup`, CLI flag `--require-agent-setup`) that raises
`NO_AGENT_SETUP_FILES` to `error` when no setup file is tracked; with it off the output is unchanged.

### learned

The Action input declares no `default:` key, because a declared default would always override `setup.require`
from config; an empty input falls back to config, then false, as `threshold` does.

### next_steps

A person reviews the branch, and the PR is opened against main for review.
