---
spec_id: diff-unavailable-fails-with-threshold
spec_content_hash: "f2b7db693ba449ff7b36647aedfcb649776089af84170ce4e19ecdcec85191a2"
---

## Files

- `packages/core/test/ac-diff-unavailable-report.test.ts` — the test for AC-1
- `packages/core/test/ac-diff-unavailable-check.test.ts` — the test for AC-2
- `packages/action/test/ac-diff-unavailable.test.ts` — the tests for AC-3

## Mapping

- AC-1 | unit | `packages/core/test/ac-diff-unavailable-report.test.ts` | packages/core/src/report.ts#buildReport(input: BuildReportInput): Report — diffCoverage null with missing reasons diff-unavailable, coverage-file-missing, coverage-file-empty, coverage-format-unsupported; threshold 80, 0 and null
- AC-2 | integration | `packages/core/test/ac-diff-unavailable-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — fixtures/golden/coverage.info as lcov, diff { unavailable }, threshold 80 and null
- AC-3 | integration | `packages/action/test/ac-diff-unavailable.test.ts` | packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — pull_request event, git failing except ls-files, api.compareDiff throwing; input threshold "80" and unset; deps.setOutput("verdict") and deps.setFailed
