# BUILD — fix-hints

ADVISORY record. Not a judgment that the code is correct.

- **Plan built:** `pharn/features/fix-hints/PLAN.md` (spec_id `fix-hints`).
- **Chain gate:** GREEN, by `check-plan-spec-agree.mjs` (run in Step 2; it was run after the first code writes in this iteration, and the verdict is the same).
- **Test-stage gate (Step 0, verbatim):** `READY test-first`
- **Writes-scope (fix #7):** 104 paths from the plan's `## Files`, set by `set-writes-scope.cjs --from-plan`, then anchored by `reconcile-baseline.mjs --anchor --by pharn-build`.
- **skills:** `mode=none` (catalogue exit 0, no installed skills; run after the code writes).
- **Seams:** none touched; Step 2c was a no-op.

## Files written

New: `packages/core/src/fix/table.ts`, `packages/core/src/fix/attach.ts`, `packages/core/test/v090-codes.ts`.

Edited sources: `packages/core/src/report.ts`, `packages/core/src/dependencies/types.ts`, `packages/core/src/acceptLabel.ts`, `packages/core/src/upload/outcome.ts`, `packages/core/src/index.ts`, `schema/report.v2.json`, `README.md`, `CHANGELOG.md`, `docs/LIMITS.md`, `packages/action/dist/index.js` (rebuilt by `pnpm build`).

Regenerated goldens (each message gains a `fix`): `fixtures/golden/report.json`, `fixtures/golden-cobertura/report.json`, `fixtures/golden-multi/report.json`, `fixtures/coverage-paths/package-relative/report.json`, `fixtures/coverage-paths/package-relative/report-warn.json`. Written with the edit tool; `report.md` files and `golden-exclusions/report.json` are untouched.

Re-pinned existing tests (86 files under `## Files`, each with a `fix-hints (H6)` comment, no title changed, none deleted, no skip/only/todo added): by wrapping the actual side in `withoutFix`, taking `withoutV090SchemaEdits` or `withoutFixJson` first, allowing the golden JSON files as modified in the fixture meta-tests, and moving three tests from `UNCHANGED` to a marked `EDITED_BY_FIX_HINTS` list in `ac-polset-pins`. `git diff --name-status 7d88076 -- 'packages/*/test/*'` lists 86 modified test files.

## Gate

`build-gate.mjs --mode full`: **failed, exit 3**. Test gate: 2911 passed, 2 failed; lint and build gates exit 0. `pnpm lint` (biome + typecheck) is clean apart from the warnings and infos the base already had.

The two red tests, both outside what this build may change:

1. `packages/core/test/ac-fix-hints-pins.test.ts` (AC-12, second test): `changedTestFiles()` runs `git diff --name-status --no-renames <BASE> -- packages/*/test`. In git 2.50.1 that pathspec matches no file below the directory (0 lines; `packages/*/test/*` gives the 86), so `modified.length` is 0 and `expected 0 to be greater than 0` fails whatever the build does. An AC test is outside this build's scope by design; it needs a pathspec the build cannot supply (`packages/*/test/*` or `:(glob)packages/*/test/**`).
2. `packages/core/test/ac-ti09y-regression.test.ts` (AC-20), not in the plan's `## Files`: its `PINNED` map holds the sha256 of `ac-ti0205-regression.test.ts` and `ac-accept-signoff-regression.test.ts`, both of which the plan edits. The new digests are `7583e11f397f59d04123ebdb7afea818d37f5a4b3522e32d3badd26fe104369b` and `638b8bae1e0c8efcd4df8f922e1ce4684a836610635064ed177ede565c15b9a3` (the same two values were put into `ac-pyparity2-unchanged.test.ts` `NAME_ONLY_REPINNED`, which is in scope). The plan's Risks section says to stop and report instead of widening scope, so this file was not edited.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
