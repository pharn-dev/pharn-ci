<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

## 🛡️ pharn-ci · ❌ Fail

> [!CAUTION]
> **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.

| Verdict | Diff coverage | Agent setup |
| --- | --- | --- |
| ❌ Fail | 71.43% (threshold 80%) | 8 files |

### 🧪 Diff coverage

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
  - Hint: Add tests that exercise the uncovered lines listed in the table above.
- ℹ️ `COVERAGE_PATHS_PARTIALLY_UNMATCHED` 1 file path in the coverage report is not a tracked file in the repository; its coverage is not used.
  - Hint: Nothing to do if those files are generated or outside the repo; if changed files are missing from the table, check the coverage root.

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

<sub>pharn-ci 0.1.0 · report schema v2 · coverage format cobertura</sub>
