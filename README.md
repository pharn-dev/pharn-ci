# pharn-ci

A CI check that tells you whether AI coding agents can safely work in your repo.

pharn-ci is AI-agnostic: it looks at your code, tests and agent setup files (Claude Code,
Cursor, Copilot, Codex, …), not at which tool wrote the code. It runs fully stateless:
no backend, no telemetry, no network calls except the GitHub API inside the Action.
Part of the [Pharn](https://pharn.dev) family.

**Today it reports:**

- **Diff coverage**: the share of lines added in the PR that your tests cover, with an optional
  threshold gate.
- **Agent setup inventory**: which agent setup files the repo has (`CLAUDE.md`, `AGENTS.md`,
  `.claude/`, `.cursor/rules`, `.github/copilot-instructions.md`, `.mcp.json`, …).

## Quickstart (GitHub Action)

```yaml
# .github/workflows/pharn-ci.yml
name: pharn-ci
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  pharn-ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      # ...set up your toolchain and run tests with lcov output, e.g.:
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.1.0 # or, better, the tag's full commit SHA
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
```

| Input | Default | |
| --- | --- | --- |
| `coverage-file` | `coverage.file` from config | Path to the coverage report |
| `coverage-format` | `lcov` | Only `lcov` for now |
| `threshold` | none | Minimum diff coverage %, inclusive |
| `base-ref` | PR base | Ref or SHA to diff against |
| `comment` | `true` | Post/update one sticky PR comment |
| `fail-on-threshold` | `true` | Fail the step when the verdict is `fail` |
| `config` | `.pharn/ci.yml` | Config file path |

Release tags are exact versions (`v0.1.0`), never moved or deleted. Pinning the tag's full commit
SHA is stronger still; Dependabot keeps either up to date.

Outputs: `report-path` (Report v1 JSON), `verdict`, `diff-coverage`. The report is also written
to the job summary. On PRs from forks the token can't comment; pharn-ci then warns and uses the
job summary only.

## CLI

```bash
pnpm install && pnpm build
node packages/cli/dist/index.js check --coverage coverage/lcov.info --threshold 80
```

```
pharn-ci check [--coverage <file>] [--base <ref>] [--threshold <n>]
               [--format md|json] [--config <path>]
```

- `--base` defaults to `origin/main`; the diff is `git diff --unified=0 <base>...HEAD`.
- `--format json` prints only the report to stdout, for agents and scripts.
- Exit codes: `0` pass or warn, `1` fail, `2` usage or runtime error.

## Config

`.pharn/ci.yml` (CLI flags and Action inputs override it):

```yaml
coverage:
  file: coverage/lcov.info
  format: lcov
  threshold: 80
```

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
> ### Agent setup
>
> | Path | Kind |
> | --- | --- |
> | `.claude/settings.json` | claude-settings |
> | `AGENTS.md` | agents-md |
> | `CLAUDE.md` | claude-md |
>
> ### Messages
>
> - ❌ `DIFF_COVERAGE_BELOW_THRESHOLD` Diff coverage 71.43% is below the threshold of 80%.

## Report v1

The JSON report is the stable, machine-readable API; the comment and CLI text are renderings of
it. See [`schema/report.v1.json`](schema/report.v1.json). Branch on message `code`s
(`DIFF_COVERAGE_BELOW_THRESHOLD`, `NO_COVERABLE_CHANGES`, `COVERAGE_FILE_MISSING`,
`COVERAGE_FILE_EMPTY`, …), not on text.

How diff coverage is counted: only lines **added** in the PR count, and only if the coverage
report knows them. Added comments, types and files without coverage are excluded from the
denominator. No coverable changes means `pass` with `NO_COVERABLE_CHANGES`. What this does and
does not prove is in [`docs/LIMITS.md`](docs/LIMITS.md).

## Roadmap

- Cobertura (and more coverage formats)
- Flaky test detection
- Test-tampering detection (weakened, skipped or deleted tests)
- Agent policy checks on top of the setup inventory

## Contributing & security

- [`CONTRIBUTING.md`](CONTRIBUTING.md): setup, what CI checks, and the rules every change follows
  ([`AGENTS.md`](AGENTS.md)).
- [`SECURITY.md`](SECURITY.md): report vulnerabilities privately. The security design is in
  [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).
- [`CHANGELOG.md`](CHANGELOG.md) and [`docs/RELEASING.md`](docs/RELEASING.md).
- This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[Apache-2.0](LICENSE)
