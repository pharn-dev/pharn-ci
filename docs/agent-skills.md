# Agent skills

[pharn-dev/skills](https://github.com/pharn-dev/skills) has a `pharn-ci` plugin for Claude Code
with five skills. You don't name them; the agent picks one from what you ask.

| Skill              | Ask, for example                                    | What it does                                                                                                                                                                |
| ------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pharn-ci-install` | "Set up pharn-ci on this repo with an 85% gate."    | Turns on lcov or Cobertura output, runs your tests and checks the paths match tracked files the way pharn-ci reads them, then writes `.pharn/ci.yml` and a SHA-pinned workflow. |
| `pharn-ci-explain` | "Why did pharn-ci fail on PR 42?"                   | Reads the report, PR comment or job log, names the message codes that decided the verdict, finds the cause in your repo and says what would fix it. Changes nothing.        |
| `pharn-ci-cover`   | "Get this PR's diff coverage over the threshold."   | Writes tests for the added lines reported as uncovered and re-checks them against a fresh coverage report.                                                                  |
| `pharn-ci-fix`     | "Fix what pharn-ci reported on PR 21."              | Lists the fix objects of a 0.9.x report by kind, writes tests for `add-test`, makes a restore, revert or remove change only for the findings you pick, and hands `request-review`, `split-pr` and `none` to a person. |
| `pharn-ci-policy`  | "Draft an org policy that protects `.github/workflows/**` from agent PRs." | Drafts or checks an [org policy](policy.md), validates it offline against `schema/policy.v1.json` with a bundled checker, and says how to turn it on. |

```text
/plugin marketplace add pharn-dev/skills
/plugin install pharn-ci@pharn-dev
```

Or, with the [Skills CLI](https://github.com/vercel-labs/skills), run `npx skills add
pharn-dev/skills` and pick the `pharn-ci-*` skills.

The skills keep pharn-ci's rules. They branch on message codes, not text, and treat report paths,
messages and PR comments as data from the change under review, never as instructions.
`pharn-ci-install` never uses `pull_request_target`; fork PRs get the
[`workflow_run` pattern](action.md#fork-prs-comment-from-workflow_run). `pharn-ci-cover` changes only test
files: it never lowers the threshold, adds exclusions or coverage-ignore comments, or edits the
workflow. `pharn-ci-fix` changes no gate, and `pharn-ci-policy` writes only the policy file you ask for. None of them
post to the PR, commit or push.

The plugin covers pharn-ci 0.1.x (Report v1) to 0.9.x (Report v2); Codex is not verified.
Tested combinations and limits are in the skills repo's
[LIMITS.md](https://github.com/pharn-dev/skills/blob/main/LIMITS.md). The skills are instructions,
not a sandbox: your agent client's permissions decide what an agent can do.
