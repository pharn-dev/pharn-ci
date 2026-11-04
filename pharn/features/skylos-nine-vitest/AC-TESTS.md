---
spec_id: skylos-nine-vitest
spec_content_hash: 8d82e785c11ef5ab12637d03353475aaa1151401d7fa681b2ed920d89981de94
---

## Files

- `packages/core/test/ac-skylos-nine-deleted-test.test.ts` — the tests for AC-1
- `packages/core/test/ac-skylos-nine-added-skip.test.ts` — the tests for AC-2
- `packages/core/test/ac-skylos-nine-misses.test.ts` — the tests for AC-3
- `packages/core/test/ac-skylos-nine-table.test.ts` — the tests for AC-4
- `packages/core/test/ac-skylos-nine-fixtures.test.ts` — the tests for AC-5
- `packages/core/test/ac-skylos-nine-diffs.test.ts` — the tests for AC-6

## Mapping

- AC-1 | unit | `packages/core/test/ac-skylos-nine-deleted-test.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string, over fixtures/skylos-nine/deleted-test/{change.diff,files.txt} read with packages/core/test/helpers.ts#fixture(path: string): string
- AC-2 | unit | `packages/core/test/ac-skylos-nine-added-skip.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string, over fixtures/skylos-nine/added-skip/{change.diff,files.txt}
- AC-3 | unit | `packages/core/test/ac-skylos-nine-misses.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report and packages/core/src/render/markdown.ts#renderMarkdown(report: Report, options?: RenderMarkdownOptions): string, over the seven miss cases under fixtures/skylos-nine/
- AC-4 | unit | `packages/core/test/ac-skylos-nine-table.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report over all nine cases under fixtures/skylos-nine/, with the case table defined in the test file
- AC-5 | unit | `packages/core/test/ac-skylos-nine-fixtures.test.ts` | the fixture directory fixtures/skylos-nine/ (listed with node:fs readdirSync, files read with packages/core/test/helpers.ts#fixture(path: string): string)
- AC-6 | unit | `packages/core/test/ac-skylos-nine-diffs.test.ts` | the seven miss cases' fixtures/skylos-nine/<case>/change.diff (and files.txt for replaced-test), read with packages/core/test/helpers.ts#fixture(path: string): string
