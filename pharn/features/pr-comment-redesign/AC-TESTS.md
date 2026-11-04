---
spec_id: pr-comment-redesign
spec_content_hash: f1652b61150a69b37bcac159a8f855c19c2b3d83532cc20d6ee3ee001b0b7f7f
---

## Files

- `packages/core/test/ac-comment-redesign-header.test.ts` — the tests for AC-1
- `packages/core/test/ac-comment-redesign-summary.test.ts` — the tests for AC-2
- `packages/core/test/ac-comment-redesign-collapse.test.ts` — the tests for AC-3
- `packages/core/test/ac-comment-redesign-footer.test.ts` — the tests for AC-4
- `packages/core/test/ac-comment-redesign-hostile.test.ts` — the tests for AC-5
- `packages/action/test/ac-comment-redesign-fit.test.ts` — the tests for AC-6

## Mapping

- AC-1 | unit | `packages/core/test/ac-comment-redesign-header.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — report from packages/core/src/check.ts#check(input: CheckInput): Report with version "0.1.0", coverage fixtures/golden/coverage.info (lcov), diff fixtures/golden/pr.diff, threshold 80, repoFiles fixtures/golden/files.txt; first non-empty line `## ❌ pharn-ci: fail`; the lines before `### Diff coverage` contain `fail`, `71.43%`, `80%` and `8 files`
- AC-2 | unit | `packages/core/test/ac-comment-redesign-summary.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — reports from packages/core/src/report.ts#buildReport(input: BuildReportInput): Report, each checked with expectValidReport: diffCoverage null; percent null; diffCoverage.threshold null with a percent; 0 and 1 agent setup files; the lines between the heading and `### Diff coverage` contain `not computed`, `no coverable lines`, `no threshold`, `none` and `1 file` respectively
- AC-3 | unit | `packages/core/test/ac-comment-redesign-collapse.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — a buildReport report with a threshold message, 30 diff coverage files and 30 agent setup files, then the same cut to 25 of each; line order heading, summary table, `### Diff coverage`, `### Messages`, `### Agent setup`; each table between a `<details>` line and its `</details>` line with a `<summary>` line containing `30`; no message line inside a `<details>` block; at 25 neither table inside one
- AC-4 | unit | `packages/core/test/ac-comment-redesign-footer.test.ts` | packages/core/src/render/logo.ts#logoMarkup(): string returns "" and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — over the golden report, the AC-2 edge reports and the AC-3 30-file report: last non-empty line a `<sub>` line containing `pharn-ci` then report.tool.version then `report schema v1`; no `<img`, no `![`, no `http://` or `https://`
- AC-5 | unit | `packages/core/test/ac-comment-redesign-hostile.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string — check() reports built from fixtures/render/hostile-paths.json (repoFiles with coverage.missingFile = coverageFile; and diff.unavailable carrying baseRef) and the benign variant markdown.test.ts uses; summary table present before `### Diff coverage` with `not computed` and `6 files` and equal to the benign one; no `<img` outside code spans; every table row has its header row's cell count (escaped pipes not counted); every message line inert (no live `](`, unescaped markdown character, `@` mention, `://` or `www.`)
- AC-6 | integration | `packages/action/test/ac-comment-redesign-fit.test.ts` | packages/action/src/run.ts#run(deps: ActionDeps): Promise<Report | undefined> with in-memory deps (pull_request event, comment "true", golden coverage and diff, 50 agent setup files with 2,000-character paths), body captured from api.createComment; exports COMMENT_MARKER, commentScopeLine(workflow: string, job: string): string, MAX_COMMENT_LENGTH; body at most 65,000 characters, starts with the marker and scope line, contains the heading, every summary-table line and every message line of renderMarkdown(report)
