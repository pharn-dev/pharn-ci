<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

## 🛡️ pharn-ci · ⚠️ Warn

> [!WARNING]
> **Warn** · Diff coverage was not computed; no agent setup files found.

| Verdict | Diff coverage | Test integrity | Agent setup | Policy |
| --- | --- | --- | --- | --- |
| ⚠️ Warn | not computed | none (warn) | none | ⚠️ 4 violations |

### 🧪 Diff coverage

_Not computed — see messages below._

### 🔍 Test integrity

No test-integrity findings (mode: warn).

### 📜 Policy

Org policy v3

- ⚠️ **P07** — 1 agent instruction file was not compared (binary, too large, past the read caps or an unsafe path)
  - Hint: Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.
- ⚠️ **P07** `AGENTS.md:3` — package manager: pnpm here, npm in CLAUDE.md:4
  - Hint: Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.
- ⚠️ **P07** `CLAUDE.md:4` — package manager: npm here, pnpm in AGENTS.md:3
  - Hint: Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.
- ⚠️ **P07** `packages/we'ird<!--\|x/AGENTS.md:2` — test runner: jest here, vitest in packages/web/AGENTS.md:2
  - Hint: Make the instruction files in one directory name the same package manager and test runner, or move a file into the package it describes; an agent follows whichever file it reads first.

### 💬 Messages (2)

- ⚠️ `COVERAGE_FILE_MISSING` Coverage file not found: coverage/lcov.info
  - Hint: Run the tests with coverage before pharn-ci, and check the path (`coverage.file`, `coverage-file` or `--coverage`).
- ℹ️ `NO_AGENT_SETUP_FILES` No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.
  - Hint: Add an AGENTS.md or CLAUDE.md at the repository root that tells agents how to build and test.

### 🤖 Agent setup (no files)

_No agent setup files found._

Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.

---

<sub>pharn-ci 0.4.0 · report schema v2</sub>
