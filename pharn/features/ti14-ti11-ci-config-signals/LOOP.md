---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: 54804ba8c6e67f6bb757a97a04c1691431cd2c90
date: 2026-10-25
---

# LOOP — ti14-ti11-ci-config-signals

Backlog item 4 of Epic 1 (pharn-ci v0.2.0): signal TI14 (coverage threshold lowered or an exclusion added in the pharn-ci
config) and signal TI11 (a workflow edit that stops CI from running tests), both computed from added and removed diff
lines, since the local diff has no context lines.

- Stages that ran, all inline (the Agent tool backgrounds its calls, so each routed stage ran with
  `--no-agent-tool`): spec (approved by the model, 15 criteria), plan (plus the AC mapping), grill (floor-only), test
  (15 AC tests written and shown failing before the build), build, regress, verify.
- Iteration 1: build gate GREEN (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none. Entry gates (lint, base test, test, build) were green on the tree the run started from.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md` (declares the departures from the plan: two
  small Bash edits of source files, one Bash edit of an AC test before it was locked).

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The diff reader and its two callers (`check()` for a diff text, `readDiffChunks` for the CLI and Action stream), the
config parser's list rules, the report builder and the renderer. The local diff is `--unified=0`, so nothing outside the
added and removed lines is visible: a bare list item cannot be tied to its key (TI14 uses the check's exclusion patterns
for that) and a `continue-on-error`, `if:` or `timeout-minutes` line cannot be tied to a test step (those three TI11 rules
are `warn` by design). One existing test (`ac-stream-check.test.ts`) parsed a diff without kept text and so differed from
the text form; its helper now uses the same selector (recorded in `BUILD.md`).

### learned

All 15 AC tests passed the red run on the first try because each test holds a positive case that fails before the build.
Running `biome check` on the AC test files before the lock avoided the re-lock that item 3 needed. The `on:` flow list is
not a matrix: without excluding the key `on`, a dropped `pull_request` would have fired the matrix rule too.

### next_steps

Backlog item 5: TI03 and TI04 (skips added, `.only` added), by diff line regex on test files. The selector
`keepSignalFileText` already keeps line text for test files, so no reader change is needed. Added lines are in
`hunk.added`; a "pre-existing" skip is matched against `hunk.removed` plus, for tests that exist at base, the base tree is
not available, so use the removed lines of the same file. Each new id needs a `SIGNAL_HINTS` entry and a
`SIGNAL_MESSAGES` entry in `report.ts`.
