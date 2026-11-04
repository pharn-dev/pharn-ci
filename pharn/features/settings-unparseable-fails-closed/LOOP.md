---
decision: INCONCLUSIVE
blocked: gates-red-at-entry
iterations: 1
cap: 3
commit: 2e89ec909a520ba51a6fa7c27680515bc8a8f309
date: 2026-11-02
isolation: {"outcome":"HOST","evidence":["cred:ssh-dir","cred:ssh-agent","cred:gh-hosts","cred:credential-helper","cred:aws-credentials","cred:npmrc-home"],"accepted_host_execution":true}
---

# LOOP — settings-unparseable-fails-closed

- Stages that ran: `/pharn-spec --model-approve` (agent:opus, done), `/pharn-plan` (agent:opus, done),
  `/pharn-grill --floor-only` (inline by policy; chain GREEN, lessons GREEN, scans: no findings). The run stopped at
  Step 4's entry-gate read, before `/pharn-test`: stuck point S14, `blocked: gates-red-at-entry`. `--allow-red-entry`
  was not given.
- No build ran, so there are no per-iteration verdicts and `check-loop.mjs` was not consulted (a blocked stop).
- Entry gates (`pharn/floor/entry-gates.mjs --wait`, exit 4): `lint` exit 0, `base:test` exit 1, `test` exit 1,
  `build` exit 0 (mutated: `packages/action/dist/index.js`, changes_record recorded). red: `test`. unmeasured: none.
  unattributed: none.
- Pointers: `GRILL.md` (floor-only log), `PLAN.md`, `AC-TESTS.md`, `SPEC.md` (reverted to Draft).

## Outcome

commit: not committed: INCONCLUSIVE
spec: reverted to Draft
blocked: gates-red-at-entry
ac-tests: not reached

## Handoff

### investigated

The 11 tests that failed in both the `base:test` and `test` entry gates, read from the gates' vitest result files
(quoted as DATA): `ac-accept-signoff-regression` AC-14 and `ac-name-only-dist` AC-11 (the committed action dist is not
a fresh bundle), `ac-pyparity2-unchanged` AC-20 (a base fixture is modified), `ac-format-golden` AC-14,
`ac-header-logo-golden` AC-2, `ac-paths-partial` AC-5, `ac-test-integrity-mode-render` AC-8 and
`ac-verdict-callout-golden` AC-1 (golden markdown differs), `ac-p07-unchanged` AC-23, `ac-p11-unchanged` AC-25 and
`ac-polset-pins` AC-31 (a golden fixture changed). None touches this feature's files: the tree the run started from
already held staged, uncommitted changes from before the run (`packages/core/src/render/markdown.ts`, a coverage bar,
and the four `fixtures/golden*/report.md` files), listed in the pre-run snapshot.

### learned

The red is caused entirely by that staged pre-run work, not by this increment. Running the loop with
`--allow-red-entry` would not help: those 11 pin tests would stay red every iteration and the run would end at
STOP_CAP. The entry `build` gate rebuilt `packages/action/dist/index.js` from the staged `markdown.ts`, so that file is
now modified (unstaged) in the working tree. The PLAN and AC-TESTS written this run are usable as a starting point
once the tree is clean.

### next_steps

A person commits or stashes the staged coverage-bar change (and restores `packages/action/dist/index.js` to HEAD or
keeps it with that change), so the tree the loop starts from is green, then re-runs `/pharn-loop` for this intent; the
retry lands in `settings-unparseable-fails-closed-2`, and this run's AC-TESTS.md claims its test file names, so
either remove this feature directory first or let the new plan pick new names.
