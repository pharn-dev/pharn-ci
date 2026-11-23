<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/515998146a22a1886341d94236e4138e1777c13a/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

## 🛡️ pharn-ci · ❌ Fail

> [!CAUTION]
> **Fail** · Diff coverage was not computed; no agent setup files found.

| Verdict | Diff coverage | Test integrity | Agent setup |
| --- | --- | --- | --- |
| ❌ Fail | not computed | none (warn) | none |

### 🧪 Diff coverage

_Not computed — see messages below._

### 🔍 Test integrity

No test-integrity findings (mode: warn).

### 💬 Messages (2)

- ❌ `COVERAGE_FILE_MISSING` Coverage file not found: coverage/lcov.info
  - Hint: Check that a test step with coverage runs before this check and writes the file where it reads it (`coverage.file`, the `coverage-file` input or `--coverage`).
- ℹ️ `NO_AGENT_SETUP_FILES` No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.
  - Hint: Check whether the repository should have an agent instruction file, such as AGENTS.md or CLAUDE.md at its root, that tells agents how to build and test.

### 🤖 Agent setup (no files)

_No agent setup files found._

Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.

---

<sub>pharn-ci 0.1.0 · report schema v2</sub>
