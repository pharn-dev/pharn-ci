---
spec_id: ti10-ti13-script-and-coverage-ignore-signals
spec_content_hash: 077a9dded5b29e2f9a12a0a4a61cc590d4f4bea50955299ab0d7d32c4f1fd6f6
---

## Files

- `packages/core/test/ac-ti1013-selector.test.ts` — the tests for AC-1
- `packages/core/test/ac-ti10-weakened.test.ts` — the tests for AC-2
- `packages/core/test/ac-ti10-no-signal.test.ts` — the tests for AC-3
- `packages/core/test/ac-ti10-no-tests-exemption.test.ts` — the tests for AC-4
- `packages/core/test/ac-ti10-details.test.ts` — the tests for AC-5
- `packages/core/test/ac-ti13-added.test.ts` — the tests for AC-6
- `packages/core/test/ac-ti13-no-signal.test.ts` — the tests for AC-7
- `packages/core/test/ac-ti13-details.test.ts` — the tests for AC-8
- `packages/core/test/ac-ti1013-modes.test.ts` — the tests for AC-9
- `packages/cli/test/ac-ti1013-render.test.ts` — the tests for AC-10
- `packages/core/test/ac-ti1013-regression.test.ts` — the tests for AC-11
- `packages/core/test/ac-ti1013-docs.test.ts` — the tests for AC-12

## Mapping

- AC-1 | unit | `packages/core/test/ac-ti1013-selector.test.ts` | `keepSignalFileText(configPath?: string, repoRoot?: string): (file: { path: string; oldPath: string }) => boolean` exported from `@pharn-ci/core` (module `packages/core/src/signals/signalFiles.ts`), used as the `keepText` option of `parseUnifiedDiff(text, options)` from `packages/core/src/diff/unified.ts`, reading each file's `hunks` and `textTruncated`
- AC-2 | integration | `packages/core/test/ac-ti10-weakened.test.ts` | `check()` from `packages/core/src/check.ts` with `diff: { text }`, `repoFiles` holding `src/a.test.ts` and `testIntegrityMode` `{ input: "block" }` then `{ input: "warn" }`, reading `report.testIntegrity.signals`
- AC-3 | integration | `packages/core/test/ac-ti10-no-signal.test.ts` | `check()` with `diff: { text }`, `repoFiles` holding test files and `testIntegrityMode` `{ input: "block" }`, reading `report.testIntegrity.signals`
- AC-4 | integration | `packages/core/test/ac-ti10-no-tests-exemption.test.ts` | `check()` with `diff: { text }` in mode block and four `repoFiles` lists (with a test file, without one, without one plus a deleted test file in the diff, empty), reading `report.testIntegrity.signals`
- AC-5 | integration | `packages/core/test/ac-ti10-details.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals[].detail` and `.line` and `report.messages[].text`
- AC-6 | integration | `packages/core/test/ac-ti13-added.test.ts` | `check()` with `diff: { text }` over modified and added source diffs, `testIntegrityMode` `{ input: "block" }` then `{ input: "warn" }`, reading `report.testIntegrity.signals`
- AC-7 | integration | `packages/core/test/ac-ti13-no-signal.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals`
- AC-8 | integration | `packages/core/test/ac-ti13-details.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals[].detail` and `.line` and `report.messages[].text`
- AC-9 | integration | `packages/core/test/ac-ti1013-modes.test.ts` | `check()` with one combined `diff: { text }` in modes block, warn and off, reading `report.testIntegrity` (signals, verdict) and `report.messages`
- AC-10 | integration | `packages/cli/test/ac-ti1013-render.test.ts` | `renderMarkdown(report)` and `readDiffChunks(chunks)` from `@pharn-ci/core`, `check()` with `diff: { text }` and `diff: { parsed }`, and the CLI `main(["check", "--format", "json", ...])` from `packages/cli/src/main.ts`; reports validated against `schema/report.v2.json`
- AC-11 | integration | `packages/core/test/ac-ti1013-regression.test.ts` | `check()` over the `fixtures/test-integrity/TI01`, `TI03`, `TI04`, `TI11` and `TI14` diffs and the `fixtures/golden` inputs, reading `report.testIntegrity.signals` and `report.messages`
- AC-12 | unit | `packages/core/test/ac-ti1013-docs.test.ts` | the files `schema/report.v2.json`, `schema/report.v1.json`, `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the directories `fixtures/test-integrity/TI10` and `fixtures/test-integrity/TI13` (each diff run through `check()` in mode block; a TI10 diff with a sibling `<name>.files.txt` uses those tracked files, the others `package.json` and `src/a.test.ts`)
