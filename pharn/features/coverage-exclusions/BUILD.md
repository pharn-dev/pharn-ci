# BUILD — coverage-exclusions

> ADVISORY record. Not a judgment that the code is correct.

- **Plan built:** `pharn/features/coverage-exclusions/PLAN.md` (spec_id `coverage-exclusions`, `spec_content_hash` 281c8618…dc242).
- **Chain gate:** GREEN, by `check-plan-spec-agree.mjs` (exit 0).
- **Test-stage gate (Step 0, verbatim):** `READY test-first — the mapping holds and the lock records a red run over the pinned tests`
- **Writes-scope set (fix #7), from the plan's `## Files` (22 paths):**
  `packages/core/src/glob.ts`, `packages/core/src/config.ts`, `packages/core/src/diffCoverage.ts`,
  `packages/core/src/report.ts`, `packages/core/src/check.ts`, `packages/core/src/render/markdown.ts`,
  `packages/core/src/index.ts`, `schema/report.v1.json`, `packages/cli/src/main.ts`,
  `packages/action/src/run.ts`, `action.yml`, `fixtures/golden-exclusions/{ci.yml,pr.diff,coverage.info,files.txt,report.json,report.md}`,
  `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`, `packages/action/dist/index.js`.
- **Gate result:** passed. `build-gate.mjs --mode targeted` exit 0; `--mode full` exit 0 (test, lint, build all exit 0).
- **Files written:**
  - new: `packages/core/src/glob.ts`, `fixtures/golden-exclusions/{ci.yml,pr.diff,coverage.info,files.txt}`,
    `fixtures/golden-exclusions/{report.json,report.md}` (written by `pnpm vitest run -u`, reviewed against the plan's expected content)
  - edited: `packages/core/src/{config,diffCoverage,report,check,index}.ts`, `packages/core/src/render/markdown.ts`,
    `schema/report.v1.json`, `packages/cli/src/main.ts`, `packages/action/src/run.ts`, `action.yml`,
    `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`
  - regenerated: `packages/action/dist/index.js` (`pnpm --filter @pharn-ci/action build`)
  - formatted one by one with `pnpm biome check --write`: `packages/core/src/check.ts`, `packages/core/src/render/markdown.ts`
- **Deviations:** the `pnpm vitest run -u <file>` filter ran the whole suite with `-u`; it wrote only the two new golden files
  (`git status` shows `fixtures/golden/*` unchanged).
- **skills:** mode=none (catalogue exit 0, no installed skills). Seam step: no framework seam touched; no-op.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
