---
spec_id: coverage-exclusions
spec_content_hash: 281c8618464de784e1a66053efff1417c7718c4a096a4bf8d74ba8ccd0dbc242
---

## Files

- `packages/core/test/glob.test.ts` — the tests for AC-1 to AC-4
- `packages/core/test/config-exclude.test.ts` — the tests for AC-5 to AC-7
- `packages/core/test/exclusions-check.test.ts` — the tests for AC-8 to AC-13
- `packages/core/test/exclusions-report.test.ts` — the tests for AC-14 to AC-16
- `packages/core/test/exclusions-golden.test.ts` — the test for AC-17
- `packages/cli/test/exclude.test.ts` — the tests for AC-18 and AC-19
- `packages/action/test/exclude.test.ts` — the tests for AC-20 and AC-21

## Mapping

- AC-1 | unit | `packages/core/test/glob.test.ts` | packages/core/src/glob.ts#matchGlob(pattern: string, path: string): boolean, re-exported from packages/core/src/index.ts
- AC-2 | unit | `packages/core/test/glob.test.ts` | packages/core/src/config.ts#parseExcludePattern(pattern: string, label?: string): string (throws ConfigError), re-exported from packages/core/src/index.ts, with matchGlob
- AC-3 | unit | `packages/core/test/glob.test.ts` | packages/core/src/glob.ts#matchGlob(pattern: string, path: string): boolean
- AC-4 | unit | `packages/core/test/glob.test.ts` | packages/core/src/glob.ts#matchGlob(pattern: string, path: string): boolean
- AC-5 | unit | `packages/core/test/config-exclude.test.ts` | packages/core/src/config.ts#parseConfig(text: string): PharnConfig — coverage.exclude?: string[]
- AC-6 | unit | `packages/core/test/config-exclude.test.ts` | packages/core/src/config.ts#parseConfig(text: string): PharnConfig (throws ConfigError)
- AC-7 | unit | `packages/core/test/config-exclude.test.ts` | packages/core/src/config.ts#parseConfig(text: string): PharnConfig
- AC-8 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — with CheckInput.exclude?: readonly string[]
- AC-9 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — with CheckInput.exclude?: readonly string[]
- AC-10 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — with CheckInput.exclude?: readonly string[]
- AC-11 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — with CheckInput.exclude absent, [] and non-matching
- AC-12 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — agentSetup.files with exclude ["**"] vs none
- AC-13 | unit | `packages/core/test/exclusions-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report (throws ConfigError)
- AC-14 | unit | `packages/core/test/exclusions-report.test.ts` | schema/report.v1.json via packages/core/test/schema.ts#validateReport, and the schema's $defs.diffCoverage.required
- AC-15 | unit | `packages/core/test/exclusions-report.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string, reports from packages/core/src/report.ts#buildReport(input: BuildReportInput): Report
- AC-16 | unit | `packages/core/test/exclusions-report.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string, with fixtures/render/hostile-paths.json
- AC-17 | unit | `packages/core/test/exclusions-golden.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and renderMarkdown over fixtures/golden-exclusions/ (ci.yml via parseConfig), toMatchFileSnapshot report.json and report.md
- AC-18 | integration | `packages/cli/test/exclude.test.ts` | pharn-ci check --format json --exclude <glob> --exclude <glob> and pharn-ci --help, via packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number>
- AC-19 | integration | `packages/cli/test/exclude.test.ts` | pharn-ci check --exclude <rejected glob>, and a .pharn/ci.yml with a rejected coverage.exclude item, via packages/cli/src/main.ts#main(argv: string[], deps: CliDeps): Promise<number>
- AC-20 | integration | `packages/action/test/exclude.test.ts` | Action input exclude with .pharn/ci.yml coverage.exclude, via packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — written report.json and the diff-coverage output
- AC-21 | integration | `packages/action/test/exclude.test.ts` | Action input exclude holding a rejected glob, via packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> — setFailed message
