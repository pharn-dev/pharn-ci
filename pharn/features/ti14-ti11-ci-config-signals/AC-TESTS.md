---
spec_id: ti14-ti11-ci-config-signals
spec_content_hash: 1a16131eba572490379738a594cc41f1dc91d04469fb694e90bccc5a91287835
---

## Files

- `packages/core/test/ac-ti1411-selector.test.ts` — the tests for AC-1
- `packages/cli/test/ac-ti1411-stream.test.ts` — the tests for AC-2
- `packages/core/test/ac-ti14-threshold.test.ts` — the tests for AC-3
- `packages/core/test/ac-ti14-exclusion.test.ts` — the tests for AC-4
- `packages/core/test/ac-ti14-config-path.test.ts` — the tests for AC-5
- `packages/core/test/ac-ti11-test-step.test.ts` — the tests for AC-6
- `packages/core/test/ac-ti11-trigger.test.ts` — the tests for AC-7
- `packages/core/test/ac-ti11-matrix.test.ts` — the tests for AC-8
- `packages/core/test/ac-ti11-continue-on-error.test.ts` — the tests for AC-9
- `packages/core/test/ac-ti11-if-condition.test.ts` — the tests for AC-10
- `packages/core/test/ac-ti11-timeout.test.ts` — the tests for AC-11
- `packages/core/test/ac-ti1411-modes.test.ts` — the tests for AC-12
- `packages/cli/test/ac-ti1411-render.test.ts` — the tests for AC-13
- `packages/core/test/ac-ti1411-regression.test.ts` — the tests for AC-14
- `packages/core/test/ac-ti1411-docs.test.ts` — the tests for AC-15

## Mapping

- AC-1 | unit | `packages/core/test/ac-ti1411-selector.test.ts` | `keepSignalFileText(configPath?: string, repoRoot?: string): (file: { path: string; oldPath: string }) => boolean` exported from `@pharn-ci/core` (module `packages/core/src/signals/signalFiles.ts`), used as the `keepText` option of `parseUnifiedDiff`
- AC-2 | integration | `packages/cli/test/ac-ti1411-stream.test.ts` | `readDiffChunks(chunks, { configPath?, repoRoot? })` and `check()` exported from `@pharn-ci/core`, reading `testIntegrity.signals` and `messages` of the report
- AC-3 | integration | `packages/core/test/ac-ti14-threshold.test.ts` | `check()` from `packages/core/src/check.ts` with `diff: { text }`, `configPath` and `testIntegrityMode`, reading `report.testIntegrity.signals`
- AC-4 | integration | `packages/core/test/ac-ti14-exclusion.test.ts` | `check()` with `diff: { text }`, `exclude` and `testIntegrityMode`, reading `report.testIntegrity.signals`
- AC-5 | integration | `packages/core/test/ac-ti14-config-path.test.ts` | `check()` with `configPath` inside and outside the repository, reading `report.testIntegrity.signals`
- AC-6 | integration | `packages/core/test/ac-ti11-test-step.test.ts` | `check()` over workflow diffs, reading `report.testIntegrity.signals`
- AC-7 | integration | `packages/core/test/ac-ti11-trigger.test.ts` | `check()` over workflow diffs, reading `report.testIntegrity.signals`
- AC-8 | integration | `packages/core/test/ac-ti11-matrix.test.ts` | `check()` over workflow diffs in mode block, reading `report.testIntegrity.signals`
- AC-9 | integration | `packages/core/test/ac-ti11-continue-on-error.test.ts` | `check()` over workflow diffs, reading `report.testIntegrity.signals`
- AC-10 | integration | `packages/core/test/ac-ti11-if-condition.test.ts` | `check()` over workflow diffs, reading `report.testIntegrity.signals`
- AC-11 | integration | `packages/core/test/ac-ti11-timeout.test.ts` | `check()` over workflow and non-workflow diffs, reading `report.testIntegrity.signals`
- AC-12 | integration | `packages/core/test/ac-ti1411-modes.test.ts` | `check()` in modes block, warn and off over one combined diff, reading `report.testIntegrity` and `report.messages`
- AC-13 | integration | `packages/cli/test/ac-ti1411-render.test.ts` | `renderMarkdown(report)` from `@pharn-ci/core` and the CLI `main(["check", "--format", "json", ...])` from `packages/cli/src/main.ts`
- AC-14 | integration | `packages/core/test/ac-ti1411-regression.test.ts` | `check()` over the TI01 fixtures, `fixtures/golden` and `fixtures/gate-tamper` diffs, reading signals and messages
- AC-15 | unit | `packages/core/test/ac-ti1411-docs.test.ts` | the files `schema/report.v2.json`, `schema/report.v1.json`, `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the directories `fixtures/test-integrity/TI14` and `fixtures/test-integrity/TI11`
