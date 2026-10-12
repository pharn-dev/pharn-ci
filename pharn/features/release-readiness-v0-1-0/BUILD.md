# BUILD — release-readiness-v0-1-0

Advisory record (thin). Iteration 1.

- **Plan built:** `pharn/features/release-readiness-v0-1-0/PLAN.md` (spec_id `release-readiness-v0-1-0`).
- **Chain gate:** GREEN, by `check-plan-spec-agree.mjs` (exit 0).
- **Test-stage gate (Step 0, verbatim):** `READY test-first — the mapping holds and the lock records a red run over the pinned tests`
- **Writes-scope set (from the plan's `## Files`, 8 paths):** `package.json`, `packages/core/test/version.test.ts`, `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/RELEASING.md`, `docs/MARKETPLACE.md`, `packages/action/dist/index.js`.
- **Gate result:** passed. `build-gate.mjs --mode targeted` exit 0; `--mode full` exit 0 (test, lint, build all exit 0).
- **Files written:**
  - `package.json` (added `"version": "0.1.0"`)
  - `packages/core/test/version.test.ts` (root `package.json` check)
  - `CHANGELOG.md` (empty `[Unreleased]`, entries under `## [0.1.0] - YYYY-MM-DD` with the date note)
  - `README.md` (lcov-only phrasings, CLI help/version flags, core row)
  - `docs/LIMITS.md` (three phrasings)
  - `docs/RELEASING.md` (version bullet, changelog bullet, placeholder-date sentence)
  - `docs/MARKETPLACE.md` (new)
  - `packages/action/dist/index.js`: `pnpm build` ran; the bundle is byte-identical (no diff), so nothing was written.
- **Skills (Step 2b):** `skills: none (catalogue exit 0, mode none, no installed skills)`
- **Process note:** `CHANGELOG.md` was first written through a Bash script by mistake, then re-authored with the Write tool with identical content, so the write guard saw it. Reconcile may still report the earlier Bash write.

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
