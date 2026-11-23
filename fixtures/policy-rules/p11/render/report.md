<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/515998146a22a1886341d94236e4138e1777c13a/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

## 🛡️ pharn-ci · ❌ Fail

> [!CAUTION]
> **Fail** · Diff coverage was not computed; no agent setup files found.

| Verdict | Diff coverage | Test integrity | Agent setup | Policy |
| --- | --- | --- | --- | --- |
| ❌ Fail | not computed | none (warn) | none | ❌ 4 violations, 4 blocking |

### 🧪 Diff coverage

_Not computed — see messages below._

### 🔍 Test integrity

No test-integrity findings (mode: warn).

### 📜 Policy

Policy file — the pull request can edit this file, so it can only tighten the check

- ❌ **P09** `.pharn/policy.json` — this change edits the policy file it is checked against
  - Hint: Revert the edit to the file the org policy guards.
- ❌ **P11** — policy file edited and unreadable at the merge base; protected paths could not be checked
  - Hint: Ask a person to review or make the change to the paths the org policy protects from agent pull requests.
- ❌ **P11** `.github/workflows/ci.yml` — agent PR changes a protected path
  - Hint: Ask a person to review or make the change to the paths the org policy protects from agent pull requests.
- ❌ **P11** `src/we'ird<!--\|x.ts` — agent PR changes a protected path
  - Hint: Ask a person to review or make the change to the paths the org policy protects from agent pull requests.

### 💬 Messages (4)

- ⚠️ `COVERAGE_FILE_MISSING` Coverage file not found: coverage/lcov.info
  - Hint: Check that the test step writes the coverage file where the check reads it.
- ⚠️ `CONFIG_CHANGED_IN_DIFF` This change edits files that configure this check: \`.github/workflows/ci.yml\`. Review them before trusting the verdict.
  - Hint: Ask a reviewer to confirm that the change to the files that configure this check is meant.
- ℹ️ `NO_AGENT_SETUP_FILES` No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.
  - Hint: Check whether the repository should have an agent instruction file such as AGENTS.md.
- ⚠️ `AGENT_PR_DETECTION_INCOMPLETE` This pull request counts as an agent PR because pharn-ci could not read all of its evidence (\`commits-unreadable\`), so the org policy's protected paths apply to it.
  - Hint: Check that the token can read the pull request, its labels and its commits.

### 🤖 Agent setup (no files)

_No agent setup files found._

Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.

---

<sub>pharn-ci 0.3.0 · report schema v2</sub>
