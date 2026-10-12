# BUILD — require-agent-setup

> ADVISORY record. Thin by design; not a seal.

- **Plan built:** `pharn/features/require-agent-setup/PLAN.md` (spec_content_hash `c5ece5f9ec754e6ab4d11f027ec1cd570a062620bc4f680d092b2c7e16926dee`).
- **Chain gate:** GREEN (`check-plan-spec-agree.mjs`, exit 0).
- **Test-stage gate:** `READY test-first` (`check-test-stage.mjs`, exit 0).
- **Writes-scope set (fix #7), 14 paths from the plan's `## Files`:**
  `packages/core/src/report.ts`, `packages/core/src/check.ts`, `packages/core/src/config.ts`,
  `packages/cli/src/main.ts`, `packages/action/src/run.ts`, `action.yml`, `schema/report.v1.json`,
  `fixtures/require-agent-setup/files.txt`, `fixtures/require-agent-setup/ci-require-true.yml`,
  `fixtures/require-agent-setup/ci-require-false.yml`, `README.md`, `CHANGELOG.md`,
  `docs/THREAT-MODEL.md`, `packages/action/dist/index.js`.
- **Gate result:** passed. `build-gate.mjs --mode targeted` exit 0; `--mode full` exit 0 (test, lint, build each exit 0).
- **Files written:** the 14 paths above (the three fixtures are new; `packages/action/dist/index.js` was regenerated with `pnpm --filter @pharn-ci/action build`). No golden file or snapshot changed.
- **skills:** none — installed-skills catalogue exit 0, `mode: none` (`no-skills`); no seam was touched, so Step 2c was a no-op.

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
