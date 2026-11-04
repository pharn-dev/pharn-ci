---
spec_id: pr-comment-redesign-2
spec_content_hash: 41dbaff389d1e28ee45db56e21d106c4d660802fa7eecf8b84eb5679a522288f
---

## Files

- `packages/core/test/ac-comment-look-header.test.ts` — the tests for AC-1
- `packages/core/test/ac-comment-look-summary.test.ts` — the tests for AC-2
- `packages/core/test/ac-comment-look-collapse.test.ts` — the tests for AC-3
- `packages/core/test/ac-comment-look-footer.test.ts` — the tests for AC-4
- `packages/core/test/ac-comment-look-hostile.test.ts` — the tests for AC-5
- `packages/action/test/ac-comment-look-fit.test.ts` — the tests for AC-6
- `packages/core/test/ac-comment-look-data.test.ts` — the tests for AC-7

## Mapping

- AC-1 | unit | `packages/core/test/ac-comment-look-header.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — report from packages/core/src/check.ts#check(input: CheckInput): Report with version "0.1.0", coverage fixtures/golden/coverage.info (lcov), diff fixtures/golden/pr.diff, repoRoot "/home/runner/work/demo/demo", threshold 80, repoFiles fixtures/golden/files.txt; first non-empty line `## ❌ pharn-ci: fail`; the lines before `### Diff coverage` contain `fail`, `71.43%`, `80%` and `8 files`
- AC-2 | unit | `packages/core/test/ac-comment-look-summary.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — reports from packages/core/src/report.ts#buildReport(input: BuildReportInput): Report, each checked with expectValidReport: diffCoverage null; percent null; threshold and diffCoverage.threshold null with a percent; 0 and 1 agent setup files; the lines between the heading and `### Diff coverage` contain `not computed`, `no coverable lines`, `no threshold`, `none` and `1 file` respectively
- AC-3 | unit | `packages/core/test/ac-comment-look-collapse.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — a buildReport report with a below-threshold message, 30 diff coverage files and 30 agent setup files, then the same cut to 25 of each; line order heading, summary table, `### Diff coverage`, `### Messages`, `### Agent setup`; each table between a `<details>` line and its `</details>` line with a `<summary>` line containing `30`; no message line inside a `<details>` block; at 25 neither table inside one
- AC-4 | unit | `packages/core/test/ac-comment-look-footer.test.ts` | packages/core/src/render/logo.ts#logoMarkup(): string returns "" and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — over the AC-1 golden report, the AC-2 edge reports and the AC-3 30-file report: lines before `### Diff coverage` are only the heading and the summary table; last non-empty line a `<sub>` line containing `pharn-ci` then report.tool.version then `report schema v1`; no `<img`, no `![`, no `http://` or `https://`
- AC-5 | unit | `packages/core/test/ac-comment-look-hostile.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — check() reports built from fixtures/render/hostile-paths.json (repoFiles with coverage.missingFile = coverageFile; and diff.unavailable carrying baseRef) and the benign variant markdown.test.ts uses; summary table before `### Diff coverage` showing `not computed` and `6 files`, equal to the benign one; no `<img` outside code spans; every table row has its header row's cell count (escaped pipes not counted); every message line inert (no live `](`, unescaped markdown character, `@` mention, `://` or `www.`)
- AC-6 | integration | `packages/action/test/ac-comment-look-fit.test.ts` | packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> with in-memory deps (pull_request event, comment "true", golden coverage and diff, 50 agent setup files with 2,000-character paths), body captured from api.createComment; exports COMMENT_MARKER, commentScopeLine(workflow: string, job: string): string, MAX_COMMENT_LENGTH; body at most 65,000 characters, starts with the marker, scope line and verdict heading, contains every summary-table line and every message line of renderMarkdown(report)
- AC-7 | unit | `packages/core/test/ac-comment-look-data.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report on the AC-1 golden inputs, deep-equal to JSON.parse of fixtures/golden/report.json and valid by expectValidReport; and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string of that report shows its percent, threshold and setup count in the summary table before `### Diff coverage`
