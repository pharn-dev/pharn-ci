---
decision: INCONCLUSIVE
blocked: gates-red-at-entry
iterations: 1
cap: 3
commit: dd2a03b41299c2cdb4da03bc790da6c96e526804
date: 2026-10-18
---

# LOOP — coverage-auto-discovery

Stopped before the first build, at the entry-gates read (S14, `blocked: gates-red-at-entry`). `check-loop.mjs` was not consulted.

- stages that ran: `/pharn-spec --model-approve` (17 criteria, approved by the model), `/pharn-plan` (PLAN.md and AC-TESTS.md), `/pharn-grill --floor-only` (chain GREEN, lessons GREEN, scans advisory). `/pharn-test` and everything after it did not run.
- stop: `entry-gates.mjs --wait` exited 4. Gate `lint` was red on the tree the run started from. `test` and `build` exited 0; `base:test` exited 1.
- standing reds, quoted as DATA: red = `["lint"]`; mutated gates = `base:test`, `test`, `build`, with changed_paths `README.md`, `packages/action/dist/index.js`, `packages/action/test/ac-comment-bold-fit.test.ts`, `packages/action/test/ac-header-logo-fit.test.ts` (changes_record: recorded).
- pointers: GRILL.md. No REGRESSION.md or VERIFY.md exists.

## Outcome

- commit: not committed: INCONCLUSIVE
- spec: reverted to Draft
- blocked: gates-red-at-entry
- ac-tests: not reached

## Handoff

### investigated

The checkout this run started in was not clean: it held the uncommitted files of a feature that origin/main had meanwhile merged (dd2a03b, "verdict as a GitHub alert callout", #58), and local HEAD was 2639d66, one commit behind. Every tracked modification and every untracked `ac-verdict-callout-*` test was byte-identical to origin/main, so after `git fetch` the branch pointer was moved with `git reset origin/main` (mixed: working tree untouched, nothing lost). HEAD is now dd2a03b and `git status` shows only `.agents/` and `.codex/` untracked. The entry gates had been started before that move, on the dirty tree.

### learned

`pnpm lint` (biome check plus the four typechecks) passes on the clean dd2a03b tree, run by hand after the stop. The `lint` red recorded by the entry gates was therefore measured on the earlier mixed tree, or was transient, not on the tree the next run will start from. The cause of that earlier red was not established. The SPEC (17 criteria) and PLAN of this run are sound as far as the floor checks go, but the SPEC is now Draft and its content hash is cleared, so the PLAN's carried hash no longer matches an Approved SPEC.

### next_steps

Re-run the loop from the clean dd2a03b tree with the same description (auto-discovery of the coverage file, an error listing the files when several different candidates match, plus examples in examples/workflows/): the earlier SPEC and PLAN stay on disk in `pharn/features/coverage-auto-discovery/` and a new run will use `coverage-auto-discovery-2`. Alternatively a person approves the existing SPEC with `/pharn-spec`, then runs `/pharn-plan` again to re-pin the chain. The plan's own notes to carry over: two existing test rows (`packages/cli/test/main.test.ts` "no coverage file" and `packages/action/test/run.test.ts` `coverage-file: ""`) assert the old stop and must be replaced with tests of the new not-found report, explained in the PR under AGENTS.md rule 4; the build needs network access to look up commit SHAs for `actions/setup-python`, `actions/setup-dotnet` and `taiki-e/install-action`; README.md must not gain `uses:` lines (ac-release-docs.test.ts).
