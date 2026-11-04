# BUILD — release-readiness-v020

- Plan built: `pharn/features/release-readiness-v020/PLAN.md`.
- Chain gate: GREEN, by `check-plan-spec-agree.mjs`.
- Test-stage gate: `READY test-first — the mapping holds and the lock records a red run over the pinned tests`.
- Writes-scope set from the plan's `## Files` (10 paths):
  `docs/LIMITS.md`, `README.md`, `CHANGELOG.md`, `docs/RELEASING.md`, `scripts/smoke-release.mjs`,
  `fixtures/smoke/base/src/math.js`, `fixtures/smoke/head/src/math.js`, `fixtures/smoke/head/src/math.test.js`,
  `fixtures/smoke/coverage.lcov`, `fixtures/smoke/expected-summary.txt`.
- Gate: passed. `build-gate.mjs --mode targeted` exit 0; `--mode full` exit 0 (test, lint, build).
- Files written: the 10 paths above.
- skills: mode=none (catalogue exit 0, no installed skills).
- Seam-config: validated GREEN; no seam touched.
- Notes: the `README.md` example is the real `renderMarkdown()` section for `fixtures/skylos-nine/added-skip` in mode
  `block`, taken from a scratch bundle under `.pharn/`. `expected-summary.txt` lines come from a real run of the
  committed bundle. `release.yml` is not touched: the `Release smoke` job and the dry-run smoke step stay for the
  maintainer to add by hand, so `docs/RELEASING.md` is ahead of the workflow until then.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
