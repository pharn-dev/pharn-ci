# BUILD — pr-comment-logo-2

Advisory build record. Built from `pharn/features/pr-comment-logo-2/PLAN.md`.

- **Chain gate:** GREEN (`check-plan-spec-agree.mjs`, exit 0).
- **Test-stage gate (Step 0, verbatim):** `READY test-first — the mapping holds and the lock records a red run over the pinned tests`
- **Writes-scope set (27 paths from the plan's `## Files`):** `packages/core/src/render/logo.ts`, the five `report.md` goldens
  (`fixtures/golden`, `golden-cobertura`, `golden-exclusions`, `golden-multi`, `coverage-paths/package-relative`),
  `packages/core/test/__snapshots__/markdown.test.ts.snap`, 16 corrected earlier-feature test files, `README.md`,
  `CHANGELOG.md`, `docs/THREAT-MODEL.md`, `packages/action/dist/index.js`.
- **Gate:** passed. `build-gate.mjs --mode targeted` exit 0 (24 test files); `--mode full` exit 0 (test, lint, build).
- **skills:** mode=none (catalogue exit 0, no installed skills).
- **Seams:** none touched; Step 2c was a no-op.

## Files written

- `packages/core/src/render/logo.ts`: `logoMarkup()` returns the fixed `<img>` line (module constant).
- Regenerated with `vitest -u`: the five `report.md` goldens and `markdown.test.ts.snap` (each gained the logo line and one
  empty line; no `report.json` changed).
- Hash constants recomputed with the reason written beside them: `ac-format-golden.test.ts` (`GOLDEN_MD_SHA256`),
  `ac-paths-partial.test.ts` (`GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256`). JSON hashes unchanged.
- Earlier-feature tests corrected so they allow exactly the one fixed logo line and its empty line, and still forbid every
  other image and URL: `markdown.test.ts`, `exclusions-report.test.ts`, `ac-comment-bold-{overview,header,footer,hostile}.test.ts`,
  `ac-comment-look-{header,summary,collapse,footer,hostile}.test.ts`, `packages/action/test/{run,ac-comment-look-fit,ac-comment-bold-fit}.test.ts`.
  No assertion deleted. One title changed (`ac-comment-look-footer.test.ts`: "with an empty logo slot" is now "with only the fixed logo line").
- `README.md` (Example PR comment), `CHANGELOG.md` (Unreleased, Changed), `docs/THREAT-MODEL.md` (B1 note and residual).
- `packages/action/dist/index.js`: rebuilt with `pnpm build`.
- Formatting: `biome check --write` on the touched source and test files, named one by one.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
