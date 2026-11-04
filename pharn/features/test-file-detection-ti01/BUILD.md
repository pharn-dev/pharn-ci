# BUILD — test-file-detection-ti01

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.

- plan built: `pharn/features/test-file-detection-ti01/PLAN.md` (iteration 1, inline: the Agent tool backgrounds its calls)
- chain gate: GREEN (`check-plan-spec-agree.mjs`)
- test-stage gate: `READY test-first — the mapping holds and the lock records a red run over the pinned tests`
- scope set from the plan's `## Files`: 26 paths (core sources, the schema, 11 fixture diffs, four docs, the rebuilt action bundle, one existing test)
- skills: mode=none (no installed skills)
- gate: `build-gate.mjs --mode full` GREEN (exit 0): test, lint, build

## Files written

`packages/core/src/{testFiles,check,chunkInputs,report,index}.ts`, `packages/core/src/diff/unified.ts`,
`packages/core/src/render/markdown.ts`, `packages/core/src/signals/ti01.ts` (new), `schema/report.v2.json`,
`fixtures/test-integrity/TI01/*.diff` (11), `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`,
`packages/action/dist/index.js` (rebuilt with `pnpm build`), and the existing
`packages/core/test/ac-test-files-deleted-check.test.ts`.

## Departures to declare

1. **Existing test edited on purpose.** `ac-test-files-deleted-check.test.ts` now runs with `testIntegrityMode: { input: "off" }`.
   It asserts that `TEST_FILES_DELETED` is info only and that the verdict equals the baseline's; TI01 deliberately raises the
   verdict in the default mode when a deleted test file defines tests, so the assertion only holds with the signals off. The
   message assertions are unchanged. No other existing test or golden changed.
2. **Writes by Bash outside the write tools** (the hook judges only the write tools): at the test stage, six of the twelve AC
   test files were created by shell heredoc, and two parser tests got a one-off `python3` text edit that swapped a `Function`
   cast for typed casts. At the build, `biome check --write` formatted nine in-scope source and test files, one by one.
3. **The AC tests were re-pinned once after the build existed.** `biome check` (the lint gate) found three AC test files
   unformatted, which was a mistake of the test stage. With the build stashed (`git stash`, backed up to a tar in the
   scratchpad), the three files were formatted with `biome format --write` (whitespace only), the lock was rewritten, and the
   red run was run again over the build-free tree: all 12 ACs failed before the build, as required. The stash was then
   restored, the reconcile baseline was anchored again, and the targeted and full gates were run on the restored tree. The
   first reconcile epoch is therefore replaced by the second; no write outside the plan's `## Files` happened in either.
4. **Detection choices recorded here, not in the SPEC:** a deleted test file whose text was not kept (a caller that passed a
   parsed diff without `hunks`) counts as unknown and is reported (fails closed); `testIntegrity.languages` stays `[]`; one
   `TEST_INTEGRITY_TI01` message is emitted per report.
