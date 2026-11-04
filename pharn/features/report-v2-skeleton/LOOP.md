---
decision: INCONCLUSIVE
blocked: stage-refused
iterations: 1
cap: 3
commit: 91b6270b6fbdac0bd09bc6fb4b950fb73958200a
date: 2026-10-25
---

# LOOP — report-v2-skeleton

- Stages:
  - spec: inline (`inline:no-agent-tool`), approved by the model, now reverted to Draft
  - plan: inline (`inline:no-agent-tool`)
  - grill: `--floor-only`; chain GREEN, lessons GREEN, scans advisory
  - entry gates: green (lint, base:test, test, build)
  - test: inline (`inline:no-agent-tool`); READY test-first, 9 ACs red before the build
  - build iteration 1: inline (`inline:no-agent-tool`); full build gate passed (test, lint, build)
- The run stopped at `/pharn-regress` iteration 1. It refused before measuring (`refused scope-escaped`), which is
  stuck point S9 (`blocked: stage-refused`). `check-loop.mjs` was not consulted (blocked stop).
- Escaped paths, quoted as DATA from `REGRESSION.md`: `.codex/hooks.json`, `.codex/hooks/enforce-writes-scope.cjs`,
  `.codex/hooks/protect-trusted-paths.cjs`, `.codex/hooks/require-loop-record.cjs`,
  `.codex/hooks/set-writes-scope.cjs`. The `.codex/` directory is untracked. It did not exist in the pre-run
  snapshot (0 changed paths), and it appeared at 01:56 local time, seconds after the ChatGPT/Codex desktop app
  started (process start 01:56:11). No stage of this run writes there. The run did not remove it.
- `/pharn-verify` did not run. Regression is NOT measured. `BUILD.md` records that the build widened the plan's
  `## Files` after the anchor by six earlier-feature AC tests that pin v1 golden hashes, so a verify run is
  expected to report them as `plan-widened-after-anchor`.
- Pointers: `GRILL.md`, `BUILD.md`, `REGRESSION.md`. There is no `VERIFY.md`.

## Outcome

- commit: not committed: INCONCLUSIVE
- spec: reverted to Draft
- blocked: stage-refused
- ac-tests: test-first

## Handoff

### investigated

The regress refusal was traced to an untracked `.codex/` directory (Codex hook config plus four hook scripts with
October mtimes). It appeared mid-run, while the Codex desktop app was starting. None of this run's builds, gates or
scripts write under `.codex/`. All 752 tests, lint and build passed on the build's tree before regress ran.

### learned

`/pharn-regress` counts any new path outside the plan's scope as a build escape, including one another tool writes
into the checkout during the run. In this environment the Agent tool launched stage agents in the background, so
every routed stage ran inline. The plan missed six earlier AC tests that pin sha256 hashes of the v1 golden files.
A report version change touches every hash-pinned golden test, not only the snapshot owners.

### next_steps

A person decides what `.codex/` is: keep it out of this checkout, ignore it, or commit it. Then re-approve the
SPEC and re-run `/pharn-regress` and `/pharn-verify` on this tree, or re-run `/pharn-loop` for item 1 from a
clean checkout with the six hash-pinned tests declared in the plan up front.
