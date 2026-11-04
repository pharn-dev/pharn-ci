---
decision: STOP_TERMINAL
iterations: 1
cap: 3
commit: e546f912022443757bae015a618da1fc8076f4fa
date: 2026-10-12
---

# LOOP — cobertura-parser

- Stages that ran: `/pharn-spec --model-approve` (agent:opus), `/pharn-plan` (agent:opus), `/pharn-grill --floor-only`
  (inline, policy), `/pharn-test --unattended` (agent:opus; READY test-first, 16 ACs red-as-required), then iteration 1:
  `/pharn-build` (agent:sonnet, `done gate:pass`), `/pharn-regress` (inline, policy), `/pharn-verify` (inline, policy).
- Entry gates: green.
- Iteration 1: regress `no-regressions`; verify `FAIL` — gates build, instruction-growth, lint, test exit 0, reconcile
  exit 1; the AC gate delivered every criterion; completeness had nothing missing. `check-loop-fresh.mjs` FRESH, no
  re-runs. `check-loop.mjs` exit 4: `STOP_TERMINAL`, `terminal_cause: reconcile`.
- Standing red, quoted as DATA from `VERIFY.md`: `reconcile: ESCAPE (exit 1) … 49 escape(s)`. Every escaped path
  listed by `check-bash-reconcile.mjs --base . --require-baseline` lies under `.pharn/` (`.pharn/cost`,
  `.pharn/pharn-build`, `.pharn/pharn-regress`, `.pharn/pharn-verify`, `.pharn/reconcile`, `.pharn/writes-scope.json`);
  none is a product path.
- The build agent reported one edit to `packages/core/src/coverage/xml.ts` made through a Bash-run script (a path
  inside the plan's `## Files`), recorded in `BUILD.md`.
- Pointers: `SPEC.md` (reverted to Draft), `PLAN.md`, `AC-TESTS.md`, `GRILL.md`, `BUILD.md`, `REGRESSION.md`,
  `VERIFY.md`.

## Outcome

- commit: not committed: STOP_TERMINAL
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The reconcile red's escapes are all PHARN run state under `.pharn/`. In this repo `.pharn/` is not git-ignored because
pharn-ci's own product config lives at `.pharn/ci.yml`, so every floor script's state file there is an untracked path
the reconciler judges against the writes-scope.

### learned

Every full loop in this repo stops `STOP_TERMINAL` (reconcile) until `.pharn/` run state is git-ignored (keeping
`.pharn/ci.yml` tracked). Apart from that gate, iteration 1 was green: no regressions, every AC delivered, gates pass.

### next_steps

Ignore `.pharn/*` except `.pharn/ci.yml` in `.gitignore`; a person reviews this working tree's diff and decides whether
to commit it.
