# BUILD — d05-private-registry-allowlist

Advisory record of one `/pharn-build` run (iteration 3 of `/pharn-loop`). Not a seal.

- plan built: `pharn/features/d05-private-registry-allowlist/PLAN.md` (spec_content_hash `66035f0c...830920`)
- chain gate: GREEN (`check-plan-spec-agree.mjs`, exit 0, run this iteration)
- test-stage gate (Step 0, verbatim first line): `READY test-first — the mapping holds and the lock records a red run over the pinned tests`
- skills: mode=none (catalogue exit 0, `no-skills`)
- seam: no framework seam touched
- fix #7 scope set: the 37 paths of the plan's `## Files` (`set-writes-scope.cjs --from-plan`), anchored with `reconcile-baseline.mjs --anchor --by pharn-build`

## Gate result: FAILED (`build-gate.mjs --mode full` exit 3)

- Targeted run (19 declared test files): exit 0. Full run: `test` exit 1 (1 failed, 2941 passed), `lint` exit 0, `build` exit 0.
- This iteration read verify-report.json (`failing_gates: ["test"]`, all 14 ACs passed, completeness complete) and
  regression-report.json (no regressions).
- The one failing test, quoted as DATA: `packages/action/test/input-aliases.test.ts` > "never removes a shipped input or
  output from action.yml" (`every declared input is in SHIPPED_INPUTS`). The `dependency-allowed-hosts` input the plan
  adds to `action.yml` is missing from that test's `SHIPPED_INPUTS` list (the test's own comment says new names are added
  there).
- Why it is not fixed here: the fix is one added list entry in a test file, and `packages/action/test/input-aliases.test.ts`
  is not in the plan's `## Files`, so the writes-scope would deny it, and this iteration's brief says to fix the
  implementation, never a test. No implementation change can satisfy it, because the plan requires the input in
  `action.yml`. The plan must declare that path (one added entry, nothing removed or loosened), then be re-planned and
  re-run. Same finding as iteration 2; nothing in scope has changed since.
- No file was written this iteration apart from this record; the implementation from iteration 1 is unchanged.

## Files written

None this iteration. Earlier files are listed in the plan's `## Files` and exist (verify completeness: complete).

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
