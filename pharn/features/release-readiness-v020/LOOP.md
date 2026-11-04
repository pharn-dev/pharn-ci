---
decision: STOP_GREEN
iterations: 1
cap: 3
commit: b2c3a56373046ee6b64f913581a645f98240310c
date: 2026-10-25
---

# LOOP — release-readiness-v020

Backlog item 9 of Epic 1 (pharn-ci v0.2.0), release readiness without the release: the `docs/LIMITS.md` section "What
test integrity does not catch" (2 of 9 Skylos cases caught, seven misses named with their planned signal), the README
"Test integrity" section with a rendered example, the CHANGELOG lines under Unreleased, the fork-PR check and the
release smoke in `docs/RELEASING.md`, and `scripts/smoke-release.mjs` with `fixtures/smoke/`. The `Release smoke` job
and the dry-run smoke step in `.github/workflows/release.yml` are out of the loop's reach (the write guard refuses a
plan that names a workflow) and are added by hand afterwards. No version bump, no release.

- Stages that ran: spec (agent:opus, approved by the model, 14 criteria), plan plus the AC mapping (agent:opus), grill
  (inline, floor-only), test (agent:opus, 10 AC test files, written and shown failing before the build), build
  (agent:sonnet), regress and verify (inline).
- Entry gates: lint, base:test, test and build all green on the starting tree.
- Iteration 1: build gate passed (targeted and full), `/pharn-regress` `no-regressions`, `/pharn-verify` `PASS`,
  `check-loop-fresh.mjs` FRESH, `check-loop.mjs` exit 0 with decision `STOP_GREEN`.
- Standing reds: none.
- Pointers: `GRILL.md` (floor-only), `REGRESSION.md`, `VERIFY.md`, `BUILD.md`.

## Outcome

- commit: not committed: stage failed
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Handoff

### investigated

`product/BACKLOG.md` item 9, `docs/RELEASING.md`, `release.yml`, `docs/LIMITS.md`, the README, the existing release and
accept-label docs tests, and how the Action behaves outside a pull request (a committed coverage file makes it add
`COVERAGE_FILE_TRACKED`, and `report.json` goes under `RUNNER_TEMP`).

### learned

The write guard refuses a plan naming `.github/workflows/**`, so a workflow edit is always a hand step after the loop.
The smoke script writes the coverage file untracked after the head commit, and sets `RUNNER_TEMP` inside its own temp
directory. The existing CHANGELOG Report v2 entry still says the `testIntegrity` block is empty until signals ship; it
was left unchanged.

### next_steps

Add the `Release smoke` job (after `publish`, `contents: read`, checking out the released commit into its own
directory and running `node scripts/smoke-release.mjs <dir>`) and a dry-run smoke step in `verify` to
`.github/workflows/release.yml`. Then the release itself, by a maintainer: the version bump PR, the dry run, the
real run, the Marketplace step after the smoke is green.
