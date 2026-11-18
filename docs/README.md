# pharn-ci documentation

The [README](../README.md) gets you to a working check. These pages are the reference.

## Getting started

- [Quick start](quick-start.md): the choices behind the README's workflow (`fetch-depth`, timeouts, pinning,
  coverage auto-discovery).
- [Coverage](coverage.md): the coverage report per ecosystem, monorepos, and making untested files count.
- [How pharn-ci works](how-it-works.md): what it reports, the agent setup inventory, the data flow and an example PR
  comment.

## Reference

- [Action reference](action.md): every input and output, the accept label, and fork PRs through `workflow_run`.
- [CLI](cli.md): `pharn-ci check` and `pharn-ci test`.
- [Config](config.md): `.pharn/ci.yml`, coverage files and globs, excluding files.
- [Report v2](output.md): the JSON report, every message code, fix hints and agent-PR detection.

## Checks

- [Test integrity](checks/test-integrity.md): TI01 to TI17.
- [Secrets in agent configs](checks/secrets.md): A7, S01 to S11.
- [Stale agent instructions](checks/stale-instructions.md): SI01 to SI04.
- [Prompt-injection scan](checks/prompt-injection.md): PI01 to PI05.
- [Flaky tests and JUnit results](checks/flaky-tests.md).
- [Dependency safety](checks/dependencies.md): D01 to D05.
- [Org policy](policy.md): P01 to P14 and policy mode.
- [Upload to pharn.dev](upload.md).

## Trust and limits

- [What it proves, and what it does not](what-it-proves.md).
- [Safety model](safety.md).
- [LIMITS.md](LIMITS.md): what each check misses.
- [THREAT-MODEL.md](THREAT-MODEL.md): trust boundaries and the test behind each claim.
- [PRECISION.md](PRECISION.md): how the test-integrity signals were measured.

## Project

- [Agent skills](agent-skills.md): the pharn-ci plugin for Claude Code.
- [Development](development.md): commands and packages.
- [RELEASING.md](RELEASING.md): versioning and the release process.
- [MARKETPLACE.md](MARKETPLACE.md): the GitHub Marketplace listing text.
