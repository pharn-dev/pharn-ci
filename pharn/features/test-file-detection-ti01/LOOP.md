---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: b145a7f3e7ad2b8b13af7b591a3186128a355cc6
date: 2026-10-25
---

# LOOP — test-file-detection-ti01

Backlog item 3 of Epic 1 (pharn-ci v0.2.0): one test-file detection function, signal TI01 (test file deleted) with its
precision rules, and the unified-diff parser keeping the text of added and removed lines for test files.

- Stages that ran, all inline (the Agent tool backgrounds its calls, so each routed stage ran with
  `--no-agent-tool`): spec (approved by the model, 12 criteria), plan (plus the AC mapping), grill (floor-only), test
  (12 AC tests written and shown failing before the build), build, regress, verify.
- Iteration 1: build gate GREEN (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none. Entry gates (lint, base test, test, build) were green on the tree the run started from.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md` (declares the departures from the plan,
  including the one-time re-pin of three AC test files after the build existed).

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

The diff parser and its two callers (`check()` for a diff text, `readDiffChunks` for the CLI and Action stream), the
report builder, the markdown renderer and the existing tests that pin `TEST_FILES_DELETED`. One existing test asserts the
verdict equals the baseline's for deleted-test fixtures; TI01 raises the verdict by design, so that test now runs with the
mode off (recorded in `BUILD.md`).

### learned

The red run counts a pass of any `AC-n:` titled test as `ac-test-passes-before-build`, so a "nothing changed" criterion
needs a control assertion that fails before the build. AC test files written by shell heredoc skipped Biome formatting and
failed the lint gate after the build existed; the fix was to set the build aside, format, re-lock and re-run the red run.
Run `biome check` on the AC test files before pinning them next time.

### next_steps

Backlog item 4: TI14 and TI11 (ci.yml exclusions widened and threshold lowered). The diff parser now keeps line text only
for test files (`keepTestFileText`); TI14 and TI11 read `.pharn/ci.yml` and workflow files, so the selection predicate
needs to cover those paths too. The Test integrity section lists findings by signal id with a hint per id
(`SIGNAL_HINTS` in `render/markdown.ts`); add each new id there.
