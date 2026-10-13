## ❌ pharn-ci: fail

### Diff coverage

**71.43%** of changed lines covered (5/7, threshold 80%)

| File | Coverage | Covered | Uncovered lines |
| --- | ---: | ---: | --- |
| `src/new.ts` | 50% | 1/2 | 5 |
| `src/math.ts` | 75% | 3/4 | 10 |
| `src/utils/new-name.ts` | 100% | 1/1 |  |

### Agent setup

Agent setup: 8 files · claude-code, codex, copilot, cursor, mcp

| Path | Kind |
| --- | --- |
| `.claude/settings.json` | claude-settings |
| `.claude/skills/release/SKILL.md` | claude-skill |
| `.cursor/rules/style.mdc` | cursor-rules |
| `.github/copilot-instructions.md` | copilot-instructions |
| `.mcp.json` | mcp-config |
| `AGENTS.md` | agents-md |
| `CLAUDE.md` | claude-md |
| `packages/web/CLAUDE.md` | claude-md |

### Messages

- ❌ `DIFF_COVERAGE_BELOW_THRESHOLD` Diff coverage 71.43% is below the threshold of 80%.
  - Hint: Add tests that exercise the uncovered lines listed in the table above.
- ℹ️ `COVERAGE_PATHS_PARTIALLY_UNMATCHED` 1 file path in the coverage report is not a tracked file in the repository; its coverage is not used.
  - Hint: Nothing to do if those files are generated or outside the repo; if changed files are missing from the table, check the coverage root.

<sub>pharn-ci 0.1.0 · report schema v1</sub>
