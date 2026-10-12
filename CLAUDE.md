@AGENTS.md

## Additional notes for Claude Code

- Run a single test file or test: `pnpm vitest run packages/core/test/lcov.test.ts` or `pnpm vitest run -t "name substring"`. Tests resolve `@pharn-ci/core` to source, so no build is needed first.
- Data flow: CLI and action gather inputs (coverage text, diff text, `git ls-files`, config) and call `check()` in `packages/core/src/check.ts`. It returns a Report v1, and `render/markdown.ts` turns that into the PR comment or summary. A missing or empty coverage file, or an unavailable diff, yields a report with a `missing` reason instead of throwing.
- Coverage formats live in `packages/core/src/coverage/` (lcov, cobertura) behind `parseCoverage()`. Add new formats there.
- `.claude/commands/pharn-*.md` and the untracked `pharn/`, `pharn.config.json` and `pharn.records.json` belong to the PHARN workflow tooling, not to the product. Do not treat them as part of pharn-ci.
