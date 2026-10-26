# GitHub Marketplace listing

The text for the GitHub Marketplace listing of the pharn-ci Action. A test checks it against `action.yml`, and it is refreshed on each release ([`docs/RELEASING.md`](./RELEASING.md)).

## Name

pharn-ci

## One-line description

Check whether AI coding agents can safely work in your repo — diff coverage gate and agent setup inventory.

## Description

pharn-ci measures diff coverage: the share of the lines added in a pull request that your own test run covered. It reads the lcov or Cobertura XML file your tests already write, detects the format automatically by default, and can fail the step below an optional, inclusive threshold. Files you list as exclusions are left out of the measurement.

pharn-ci also keeps an inventory of the agent setup files tracked in your repository: the instruction, settings, rules and MCP configuration files of Claude Code, Cursor, GitHub Copilot, Codex, Gemini, Windsurf, Cline and MCP, with a summary of the tools involved. It lists these files by kind and never reads them.

The result is one sticky comment on the pull request, the job summary, a pass, warn or fail verdict and a Report v2 JSON file. pharn-ci is stateless: it has no backend and no telemetry, and it makes no network calls except to the GitHub API.

## Categories

- Primary: Continuous integration
- Secondary: Testing

## Quick start

```yaml
name: pharn-ci
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  pharn-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      # ...set up your toolchain and run tests with lcov output, e.g. (vitest needs
      # @vitest/coverage-v8 as a dev dependency, or it aborts and writes no report):
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.3.0
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
```
