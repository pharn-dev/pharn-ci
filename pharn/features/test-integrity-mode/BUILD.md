# BUILD — test-integrity-mode (iteration 1)

Plan built: `pharn/features/test-integrity-mode/PLAN.md`.

- Chain gate: GREEN (`check-plan-spec-agree.mjs`).
- Test-stage gate: `READY test-first` — the mapping holds and the lock records a red run over the pinned tests.
- Writes-scope set from the plan's `## Files` (30 paths); reconcile baseline anchored after the setter.
- Seam config: valid, no seam touched. `skills:` mode=none (no installed skills).
- Build gate: targeted GREEN (exit 0), full GREEN (exit 0: test, lint, build).

## Files written

New: `packages/core/src/testIntegrityMode.ts`.

Edited: `packages/core/src/{index,config,inputs,report,check}.ts`, `packages/core/src/render/markdown.ts`,
`packages/cli/src/main.ts`, `packages/action/src/run.ts`, `packages/action/dist/index.js` (rebuilt with `pnpm build`),
`action.yml`, `schema/report.v2.json`, `README.md`, `CHANGELOG.md`, `docs/THREAT-MODEL.md`.

Regenerated with `pnpm vitest run -u`: `fixtures/golden/report.md`, `fixtures/golden-cobertura/report.md`,
`fixtures/golden-exclusions/report.md`, `fixtures/golden-multi/report.md`,
`fixtures/coverage-paths/package-relative/report.md`, `packages/core/test/__snapshots__/markdown.test.ts.snap`.
The only change in each is the added "🔍 Test integrity" section. The golden `report.json` files are unchanged.

Existing tests edited (all in the plan's `## Files`), each only to account for the new section, none weakened,
skipped or deleted, every hash constant unchanged:

- `ac-header-logo-golden`, `ac-verdict-callout-golden`, `ac-paths-partial`, `ac-format-golden`: a local
  `foldTestIntegrity` removes the section's four lines before the pinned hash is taken.
- `ac-comment-bold-sections`: the expected heading list gains `### 🔍 Test integrity` (5 headings, not 4).

## Departures from the plan (declared)

- `ResolvedInputs.testIntegrityMode` is optional and absent when neither the input nor the config names a mode
  (the plan said "always present"). This keeps `inputs.test.ts` and other exact-equality tests untouched.
- `packages/core/src/report.ts` was patched once through a Bash script (python) instead of the Edit tool; every
  other source edit used the Edit tool. `biome format --write` was run on the named files only.
- No plan path went unused except the "only if" test entries: `ac-comment-bold-data`, `ac-markdown-order-cap`,
  `markdown.test.ts` (its snapshot file was regenerated, the test file is unchanged) and `ac-paths-unmatched-check`
  needed no edit.

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that
is `/pharn-regress` / `/pharn-verify` + the human.
