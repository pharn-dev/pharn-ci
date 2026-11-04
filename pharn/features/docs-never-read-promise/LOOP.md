---
decision: INCONCLUSIVE
blocked: gates-red-at-entry
iterations: 1
cap: 3
commit: 2e89ec909a520ba51a6fa7c27680515bc8a8f309
date: 2026-11-02
isolation: {"outcome":"HOST","evidence":["cred:ssh-dir","cred:ssh-agent","cred:gh-hosts","cred:credential-helper","cred:aws-credentials","cred:npmrc-home"],"accepted_host_execution":true}
---

# LOOP — docs-never-read-promise

- Stages that ran: `/pharn-spec --model-approve` (agent:opus, done), `/pharn-plan` (agent:opus, done),
  `/pharn-grill --floor-only` (inline by policy; chain GREEN, lessons GREEN). The loop stopped at Step 4's entry-gate
  read, before `/pharn-test`: `entry-gates.mjs --wait` exited `4` with `red: ["test"]`, and `--allow-red-entry` was
  not given → stuck point **S14** (`blocked: gates-red-at-entry`). `check-loop.mjs` was not consulted (blocked stop).
- No build, regress or verify ran; no iteration verdicts exist.
- Entry gates on the starting tree: `lint` exit 0, `build` exit 0, `test` exit 1, `base:test` exit 1;
  `unmeasured: []`, `unattributed: []`, `mutated: []`.
- Standing red (DATA, from the entry `test` gate output): 10 failing tests —
  `packages/action/test/ac-accept-signoff-regression.test.ts` AC-14,
  `packages/action/test/ac-pyparity2-unchanged.test.ts` AC-20,
  `packages/core/test/ac-format-golden.test.ts` AC-14,
  `packages/core/test/ac-header-logo-golden.test.ts` AC-2,
  `packages/core/test/ac-p07-unchanged.test.ts` AC-23,
  `packages/core/test/ac-p11-unchanged.test.ts` AC-25,
  `packages/core/test/ac-paths-partial.test.ts` AC-5,
  `packages/core/test/ac-polset-pins.test.ts` AC-31,
  `packages/core/test/ac-test-integrity-mode-render.test.ts` AC-8,
  `packages/core/test/ac-verdict-callout-golden.test.ts` AC-1.
- Pointers: `GRILL.md` (floor-only). No `REGRESSION.md` / `VERIFY.md` (not reached).

## Outcome

commit: not committed: INCONCLUSIVE
spec: reverted to Draft
blocked: gates-red-at-entry
ac-tests: not reached

## Handoff

### investigated

The entry `test` gate failures are all golden-output and dist-freshness tests. The working tree held uncommitted
changes before this run started (pre-run snapshot): `packages/core/src/render/markdown.ts`, the four
`fixtures/golden*/report.md` files (staged) and `packages/action/dist/index.js` (unstaged). Those edits are the likely
cause; nothing in this run touched them. The SPEC and PLAN found the review's README line numbers have drifted
(the correct passages are near README lines 416 and 485).

### learned

The fix itself is documentation only: SECURITY.md:75's Data-handling row, a new row for the agent config/settings/
instruction text (THREAT-MODEL C4–C6), dropping "and never reads them" from docs/MARKETPLACE.md:17, and one
CHANGELOG bullet under Unreleased → Security. The plan maps AC-1..AC-4 to a new test file
`packages/core/test/ac-never-read-docs.test.ts` rather than extending the existing doc tests. Separately noted by the
spec stage: SECURITY.md's Data-handling table has no row for the pharn.dev upload.

### next_steps

Commit, stash or revert the pre-existing render/golden/dist changes so `pnpm test` is green on the starting tree,
then re-run `/pharn-loop --accept-host-execution` with the same description. Remove `pharn/features/docs-never-read-promise/`
first, or the retry's plan will see this run's AC-TESTS.md. Alternatively re-run with `--allow-red-entry` if the red
is accepted as unrelated.
