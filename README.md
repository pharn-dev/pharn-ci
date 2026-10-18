<div align="center">

<img alt="pharn-ci" src="./docs/assets/pharn-ci-logo.svg" width="110" />

# pharn-ci

**Know whether AI coding agents can safely work in your repo.**

A GitHub Action and CLI that checks every pull request for the two things an agent-written change
leans on most: tests that actually run the new code, and the setup files that tell agents how to
behave. AI-agnostic, fully stateless, no telemetry.

```yaml
- uses: pharn-dev/pharn-ci@v0.1.0
  with:
    coverage-file: coverage/lcov.info
    threshold: 80
```

[![CI](https://github.com/pharn-dev/pharn-ci/actions/workflows/ci.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pharn-dev/pharn-ci/actions/workflows/codeql.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/codeql.yml)
[![Secrets](https://github.com/pharn-dev/pharn-ci/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/gitleaks.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](./package.json)
[![Part of Pharn](https://img.shields.io/badge/part%20of-Pharn-609AA4)](https://pharn.dev)

</div>

> **Status:** pre-1.0 and not yet released. The first release will be `v0.1.0`; until it is cut,
> the snippet above will not resolve. Report v1 is stable. Before 1.0, inputs, outputs and message
> codes are never removed, and a renamed input keeps working under its old name, with a warning, for
> at least one minor release; defaults change only in a minor release and the changelog says so. The
> comment layout may change in any release ([versioning policy](docs/RELEASING.md#inputs-outputs-and-message-codes)).

---

## Contents

- [What pharn-ci is](#what-pharn-ci-is)
- [Why it exists](#why-it-exists)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Example PR comment](#example-pr-comment)
- [Action reference](#action-reference)
- [CLI](#cli)
- [Config](#config)
- [Report v1](#report-v1)
- [What it proves, and what it does not](#what-it-proves-and-what-it-does-not)
- [Safety model](#safety-model)
- [The Pharn family](#the-pharn-family)
- [Roadmap](#roadmap)
- [Development](#development)
- [Contributing and security](#contributing-and-security)
- [License](#license)

---

## What pharn-ci is

pharn-ci runs in your CI on every pull request and reports:

- **Diff coverage**: the share of lines **added** in the PR that your tests execute, with an
  optional threshold gate. It reads the lcov or Cobertura XML file your own test run already writes
  (Clover and JaCoCo native XML are not supported).
- **Agent setup inventory**: which agent setup files the repo carries (`CLAUDE.md`, `AGENTS.md`,
  `GEMINI.md`, `.claude/` files, MCP configs, and the files of Cursor, Copilot, Codex, Windsurf,
  Cline, Aider, Continue, Roo Code, Amazon Q Developer, Junie, Zed, Augment, Kiro, Goose, OpenCode
  and Gemini CLI; see the table below), with a summary of how many there are and which tools they
  configure.

| Kind                          | Matches                                                                                        | Tools                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `claude-md`                   | `CLAUDE.md`, any directory                                                                     | claude-code                                       |
| `claude-local-md`             | `CLAUDE.local.md`, any directory                                                               | claude-code                                       |
| `agents-md`                   | `AGENTS.md`, any directory                                                                     | amp, codex, copilot, cursor, jules, opencode, zed |
| `gemini-md`                   | `GEMINI.md`, any directory                                                                     | gemini                                            |
| `claude-settings`             | `.claude/settings.json`, any directory                                                         | claude-code                                       |
| `claude-settings-local`       | `.claude/settings.local.json`, any directory                                                   | claude-code                                       |
| `claude-skill`                | files under `.claude/skills/`, any directory                                                   | claude-code                                       |
| `claude-hook`                 | files under `.claude/hooks/`, any directory                                                    | claude-code                                       |
| `claude-agent`                | files under `.claude/agents/`, any directory                                                   | claude-code                                       |
| `claude-command`              | files under `.claude/commands/`, any directory                                                 | claude-code                                       |
| `claude-rule`                 | files under `.claude/rules/`, any directory                                                    | claude-code                                       |
| `cursor-rules`                | files under `.cursor/rules/` (any directory), `.cursorrules`                                   | cursor                                            |
| `cursor-mcp`                  | `.cursor/mcp.json`, repo root                                                                  | cursor, mcp                                       |
| `copilot-instructions`        | `.github/copilot-instructions.md`                                                              | copilot                                           |
| `copilot-instructions-scoped` | `.github/instructions/**/*.instructions.md`                                                    | copilot                                           |
| `copilot-agents`              | files under `.github/agents/`                                                                  | copilot                                           |
| `copilot-prompts`             | files under `.github/prompts/`                                                                 | copilot                                           |
| `vscode-mcp`                  | `.vscode/mcp.json`, repo root                                                                  | copilot, mcp                                      |
| `codex-config`                | `.codex/config.toml`, repo root                                                                | codex                                             |
| `windsurf-rules`              | `.windsurfrules`, files under `.windsurf/rules/`                                               | windsurf                                          |
| `cline-rules`                 | `.clinerules` (file or directory)                                                              | cline                                             |
| `mcp-config`                  | `.mcp.json`, any directory                                                                     | mcp                                               |
| `aider-config`                | `.aider.conf.yml`, repo root                                                                   | aider                                             |
| `conventions-md`              | `CONVENTIONS.md`, repo root                                                                    | aider                                             |
| `continue-rules`              | files under `.continue/rules/`, `.continuerules`, repo root                                    | continue                                          |
| `roo-rules`                   | `.roorules`, `.roorules-<mode>`, files under `.roo/rules/` and `.roo/rules-<mode>/`, repo root | roo                                               |
| `amazonq-rules`               | files under `.amazonq/rules/`, repo root                                                       | amazon-q                                          |
| `junie-guidelines`            | `.junie/guidelines.md`, repo root                                                              | junie                                             |
| `zed-rules`                   | `.rules`, repo root                                                                            | zed                                               |
| `augment-rules`               | files under `.augment/rules/`, `.augment-guidelines`, repo root                                | augment                                           |
| `kiro-steering`               | files under `.kiro/steering/`, repo root                                                       | kiro                                              |
| `goosehints`                  | `.goosehints`, any directory                                                                   | goose                                             |
| `opencode-config`             | `opencode.json`, `opencode.jsonc`, repo root                                                   | opencode                                          |
| `gemini-settings`             | `.gemini/settings.json`, repo root                                                             | gemini                                            |

It is **AI-agnostic**: it looks at your code, tests and setup files, never at which tool wrote the
code. Claude Code, Cursor, Copilot, Codex and hand-written changes are measured the same way.

The output is one sticky PR comment, the job summary, a pass/warn/fail verdict, and a JSON report
with a published schema that agents and scripts can read.

---

## Why it exists

Agents write diffs faster than people can review them. Review time does not scale with them, so
the cheap, mechanical questions should be answered before a person opens the PR:

- Did the tests run the code this change added, or only the code that was already there?
- Does the repo tell agents how to work in it at all, and where?
- Can a script or another agent read the answer without parsing prose?

pharn-ci answers those on every PR, with numbers and stable message codes rather than judgment. It
is a floor, not a verdict on quality: it says what was measured and, just as plainly, what was not
([What it proves](#what-it-proves-and-what-it-does-not)).

---

## Quick start

Add a workflow that runs your tests with lcov or Cobertura XML output, then pharn-ci:

```yaml
# .github/workflows/pharn-ci.yml
name: pharn-ci
on: pull_request

permissions:
  contents: read
  pull-requests: write

# One run per PR at a time, so concurrent pushes do not race on the sticky comment.
concurrency:
  group: pharn-ci-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  pharn-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      # ...set up your toolchain and run tests with lcov or Cobertura output, e.g.:
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.1.0 # or, better, the tag's full commit SHA
        timeout-minutes: 5
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
```

`fetch-depth: 0` lets pharn-ci diff against the PR base locally. Without a threshold, pharn-ci
reports and never fails the step. With a merge queue, add `merge_group` to `on:`; pharn-ci diffs
the queued change against the queue's base (`merge_group.base_sha`). The `concurrency` group
cancels an older run when a new commit is pushed; without it, two runs that each post the sticky
comment are cleaned up to one, but the older run may write last.

Each GitHub API request pharn-ci makes is aborted after 30 s, and a 5xx, a network error or a rate
limit that asks for at most 60 s is retried once; each `git` call is killed after 2 minutes. A run
makes a handful of requests, so `timeout-minutes: 5` on the step bounds even a slow GitHub without
cutting a normal run short; without it, a stuck step runs until the job's 6-hour limit.

Release tags are exact versions (`v0.1.0`), never moved or deleted, but they are unsigned
lightweight tags, so there is no tag signature to verify. Pinning the tag's full commit SHA is the
integrity control; Dependabot keeps either up to date.

---

## How it works

```mermaid
flowchart LR
    DIFF["PR diff<br/>(git, or GitHub API)"] --> CORE
    LCOV["lcov or Cobertura file<br/>(from your test run)"] --> CORE
    FILES["tracked files<br/>(git ls-files)"] --> CORE
    CFG[".pharn/ci.yml<br/>+ inputs / flags"] --> CORE
    CORE["core check()<br/>pure: no I/O"] --> REPORT["Report v1<br/>JSON, schema-validated"]
    REPORT --> COMMENT["sticky PR comment"]
    REPORT --> SUMMARY["job summary"]
    REPORT --> EXIT["verdict + exit code"]
```

| Step     | What happens                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Gather   | The Action or CLI reads the coverage file, the diff against the base, the tracked file list and the config. All I/O happens here.          |
| Measure  | `packages/core` matches added lines against the lines the coverage report knows, and classifies agent setup files. Pure functions only.     |
| Report   | Core builds a Report v1 object. Every report produced in tests is validated against `schema/report.v1.json`.                                |
| Render   | The comment, job summary and CLI text are renderings of that report, never a separate source of truth.                                     |

---

## Example PR comment

> ## ❌ pharn-ci: fail
>
> ### Diff coverage
>
> **71.43%** of changed lines covered (5/7, threshold 80%)
>
> | File | Coverage | Covered | Uncovered lines |
> | --- | ---: | ---: | --- |
> | `src/math.ts` | 75% | 3/4 | 10 |
> | `src/new.ts` | 50% | 1/2 | 5 |
> | `src/utils/new-name.ts` | 100% | 1/1 |  |
>
> ### Messages
>
> - ❌ `DIFF_COVERAGE_BELOW_THRESHOLD` Diff coverage 71.43% is below the threshold of 80%.
>
> ### Agent setup
>
> Agent setup: 3 files · amp, claude-code, codex, copilot, cursor, jules, opencode, zed
>
> | Path | Kind |
> | --- | --- |
> | `.claude/settings.json` | claude-settings |
> | `AGENTS.md` | agents-md |
> | `CLAUDE.md` | claude-md |

On PRs from forks the token cannot comment; pharn-ci then warns and uses the job summary only.

Each workflow and job keeps its own comment, marked by a hidden `<!-- pharn-ci scope: <workflow>/<job> -->`
line. Matrix legs of one job share that scope, and so one comment.

---

## Action reference

| Input               | Default                     |                                          |
| ------------------- | --------------------------- | ---------------------------------------- |
| `coverage-file`     | `coverage.file` from config | Path to the coverage report              |
| `coverage-format`   | `coverage.format`, then `auto` | `lcov`, `cobertura` or `auto` (detect it from the start of the file) |
| `coverage-root`     | `coverage.root`, then the repo root | Directory relative coverage paths start from, e.g. `packages/core` in a monorepo |
| `threshold`         | `coverage.threshold` from config, then none | Minimum diff coverage %, inclusive       |
| `base-ref`          | PR base; merge queue base; on `push`, the previous head (`before`) | Ref or SHA to diff against. A `base-ref` found neither in the checkout nor through the GitHub API fails the step |
| `pr-number`         | none                        | Pull request to measure when the event has no `pull_request` payload (`workflow_run`, `workflow_dispatch`). The PR, its diff and its file list come from the GitHub API and no PR code is checked out. See [Fork PRs](#fork-prs-comment-from-workflow_run) |
| `head-sha`          | none                        | Commit SHA the PR head must be; the step fails otherwise. Set it to `${{ github.event.workflow_run.head_sha }}`. Only valid with `pr-number` |
| `exclude`           | none                        | Globs of changed files to leave out of diff coverage, comma or newline separated; added to `coverage.exclude` |
| `require-agent-setup` | `setup.require`, then `false` | Fail when the repo has no agent setup files; the step fails through `fail-on-threshold` |
| `comment`           | `true`                      | Post/update one sticky PR comment per workflow and job |
| `fail-on-threshold` | `true`                      | Fail the step when the verdict is `fail` |
| `config`            | `.pharn/ci.yml`, may be absent | Config file path; a file named here that does not exist fails the step |
| `github-token`      | `github.token`              | Token for the comment and diff fallback; `pull-requests: write` only for the comment, may be empty with `comment: false` and a local diff |

| Output          |                                                       |
| --------------- | ----------------------------------------------------- |
| `report-path`   | Path to `report.json` (Report v1)                     |
| `verdict`       | `pass`, `warn` or `fail`                              |
| `diff-coverage` | Diff coverage percent, or empty when not computed     |

### Fork PRs: comment from workflow_run

On a PR from a fork the `pull_request` token is read-only, so pharn-ci can only write the job
summary. To get the sticky comment on fork PRs without ever running PR code with a write token,
split the work in two workflows. Do not use `pull_request_target` for this: it checks out the base
branch with a write token, and checking out the PR head there would run fork code with that token.

The first workflow runs on `pull_request` with a read-only token, runs your tests and uploads the
coverage file together with the PR number:

```yaml
# .github/workflows/pharn-ci.yml
name: pharn-ci
on: pull_request

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      # ...set up your toolchain and run tests with lcov or Cobertura output, e.g.:
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.1.0 # or, better, the tag's full commit SHA
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
          comment: false
      - env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: echo "$PR_NUMBER" > pr-number
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: pharn-ci-input
          path: |
            coverage/lcov.info
            pr-number
```

The second workflow runs on `workflow_run` in the context of your default branch, with a token that
can comment. It downloads the artifact into the runner's temp directory and never executes it:

```yaml
# .github/workflows/pharn-ci-comment.yml
name: pharn-ci comment
on:
  workflow_run:
    workflows: [pharn-ci]
    types: [completed]

permissions:
  contents: read
  pull-requests: write
  actions: read

jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      # The default branch: your trusted config and .pharn/ci.yml, never the PR.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: pharn-ci-input
          path: ${{ runner.temp }}/pharn-ci-input
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      # Keep digits only. The artifact is attacker-controlled: never put its text into a script.
      - id: pr
        env:
          PR_FILE: ${{ runner.temp }}/pharn-ci-input/pr-number
        run: echo "number=$(tr -dc '0-9' < "$PR_FILE" | head -c 10)" >> "$GITHUB_OUTPUT"
      - uses: pharn-dev/pharn-ci@v0.1.0 # or, better, the tag's full commit SHA
        with:
          coverage-file: ${{ runner.temp }}/pharn-ci-input/coverage/lcov.info
          pr-number: ${{ steps.pr.outputs.number }}
          head-sha: ${{ github.event.workflow_run.head_sha }}
          fail-on-threshold: false # the first workflow already gates
```

The artifact comes from the fork and is attacker-controlled, so pharn-ci treats `pr-number` and the
coverage file as untrusted. It checks that `pr-number` is a plain number, reads the PR's base and
head through the GitHub API, and fails the step when `head-sha` (the tested commit, from the trusted
`workflow_run` event) is not the PR's head. The diff and the file list also come from the API; no
PR code is checked out or run. What it cannot check is that the coverage file is what the tests
produced: a fork can upload a coverage file that flatters its own PR. The comment reports what the
`pull_request` run uploaded, and that run's verdict is the gate.

---

## CLI

```bash
pnpm install && pnpm build
node packages/cli/dist/index.js check --coverage coverage/lcov.info --threshold 80
```

```text
pharn-ci check [--coverage <file>] [--coverage-format lcov|cobertura|auto] [--coverage-root <dir>]
               [--base <ref>] [--threshold <n>] [--format md|json] [--config <path>]
               [--exclude <glob>]... [--require-agent-setup] [-h|--help] [-v|--version]
```

- `--coverage-root <dir>` is the directory that relative coverage paths start from, for a
  package-relative report in a monorepo (`SF:src/a.ts` with `--coverage-root packages/core` is
  `packages/core/src/a.ts`). The flag wins over `coverage.root`, which wins over none (the repo
  root). The value is repo-relative: no `..`, not absolute, not starting with `-`. Absolute
  coverage paths are never remapped ([`docs/LIMITS.md`](docs/LIMITS.md), section 7).
- `--coverage-format` defaults to `coverage.format` from the config, then `auto`, which reads lcov
  or Cobertura XML from the start of the file. The chosen format is printed on stderr, for example
  `coverage: cobertura (auto-detected)`.
- `--base` defaults to `origin/main`; the diff is `git diff --unified=0 <base>...HEAD`.
- `--exclude <glob>` leaves matching changed files out of diff coverage. Repeat it for several
  patterns; they are added to `coverage.exclude`, never replacing it
  ([Excluding files](#excluding-files)).
- `--require-agent-setup` fails the check (exit `1`) when the repo has no agent setup files. Absent,
  `setup.require` from the config decides, then off. The flag cannot turn off a requirement the
  config turns on.
- `--format json` prints only the report to stdout, for agents and scripts.
- Exit codes: `0` pass or warn, `1` fail, `2` usage or runtime error.

The CLI is not published to npm yet; build it from source.

---

## Config

`.pharn/ci.yml` (CLI flags and Action inputs override it):

```yaml
coverage:
  file: coverage/lcov.info
  format: auto # lcov, cobertura or auto (the default)
  threshold: 80
  exclude:
    - src/generated/**
    - "*.gen.ts"
  # root: packages/core # directory relative coverage paths start from (monorepo); default: the repo root
setup:
  require: false # true fails the check when the repo has no agent setup files
```

### Excluding files

Generated code, vendored files and the like can be left out of diff coverage with glob patterns.
Patterns come from three sources that are **merged** (a union, never an override):
`coverage.exclude` in `.pharn/ci.yml`, the CLI's `--exclude` flags and the Action's `exclude` input.

- The glob subset is `*` (any run of characters within one path segment), `**` as a whole segment
  (any number of segments, including none) and `?` (one character). Patterns are anchored at the
  repository root, must match the whole path, and are case-sensitive. Braces, `[...]` classes,
  negation (`!`) and backslashes are rejected with an error rather than guessed at.
- A pattern that starts with `*` must be quoted in YAML (`"*.gen.ts"`).
- The list can also be written on one line: `exclude: ["dist/**", "*.gen.ts"]`. Longer lists read
  better as a block list (one `- pattern` line each).
- Only changed files are affected. Excluded files count nowhere in diff coverage; they are listed
  under `diffCoverage.excludedFiles` in the report and in an "Excluded" summary in the comment.
- The agent setup inventory is not affected by exclusions.
- Exclusions come from the PR itself, so a PR can exclude its own files. Protect `.pharn/ci.yml` (and
  your workflow file) with CODEOWNERS.

---

## Report v1

The JSON report is the stable, machine-readable API; the comment and CLI text are renderings of
it. See [`schema/report.v1.json`](schema/report.v1.json). Branch on message `code`s, not on text:

| Code                            | Meaning                                                        |
| ------------------------------- | -------------------------------------------------------------- |
| `DIFF_COVERAGE_BELOW_THRESHOLD` | Diff coverage is below the configured threshold                |
| `DIFF_COVERAGE_UNGATED`         | Diff coverage was measured but not gated (no threshold, or 0); info |
| `NO_COVERABLE_CHANGES`          | None of the added lines are tracked by the coverage report     |
| `COVERAGE_FILE_MISSING`         | The coverage file does not exist                               |
| `COVERAGE_FILE_EMPTY`           | The coverage file has no usable records                        |
| `COVERAGE_FORMAT_UNSUPPORTED`   | The coverage file is not lcov or Cobertura XML (format `auto`) |
| `DIFF_UNAVAILABLE`              | No diff could be produced, so diff coverage was not computed   |
| `COVERAGE_PATHS_UNMATCHED`      | None of the coverage report's file paths is a tracked file, so diff coverage was not computed |
| `COVERAGE_PATHS_PARTIALLY_UNMATCHED` | Some coverage paths are not tracked files; their coverage is not used (`info`) |
| `NO_AGENT_SETUP_FILES`          | The repo has none of the agent setup files pharn-ci looks for  |

Within v1, fields are only added and codes are never renamed or removed.

---

## What it proves, and what it does not

**Measured:** which added lines the coverage report marks as executed, compared exactly against an
inclusive threshold (79.995% fails at 80); which known agent setup files are tracked in git.

**Not measured**, stated plainly (full list in [`docs/LIMITS.md`](docs/LIMITS.md)):

- **Coverage is not test quality.** A covered line was executed; nothing says a test asserted
  anything about it.
- **Only added lines count.** A change that deletes the tests for code it leaves in place does not
  lower diff coverage.
- **Files missing from the coverage report are invisible.** Configure your coverage tool to include
  all source files if untested files should count.
- **The inventory is not a review.** pharn-ci lists agent setup files and never reads them. It is
  informational (`NO_AGENT_SETUP_FILES` is `info`) unless `require-agent-setup` or `setup.require`
  is on, which makes it an `error` and the verdict `fail`.
- **The setup requirement comes from the PR.** The `.pharn/ci.yml` a PR carries can switch
  `setup.require` off, so protect it with CODEOWNERS (or set the Action input in the workflow).
- **pharn-ci trusts the coverage file.** The PR's own tests write it in the same job; a PR that
  alters its test setup can produce a favorable one.
- **Exclusions come from the PR.** The config and workflow a PR carries decide which of its files
  are left out of the measurement ([Excluding files](#excluding-files)).

---

## Safety model

pharn-ci runs inside other people's CI, on untrusted changes, with their token. It is built for
that:

- **Stateless.** No backend, no telemetry, no network calls except the GitHub API inside the
  Action. What it reads, what it sends to your GitHub and what it stores is listed in
  [Data handling](SECURITY.md#data-handling).
- **Small token footprint.** `contents: read` plus `pull-requests: write`. It reads the compare API
  and comments, and updates only a comment its own login (or, when the token cannot read its login, a
  bot) wrote for this workflow and job. It deletes a comment only when concurrent runs left
  duplicates of that own marker comment.
- **Untrusted input stays data.** Parsers are hand-written, pure and non-recursive. File names
  render in code spans and message text is escaped, so neither can add links, images, emphasis,
  mentions or HTML to the PR comment. Git runs without a shell, and refs starting with `-` are
  rejected.
- **Pure core.** `packages/core` cannot do I/O; a test, a lint rule and its tsconfig enforce it.
- **Reviewable releases.** The committed Action bundle is rebuilt and diffed in CI. Third-party
  actions are pinned to commit SHAs. The Action has two direct runtime dependencies
  (`@actions/core`, `@actions/github`), bundled into `packages/action/dist` together with their
  transitive dependencies. CodeQL, gitleaks and Socket checks run on every PR, and release tags are
  never moved.

Each claim is mapped to the test or check that enforces it in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md). pharn-ci cannot measure a `pull_request_target`
run safely and reports the diff as unavailable: run it on `pull_request` instead, and use the
[`workflow_run` pattern](#fork-prs-comment-from-workflow_run) for a comment on fork PRs
([`SECURITY.md`](SECURITY.md)).

---

## The Pharn family

| Project                                                 | What it does                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [pharn-oss](https://github.com/pharn-dev/pharn-oss)     | The PHARN workflow for Claude Code: spec, plan, test-first, build, verify, in Git.   |
| [pharn-cli](https://github.com/pharn-dev/pharn-cli)     | `npx @pharn-dev/pharn init`: installs and updates PHARN in your project.            |
| **pharn-ci**                                            | The CI check: diff coverage and agent setup on every PR, whatever wrote the code.   |

pharn-ci does not need PHARN installed and does not read its artifacts. It is useful on its own in
any repo with an lcov- or Cobertura-producing test run.

**pharn-ci is free, and stays free.** It is the free part of Pharn: Apache-2.0, with no account,
license key, usage limit or paid tier, and nothing in it phones home. Pharn's paid product is
separate; pharn-ci never needs it and is never restricted to push you towards it.

**pharn-ci checks pharn-ci.** This repository's own `ci` job runs the Action from source on every
PR with an 80% diff-coverage threshold, so every change here passes the same gate it ships.

---

## Roadmap

- More coverage formats (Clover, JaCoCo native XML)
- Flaky test detection
- Test-tampering detection (weakened, skipped or deleted tests)
- Agent policy checks on top of the setup inventory

---

## Development

```bash
pnpm install          # install
pnpm build            # typecheck + build core, bundle cli and action
pnpm test             # vitest (all packages)
pnpm test:coverage    # vitest with lcov output in coverage/
pnpm lint             # biome check + typecheck
pnpm pharn-ci check   # run the built CLI on this repo
```

| Package           | Role                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| `packages/core`   | Pure functions: lcov, Cobertura and diff parsing, diff coverage, setup scan, Report v1. |
| `packages/cli`    | `pharn-ci check`: reads files, runs git, calls core, prints output.                    |
| `packages/action` | Thin Action wrapper: inputs, PR diff, sticky comment, job summary, exit code.          |

The rules every change follows are in [`AGENTS.md`](AGENTS.md).

---

## Contributing and security

- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, what CI checks, and how to propose a change.
- [`SECURITY.md`](SECURITY.md): report vulnerabilities privately, not in public issues.
- [`CHANGELOG.md`](CHANGELOG.md) and [`docs/RELEASING.md`](docs/RELEASING.md).
- This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE)
