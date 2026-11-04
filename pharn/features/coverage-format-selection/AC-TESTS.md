---
spec_id: coverage-format-selection
spec_content_hash: 734e074e751d0e556c0e297ef80316589d1943d7b96d66bf0ef8bdd12b0d75a1
---

## Files

- `packages/core/test/ac-format-detect.test.ts` — the tests for AC-1 to AC-6
- `packages/core/test/ac-format-check.test.ts` — the tests for AC-7 to AC-11
- `packages/core/test/ac-format-schema.test.ts` — the test for AC-12
- `packages/core/test/ac-format-golden.test.ts` — the tests for AC-13 and AC-14
- `packages/core/test/ac-format-config.test.ts` — the test for AC-15
- `packages/cli/test/ac-coverage-format.test.ts` — the tests for AC-16 to AC-18
- `packages/action/test/ac-coverage-format.test.ts` — the tests for AC-19 and AC-20

## Mapping

- AC-1 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-2 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-3 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-4 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-5 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-6 | unit | `packages/core/test/ac-format-detect.test.ts` | packages/core/src/coverage/detect.ts#detectCoverageFormat(text: string): "lcov" | "cobertura" | "unknown" | "empty"
- AC-7 | integration | `packages/core/test/ac-format-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — coverage { text, format: "auto", file }, threshold 80 or null
- AC-8 | integration | `packages/core/test/ac-format-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — coverage { text, format: "auto", file }, threshold 80
- AC-9 | integration | `packages/core/test/ac-format-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — golden lcov inputs with format "auto" and "lcov"
- AC-10 | integration | `packages/core/test/ac-format-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — a Cobertura fixture with format "auto" and "cobertura"
- AC-11 | integration | `packages/core/test/ac-format-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — explicit format "cobertura" on clover.xml, "lcov" on a Cobertura fixture
- AC-12 | unit | `packages/core/test/ac-format-schema.test.ts` | schema/report.v1.json via packages/core/test/schema.ts#validateReport(report: unknown): boolean
- AC-13 | integration | `packages/core/test/ac-format-golden.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and packages/core/src/render/markdown.ts#renderMarkdown(report: Report): string over fixtures/golden-cobertura/, compared by toMatchFileSnapshot
- AC-14 | integration | `packages/core/test/ac-format-golden.test.ts` | fixtures/golden/report.json and fixtures/golden/report.md as written by packages/core/test/golden.test.ts, against check(input: CheckInput): Report with the golden lcov inputs
- AC-15 | unit | `packages/core/test/ac-format-config.test.ts` | packages/core/src/config.ts#parseConfig(text: string): PharnConfig — coverage.format "lcov" | "cobertura" | "auto", else throws ConfigError
- AC-16 | integration | `packages/cli/test/ac-coverage-format.test.ts` | packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number> — `check --coverage <file> --format json`, format line on deps.stderr
- AC-17 | integration | `packages/cli/test/ac-coverage-format.test.ts` | packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number> — `--coverage-format` flag and coverage.format in .pharn/ci.yml
- AC-18 | integration | `packages/cli/test/ac-coverage-format.test.ts` | packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number> — `--format json --coverage-format auto|clover`, stdout vs stderr and exit code
- AC-19 | integration | `packages/action/test/ac-coverage-format.test.ts` | packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — input coverage-format, report.json at report-path, deps.info lines
- AC-20 | integration | `packages/action/test/ac-coverage-format.test.ts` | packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — input coverage-format "clover" via deps.setFailed; clover.xml under auto with threshold, verdict output
