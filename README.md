<div align="center">

<img alt="pharn-ci" src="./docs/assets/pharn-ci-logo.svg" width="110" />

# Pharn CI

**Know whether AI coding agents can safely work in your repo.**

A GitHub Action and CLI that checks every pull request for the two things an agent-written change
leans on most: tests that actually run the new code, and the setup files that tell agents how to
behave. AI-agnostic, no telemetry, and stateless unless you opt in to the upload to pharn.dev.

[![CI](https://github.com/pharn-dev/pharn-ci/actions/workflows/ci.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/ci.yml)
[![CodeQL](https://github.com/pharn-dev/pharn-ci/actions/workflows/codeql.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/codeql.yml)
[![Secrets](https://github.com/pharn-dev/pharn-ci/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/pharn-dev/pharn-ci/actions/workflows/gitleaks.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](./package.json)
[![Part of Pharn](https://img.shields.io/badge/part%20of-Pharn-609AA4)](https://pharn.dev)

</div>

> **Status:** pre-1.0; the latest release is `v0.12.0` ([changelog](CHANGELOG.md)). Pin the tag's
> full commit SHA for integrity. The report schema is stable within a version (v2 from 0.2.0). Before 1.0, inputs, outputs and message
> codes are never removed, and a renamed input keeps working under its old name, with a warning, for
> at least one minor release; defaults change only in a minor release and the changelog says so. The
> comment layout may change in any release ([versioning policy](docs/RELEASING.md#inputs-outputs-and-message-codes)).

## What pharn-ci is

pharn-ci runs in your CI on every pull request. It measures **diff coverage**, the share of the lines the PR adds that
your own test run executes, from the lcov or Cobertura XML file your tests already write. It checks whether the change
**weakened the tests**, lists the **agent setup files** the repo carries (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`,
MCP configs and the files of Cursor, Copilot, Codex, Gemini and other tools), and looks at what a change adds for secrets, hidden instructions and
risky dependencies. It never decides with a model: every verdict comes from numbers and stable message codes.

The output is one sticky PR comment, the job summary, a pass/warn/fail verdict, and a JSON report with a published
schema that agents and scripts can read. More in [How pharn-ci works](docs/how-it-works.md).

## Quick start

Add this workflow. It runs your vitest tests with lcov output, then pharn-ci; `@vitest/coverage-v8` must be a dev
dependency of the project, or `vitest run --coverage` writes no report.

```yaml
# .github/workflows/pharn-ci.yml
name: pharn-ci
on: pull_request

permissions:
  contents: read
  pull-requests: write
  id-token: write # pharn-ci fetches your org policy from pharn.dev and, with the default upload: auto, uploads the redacted report and run metadata there; remove it and pharn-ci makes no call to pharn.dev

# One run per PR at a time, so concurrent pushes do not race on the sticky comment. The github.ref
# fallback gives each merge-queue entry its own group, since merge_group events have no PR number.
concurrency:
  group: pharn-ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  pharn-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      # ...set up your toolchain and run tests with lcov or Cobertura output, e.g.:
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24
      - run: npm ci
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.12.0 # or, better, the tag's full commit SHA
        timeout-minutes: 5
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
```

- `fetch-depth: 0` lets pharn-ci diff against the PR base locally; the test-integrity signals that read the text of
  the change need it.
- `timeout-minutes: 5` bounds a slow GitHub or pharn.dev without cutting a normal run short.
- Release tags are exact versions, never moved or deleted, but unsigned: pin the tag's full commit SHA for integrity.
- Leave out `coverage-file` and pharn-ci looks for the report at the usual paths (`coverage/lcov.info`, `lcov.info`,
  `coverage.xml`, ...). Workflows for vitest, jest, pytest, .NET and cargo are in
  [`examples/workflows/`](examples/workflows/).

Every choice above is explained in [Quick start](docs/quick-start.md); other runners and monorepos are in
[Coverage](docs/coverage.md). Working with Claude Code? The `pharn-ci-install` skill can do this setup for you; see
[Agent skills](docs/agent-skills.md).

## The PR comment

The top of the sticky comment on a pull request below its threshold (the full example is in
[How pharn-ci works](docs/how-it-works.md#example-pr-comment)):

> ## 🛡️ pharn-ci · ❌ Fail
>
> > [!CAUTION]
> > **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.
>
> | Verdict | Diff coverage | Test integrity | Agent setup |
> | --- | --- | --- | --- |
> | ❌ Fail | 71.43% (threshold 80%) | none (warn) | 8 files |
>
> ### 🧪 Diff coverage
>
> `▰▰▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱` 71.43%
>
> **71.43%** of changed lines covered (5/7, threshold 80%)

Below it come the changed files with their uncovered lines, the test-integrity findings, every message with a hint,
and the agent setup files. The same report is in the job summary and in `report.json`.

## What it checks

### Diff coverage

The share of the lines added in the PR that the coverage report marks as executed, compared exactly against an
optional, inclusive threshold (79.995% fails at 80). Files you exclude are left out. A new file no test imports is
missing from most coverage reports unless the runner is told where the source is:
[Make untested files count](docs/coverage.md#make-untested-files-count).

### Test integrity

Did the change make the tests weaker? Signals TI01 to TI17 (TI15 is not emitted) report a deleted test file, a removed or skipped test, a
`.only`, emptied assertions, a loosened test-runner setting, a weakened test script, CI that stopped running tests, a
coverage-ignore comment and more. The `test-integrity` input is `warn` by default; `block` fails the check on a
block-level finding, and a reviewer who is not the author can sign one off with the accept label.
[Test integrity](docs/checks/test-integrity.md).

### Secrets in agent configs

Check A7 reads the machine-readable agent config files (`.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, ...)
for committed secrets such as GitHub, Anthropic, OpenAI, AWS or Stripe keys. A message names the shape and the location,
never the value. [Secrets in agent configs](docs/checks/secrets.md).

### Stale agent instructions

An instruction file that names a script, path or file the repository no longer has produces a confidently wrong agent
PR. When a change touches an instruction file, or removes what one names, SI01 to SI03 report the stale command, path
or link (SI04 is not emitted since the release after v0.11.0). [Stale agent instructions](docs/checks/stale-instructions.md).

### Prompt-injection scan

The added lines of the diff are scanned for invisible or bidirectional Unicode, hidden Markdown that addresses an
agent, known injection phrases, long encoded blobs in instruction files and instruction files added in vendored
directories. Text-only and deterministic. [Prompt-injection scan](docs/checks/prompt-injection.md).

### Flaky tests and JUnit results

With `junit-paths`, pharn-ci reads the JUnit XML your test step writes, lists what failed, and applies the
organization's quarantine list from pharn.dev. Test results never change the verdict.
[Flaky tests and JUnit results](docs/checks/flaky-tests.md).

### Dependency safety

The dependencies a pull request adds or changes in npm and Python manifests and lockfiles, `package.json` overrides
(`overrides`, `resolutions`, `pnpm.overrides`) included, are checked for lockfile drift (D04) and sources outside the
public registries (D05). With `dependencies: lookup` the Action also looks each
added package up for one that does not exist, is days old or is barely downloaded (D01 to D03).
What D04 and D05 do not read is in [What dependency safety does not read](docs/LIMITS.md#what-dependency-safety-does-not-read).
[Dependency safety](docs/checks/dependencies.md).

### Org policy

A policy sets one gate for every repository of an organization, so a pull request cannot loosen it: a coverage
floor, test-integrity severities, agent settings and MCP rules, protected paths and size caps for agent PRs (P01 to
P14). The pharn.dev app serves it, or the repository carries it in a file that can only tighten.
[Org policy](docs/policy.md).

### Upload to pharn.dev (optional)

When the job grants `id-token: write` and the organization installed the Pharn GitHub App, the Action uploads the
redacted report and run metadata to pharn.dev, so the app can keep the history of runs and comment on the pull
request itself. A failed upload never fails the check; `upload: never` turns it off.
[Upload to pharn.dev](docs/upload.md).

## Inputs

The most-used inputs. Every input and output, with its default and rules, is in the
[Action reference](docs/action.md).

| Input            | Default         | What it does                                                                                   |
| ---------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `coverage-file`  | auto-discovered | Coverage report paths or globs, one per line; all are merged                                   |
| `threshold`      | none            | Minimum diff coverage %, inclusive                                                             |
| `exclude`        | none            | Globs of changed files to leave out of diff coverage                                           |
| `test-integrity` | `warn`          | `block`, `warn` or `off`: how strictly to treat weakened tests                                 |
| `dependencies`   | `auto`          | `auto` runs the offline checks, `lookup` also asks the public registries, `never` runs nothing |
| `junit-paths`    | none            | JUnit XML files the test step wrote, for the Flaky section                                     |
| `policy`         | `auto`          | Where the org policy comes from: `auto`, `never`, `required` or `file:<path>`                  |
| `upload`         | `auto`          | `auto` uploads the redacted run to pharn.dev when allowed, `never` turns it off                |
| `comment`        | `true`          | Post or update one sticky PR comment per workflow and job                                      |
| `fail-on-verdict`| `true`          | Fail the step when the verdict is `fail`                                                       |

`.pharn/ci.yml` can hold the same settings, but a pull request can edit it, so it may only tighten what the workflow
sets: [Config](docs/config.md). The CLI (`pharn-ci check`) is in [CLI](docs/cli.md), and the JSON report and every
message code in [Report v2](docs/output.md).

## What leaves the job

No backend of its own, no telemetry, and no network calls except these, all made by the Action (the CLI makes none):
the GitHub API; only with `policy` set to `auto` or `required` and an OIDC token granted, one `GET` of the pharn.dev
policy endpoint that sends the OIDC token and the repository name; with `upload` not set to `never` and an OIDC token
granted, the redacted `report.json` and `meta.json` of the run to pharn.dev; and only with the `dependencies` mode
`lookup` (the input, `dependencies.lookup: true` in `.pharn/ci.yml`, or an org policy), one `GET` per added unscoped
package to `registry.npmjs.org/<name>`, `api.npmjs.org/downloads/point/last-week/<name>` or
`pypi.org/pypi/<name>/json`, which sends the package name in the path and nothing else: no token, no repository name.
No other host is called. Never file contents, diffs, coverage files or logs.

Without `id-token: write` nothing is sent to pharn.dev. What pharn-ci reads, sends and stores is listed in
[Data handling](SECURITY.md#data-handling); the [Safety model](docs/safety.md) and
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) map each claim to the test that enforces it. What pharn-ci does not
measure is in [What it proves, and what it does not](docs/what-it-proves.md) and [`docs/LIMITS.md`](docs/LIMITS.md).

## The Pharn family

| Project                                                 | What it does                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [pharn-oss](https://github.com/pharn-dev/pharn-oss)     | The PHARN workflow for Claude Code: spec, plan, test-first, build, verify, in Git.   |
| [pharn-cli](https://github.com/pharn-dev/pharn-cli)     | `npx @pharn-dev/pharn init`: installs and updates PHARN in your project.            |
| **pharn-ci**                                            | The CI check: diff coverage and agent setup on every PR, whatever wrote the code.   |
| [skills](https://github.com/pharn-dev/skills)           | Agent skills that set up pharn-ci, explain its verdicts and cover the gaps it finds. |

pharn-ci does not need PHARN installed and does not read its artifacts. It is useful on its own in
any repo with an lcov- or Cobertura-producing test run.

**pharn-ci is free, and stays free.** It is the free part of Pharn: Apache-2.0, with no account,
license key, usage limit or paid tier, and nothing in it phones home unless the job grants `id-token: write`:
then it fetches your org policy and uploads the redacted report to pharn.dev (`policy: never` and `upload: never` turn
each off). Pharn's paid product is
separate; pharn-ci never needs it and is never restricted to push you towards it.

**pharn-ci checks pharn-ci.** This repository's own `ci` job runs the Action from source on every
PR with an 80% diff-coverage threshold, so every change here passes the same gate it ships.

## Roadmap

- More coverage formats (Clover, JaCoCo native XML)
- Flaky test detection across runs on pharn.dev (the Action already sends the JUnit results and applies the app's
  quarantine list; see [Flaky tests and JUnit results](#flaky-tests-and-junit-results))
- Test-integrity signals for the cases still missed, such as a hard-coded answer in source (see
  [Test integrity](#test-integrity))

## Documentation

- [Documentation index](docs/README.md): every chapter, from the Action reference to the message codes.
- [`CHANGELOG.md`](CHANGELOG.md) and [`docs/RELEASING.md`](docs/RELEASING.md).
- [`SECURITY.md`](SECURITY.md): report vulnerabilities privately, not in public issues.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, what CI checks, and how to propose a change;
  [Development](docs/development.md) for the commands and packages, and [`AGENTS.md`](AGENTS.md) for the rules.
- [`docs/LIMITS.md`](docs/LIMITS.md) and [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).
- [`examples/workflows/`](examples/workflows/): complete workflows per ecosystem.
- [Agent skills](docs/agent-skills.md) for Claude Code.
- This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE)
