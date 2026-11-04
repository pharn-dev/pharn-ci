# BUILD: pr-comment-redesign-2

Advisory record (P0). Built from `pharn/features/pr-comment-redesign-2/PLAN.md`.

- plan built: `pharn/features/pr-comment-redesign-2/PLAN.md` (spec_content_hash `41dbaff3…288f`)
- chain gate: GREEN, `check-plan-spec-agree.mjs` (exit 0)
- test-stage gate: `READY test-first` (`check-test-stage.mjs`, exit 0)
- skills: `mode=none` (catalogue exit 0, no installed skills)
- seam resolution: no seam touched; no-op
- gate: passed — `build-gate.mjs --mode full` exit 0 (test, lint, build all exit 0); targeted run exit 0

## Scope set (fix #7, from the plan's `## Files`)

- `packages/core/src/render/logo.ts`
- `packages/core/src/render/markdown.ts`
- `fixtures/golden/report.md`
- `fixtures/golden-cobertura/report.md`
- `fixtures/golden-exclusions/report.md`
- `fixtures/golden-multi/report.md`
- `fixtures/coverage-paths/package-relative/report.md`
- `packages/core/test/__snapshots__/markdown.test.ts.snap`
- `packages/core/test/ac-format-golden.test.ts`
- `packages/core/test/ac-paths-partial.test.ts`
- `README.md`
- `CHANGELOG.md`
- `packages/action/dist/index.js`

## Files written

- `packages/core/src/render/logo.ts` (new): `logoMarkup()` returns `""`.
- `packages/core/src/render/markdown.ts`: logo slot above the heading (pushed only when non-empty); `summaryLines()` table between the heading and `### Diff coverage`; diff coverage table wrapped in `<details>` above 25 files; `COLLAPSE_ABOVE` comment widened.
- Five `report.md` goldens and `markdown.test.ts.snap`: regenerated with `vitest -u`; each gains the summary table only. No `report.json` changed.
- `ac-format-golden.test.ts` (`GOLDEN_MD_SHA256`) and `ac-paths-partial.test.ts` (`GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256`): recomputed for the intentional render change, with a sentence of reason each. JSON hashes and assertions unchanged.
- `README.md`: "Example PR comment" replaced with the regenerated `fixtures/golden/report.md`, quoted.
- `CHANGELOG.md`: one line under Unreleased › Changed.
- `packages/action/dist/index.js`: rebuilt by `pnpm build`.
- Plan deletions: none.

Note: the scoped `pnpm vitest run -u <files>` invocation ran the whole suite under `-u` (the path filters did not narrow it); `git status` afterwards shows only the planned files changed.

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
