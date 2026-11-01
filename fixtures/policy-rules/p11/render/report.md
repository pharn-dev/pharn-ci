<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">

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
  - Hint: Revert the edit, or ask the policy owner to make it; a pull request cannot loosen the check it is graded by.
- ❌ **P11** — policy file edited and unreadable at the merge base; protected paths could not be checked
  - Hint: Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.
- ❌ **P11** `.github/workflows/ci.yml` — agent PR changes a protected path
  - Hint: Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.
- ❌ **P11** `src/we'ird<!--\|x.ts` — agent PR changes a protected path
  - Hint: Agent PRs may not change these paths under the org policy. Move the change to a pull request by a person, or ask the policy owner to change `agents.protected_paths`.

### 💬 Messages (4)

- ⚠️ `COVERAGE_FILE_MISSING` Coverage file not found: coverage/lcov.info
  - Hint: Run the tests with coverage before pharn-ci, and check the path (`coverage.file`, `coverage-file` or `--coverage`).
- ⚠️ `CONFIG_CHANGED_IN_DIFF` This change edits files that configure this check: \`.github/workflows/ci.yml\`. Review them before trusting the verdict.
  - Hint: Review the config and workflow changes before trusting the verdict; protect `.pharn/ci.yml` and `.github/workflows/` with CODEOWNERS.
- ℹ️ `NO_AGENT_SETUP_FILES` No agent setup files (CLAUDE.md, AGENTS.md, .cursor/rules, ...) were found.
  - Hint: Add an AGENTS.md or CLAUDE.md at the repository root that tells agents how to build and test.
- ⚠️ `AGENT_PR_DETECTION_INCOMPLETE` This pull request counts as an agent PR because pharn-ci could not read all of its evidence (\`commits-unreadable\`), so the org policy's protected paths apply to it.
  - Hint: Re-run the job if the GitHub API failed. A pull request with more than 250 commits, an author GitHub does not name, or an edited policy file whose base cannot be read always counts as an agent PR.

### 🤖 Agent setup (no files)

_No agent setup files found._

Missing: an agent instructions file, typically `AGENTS.md` or `CLAUDE.md` at the repository root.

---

<sub>pharn-ci 0.3.0 · report schema v2</sub>
