---
spec_id: ti03-ti04-skip-only-signals
spec_content_hash: 0a2f5453feb9546096db6b24cdd964b89262996dc17fc4f7df715708ba05ecd1
---

## Files

- `packages/core/test/ac-ti04-narrowed.test.ts` — the tests for AC-1
- `packages/core/test/ac-ti04-not-a-test-call.test.ts` — the tests for AC-2
- `packages/core/test/ac-ti04-pre-existing.test.ts` — the tests for AC-3
- `packages/core/test/ac-ti03-js-existing.test.ts` — the tests for AC-4
- `packages/core/test/ac-ti03-python-existing.test.ts` — the tests for AC-5
- `packages/core/test/ac-ti03-conditional.test.ts` — the tests for AC-6
- `packages/core/test/ac-ti03-in-body.test.ts` — the tests for AC-7
- `packages/core/test/ac-ti03-added-test.test.ts` — the tests for AC-8
- `packages/core/test/ac-ti03-no-signal.test.ts` — the tests for AC-9
- `packages/core/test/ac-ti0304-details.test.ts` — the tests for AC-10
- `packages/core/test/ac-ti0304-modes.test.ts` — the tests for AC-11
- `packages/cli/test/ac-ti0304-render.test.ts` — the tests for AC-12
- `packages/core/test/ac-ti0304-regression.test.ts` — the tests for AC-13
- `packages/core/test/ac-ti0304-docs.test.ts` — the tests for AC-14

## Mapping

- AC-1 | integration | `packages/core/test/ac-ti04-narrowed.test.ts` | `check()` from `packages/core/src/check.ts` with `diff: { text }` and `testIntegrityMode` `{ input: "block" }`, reading `report.testIntegrity.signals`
- AC-2 | integration | `packages/core/test/ac-ti04-not-a-test-call.test.ts` | `check()` with `diff: { text }` over JS/TS, Python, Go, non-test and JSON fixture diffs in mode block, reading `report.testIntegrity.signals`
- AC-3 | integration | `packages/core/test/ac-ti04-pre-existing.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals` (ids, paths, lines)
- AC-4 | integration | `packages/core/test/ac-ti03-js-existing.test.ts` | `check()` with `diff: { text }` in modes block and warn, reading `report.testIntegrity.signals`
- AC-5 | integration | `packages/core/test/ac-ti03-python-existing.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals`
- AC-6 | integration | `packages/core/test/ac-ti03-conditional.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals`
- AC-7 | integration | `packages/core/test/ac-ti03-in-body.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals`
- AC-8 | integration | `packages/core/test/ac-ti03-added-test.test.ts` | `check()` with `diff: { text }` over modified and added test files in mode block, reading `report.testIntegrity.signals`
- AC-9 | integration | `packages/core/test/ac-ti03-no-signal.test.ts` | `check()` with `diff: { text }` in mode block, reading `report.testIntegrity.signals`
- AC-10 | integration | `packages/core/test/ac-ti0304-details.test.ts` | `check()` over the AC-1, AC-4, AC-6, AC-7 and AC-8 diffs in mode block, reading `report.testIntegrity.signals[].detail` and `report.messages[].text`
- AC-11 | integration | `packages/core/test/ac-ti0304-modes.test.ts` | `check()` in modes block, warn and off, reading `report.testIntegrity` (signals, verdict) and `report.messages`
- AC-12 | integration | `packages/cli/test/ac-ti0304-render.test.ts` | `renderMarkdown(report)` and `readDiffChunks(chunks)` from `@pharn-ci/core`, `check()` with `diff: { text }` and `diff: { parsed }`, and the CLI `main(["check", "--format", "json", ...])` from `packages/cli/src/main.ts`; reports validated against `schema/report.v2.json`
- AC-13 | integration | `packages/core/test/ac-ti0304-regression.test.ts` | `check()` over the `fixtures/test-integrity/TI01`, `TI11`, `TI14` diffs and the `fixtures/golden` inputs, reading `report.testIntegrity.signals` and `report.messages`
- AC-14 | unit | `packages/core/test/ac-ti0304-docs.test.ts` | the files `schema/report.v2.json`, `schema/report.v1.json`, `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and the directories `fixtures/test-integrity/TI03` and `fixtures/test-integrity/TI04`
