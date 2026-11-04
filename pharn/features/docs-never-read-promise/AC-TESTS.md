---
spec_id: docs-never-read-promise
spec_content_hash: "21c174923c17d531c770dd268f8d6f00f1c1c0de7666d60e3358baf946503ef1"
---

## Files

- `packages/core/test/ac-never-read-docs.test.ts` — the tests for AC-1, AC-2, AC-3 and AC-4

## Mapping

- AC-1 | unit | `packages/core/test/ac-never-read-docs.test.ts` | SECURITY.md (repository root), the whole file read as UTF-8 text, matched case-insensitively against /never read/
- AC-2 | unit | `packages/core/test/ac-never-read-docs.test.ts` | SECURITY.md `## Data handling` table, the `|`-delimited row whose first cell contains "agent setup file paths and kinds"
- AC-3 | unit | `packages/core/test/ac-never-read-docs.test.ts` | SECURITY.md `## Data handling` table, the `|`-delimited row whose first cell names the text of the agent config, settings and instruction files
- AC-4 | unit | `packages/core/test/ac-never-read-docs.test.ts` | docs/MARKETPLACE.md, the whole file matched case-insensitively against /never read/, plus its `## Description` section
