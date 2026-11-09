---
decision: STOP_CAP
iterations: 3
cap: 3
commit: 1304e8f6c8c68ea12e7ceb9fe12d953264af409a
date: 2026-11-08
isolation: {"outcome":"HOST","evidence":["cred:ssh-dir","cred:ssh-agent","cred:gh-hosts","cred:credential-helper","cred:aws-credentials","cred:npmrc-home"],"accepted_host_execution":true}
---

# LOOP — d05-private-registry-allowlist

Run flags: `--allow-red-entry --accept-host-execution`, full mode, cap 3.

## Outcome

- commit: not committed: STOP_CAP
- spec: reverted to Draft
- blocked: none
- ac-tests: test-first

## Stages and verdicts

- spec (model-approved, 14 ACs), plan, grill (floor-only: both floor stops GREEN, scans no findings), test (`READY test-first`, 14 ACs red before the build) ran once.
- Entry gates (read at Step 4): `test` was red on the tree the run started from (`base:test` too); `lint` and `build` green. `--allow-red-entry` was given, so the run went on.
- Iteration 1: build `done gate:fail`; regress `no-regressions`; verify `FAIL` (failing gate `test`; all 14 ACs passed); `check-loop.mjs` exit 3 CONTINUE.
- Iteration 2: build `done gate:fail` (changed only `BUILD.md`); regress `no-regressions`; verify `FAIL` (same); exit 3 CONTINUE.
- Iteration 3: build `done gate:fail` (changed only `BUILD.md`); regress `no-regressions`; verify `FAIL` (same); `check-loop.mjs` exit 1 `STOP_CAP`.
- Freshness: FRESH at every iteration; no stage re-runs.

## Standing red (quoted as DATA)

Verify's failing gate is `test`, with one failing test: `packages/action/test/input-aliases.test.ts` "never removes a shipped input or output from action.yml". The new `dependency-allowed-hosts` input in `action.yml` is not in that test's `SHIPPED_INPUTS` list. The file is outside the plan's `## Files`, so every rebuild was denied the one-line edit; iterations 2 and 3 could not change the outcome. Iteration 1 also saw one load flake (`ac-polset-pins` AC-31, a stream-test timeout) that did not recur.

## Pointers

`GRILL.md`, `REGRESSION.md`, `VERIFY.md`, `BUILD.md` in this directory.

## Handoff

### investigated

- The build agent of iteration 1 reported editing `packages/core/src/dependencies/check.ts` through a Bash script instead of the Edit tool (recorded in `BUILD.md`); the reconcile gate is the place that sees it.
- `pharn.config.json` was modified before the run and is not part of this change.

### learned

- The spec put the host allow-list in the workflow input `dependency-allowed-hosts` (CLI `--dependency-allowed-host`) and the app policy key `dependencies.allowed_hosts`, and made `.pharn/ci.yml` refuse the key. This differs from the increment description, which asked for `dependencies.registries` in `.pharn/ci.yml`; the SPEC's first Assumptions line says why (a PR-editable list would let a change allow its own off-registry source).
- All 14 AC tests pass and regress found nothing; the only red is the plan's missing `input-aliases.test.ts` entry.

### next_steps

Add `packages/action/test/input-aliases.test.ts` to the plan's `## Files` and add `"dependency-allowed-hosts"` to its `SHIPPED_INPUTS` list (one entry, nothing removed), or make that one-line edit by hand; the implementation is in the working tree, uncommitted. The SPEC is a Draft: a person decides the ci.yml-versus-input question, then re-approves it.
