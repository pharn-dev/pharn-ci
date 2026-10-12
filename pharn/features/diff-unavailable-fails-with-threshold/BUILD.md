# BUILD — diff-unavailable-fails-with-threshold

- plan built: `pharn/features/diff-unavailable-fails-with-threshold/PLAN.md`
- chain gate: GREEN (`check-plan-spec-agree.mjs`)
- test-stage gate: `READY test-first`
- writes-scope set (from the plan's `## Files`): `packages/core/src/report.ts`, `packages/core/test/report.test.ts`,
  `packages/core/test/golden.test.ts`, `packages/action/test/run.test.ts`, `packages/action/dist/index.js`,
  `docs/LIMITS.md`, `README.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`
- gate: passed (`build-gate.mjs --mode full`, exit 0). A first full run was red (exit 3) on two wall-clock
  linear-time assertions (`cobertura-hostile` AC-16, `config-exclude` AC-7: 1110 ms and 1205 ms against a 1000 ms
  limit), files outside this change; the second full run was green.
- files written:
  - `packages/core/src/report.ts`: one shared level (error with a threshold, warn without) for
    `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `DIFF_UNAVAILABLE`; texts unchanged
  - `packages/core/test/report.test.ts`, `packages/core/test/golden.test.ts`, `packages/action/test/run.test.ts`:
    expectations changed on purpose from `warn` to `fail` (and level `error`) for an unavailable diff with threshold 80
    (F-02, fail closed with a threshold; AGENTS.md rule 4)
  - `packages/action/dist/index.js`: regenerated with `pnpm --filter @pharn-ci/action build`
  - `docs/LIMITS.md`, `README.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`: brought in line. THREAT-MODEL row D3 no
    longer names a residual, so its status moved from "Partly enforced" to "Enforced today".
- skills: mode=none (catalogue exit 0, no installed skills)

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is
`/pharn-regress` / `/pharn-verify` + the human.
