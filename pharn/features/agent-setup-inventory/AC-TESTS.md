---
spec_id: agent-setup-inventory
spec_content_hash: fcf580fe5b5310ae1e48dfd5f7ab06254d1f5c76578465a09bfe301880196be9
---

## Files

- `packages/core/test/ac-setup-classify.test.ts` — the tests for AC-1, AC-2, AC-3, AC-4, AC-5 and AC-6
- `packages/core/test/ac-setup-rules.test.ts` — the tests for AC-7
- `packages/core/test/ac-setup-summary.test.ts` — the tests for AC-8, AC-9, AC-10 and AC-14
- `packages/core/test/ac-setup-render.test.ts` — the tests for AC-11, AC-12 and AC-13

## Mapping

- AC-1 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null
- AC-2 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null
- AC-3 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null
- AC-4 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null
- AC-5 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null, and SETUP_RULES: readonly { kind: AgentSetupKind; matches(path: string): boolean }[] (first matching rule decides)
- AC-6 | unit | `packages/core/test/ac-setup-classify.test.ts` | packages/core/src/setup/scan.ts#classifySetupPath(path: string): AgentSetupKind | null
- AC-7 | unit | `packages/core/test/ac-setup-rules.test.ts` | packages/core/src/setup/scan.ts#SETUP_RULES: readonly { kind: AgentSetupKind; matches(path: string): boolean }[] and scanAgentSetup(paths: readonly string[]): AgentSetupInventory, over fixtures/setup/all-kinds.txt (one path per line)
- AC-8 | unit | `packages/core/test/ac-setup-summary.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — report.agentSetup.summary, validated by packages/core/test/schema.ts#expectValidReport
- AC-9 | unit | `packages/core/test/ac-setup-summary.test.ts` | packages/core/src/setup/summary.ts#summarizeAgentSetup(files: readonly AgentSetupFile[]): AgentSetupSummary
- AC-10 | unit | `packages/core/test/ac-setup-summary.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string
- AC-11 | unit | `packages/core/test/ac-setup-render.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string on check() of the golden inputs, compared with fixtures/golden/report.md
- AC-12 | unit | `packages/core/test/ac-setup-render.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string on packages/core/src/report.ts#buildReport(input: BuildReportInput): Report
- AC-13 | unit | `packages/core/test/ac-setup-render.test.ts` | packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string on packages/core/src/report.ts#buildReport(input: BuildReportInput): Report
- AC-14 | unit | `packages/core/test/ac-setup-summary.test.ts` | schema/report.v1.json via packages/core/test/schema.ts#validateReport(report: unknown): boolean
