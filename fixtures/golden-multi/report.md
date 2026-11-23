<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/515998146a22a1886341d94236e4138e1777c13a/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

## 🛡️ pharn-ci · ❌ Fail

> [!CAUTION]
> **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.

| Verdict | Diff coverage | Test integrity | Agent setup |
| --- | --- | --- | --- |
| ❌ Fail | 71.43% (threshold 80%) | none (warn) | 8 files |

### 🧪 Diff coverage

`▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱` 71.43%

**71.43%** of changed lines covered (5/7, threshold 80%)

<details open>
<summary>Changed files (3)</summary>

| File | Coverage | Covered | Uncovered lines |
| --- | ---: | ---: | --- |
| `src/new.ts` | 50% | 1/2 | 5 |
| `src/math.ts` | 75% | 3/4 | 10 |
| `src/utils/new-name.ts` | 100% | 1/1 |  |

</details>

### 🔍 Test integrity

No test-integrity findings (mode: warn).

### 💬 Messages (2)

- ❌ `DIFF_COVERAGE_BELOW_THRESHOLD` Diff coverage 71.43% is below the threshold of 80%.
  - Hint: Add tests that run the changed lines listed in the report.
- ℹ️ `COVERAGE_PATHS_PARTIALLY_UNMATCHED` 1 file path in the coverage report is not a tracked file in the repository; its coverage is not used.
  - Hint: Check that the coverage paths start at the repository root so every file is matched.

### 🤖 Agent setup (8 files)

Agent setup: 8 files · amp, claude-code, codex, copilot, cursor, jules, mcp, opencode, zed

<details>
<summary>Agent setup files (8)</summary>

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

</details>

---

<sub>pharn-ci 0.1.0 · report schema v2 · coverage format lcov</sub>
