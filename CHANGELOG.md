# Changelog

All notable changes to pharn-ci are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a breaking change bumps the minor version.
Releases are cut by a maintainer; see [`docs/RELEASING.md`](./docs/RELEASING.md).

## [Unreleased]

### Added

- Require agent setup: the `require-agent-setup` Action input, the CLI's `--require-agent-setup` flag and `setup.require` in `.pharn/ci.yml` (off by default) make `NO_AGENT_SETUP_FILES` an error and the verdict `fail` when the repo has no agent setup files.
- Data handling section in `SECURITY.md`, linked from the README's Safety model: what the Action reads, what it sends to your GitHub API, what lands in the PR comment, job summary, step log and `report.json`, and that nothing is sent to Pharn.

### Changed

- `DIFF_UNAVAILABLE` is now an error, and the verdict `fail`, when a threshold is set (a warning
  without one), like a missing, empty or unrecognized coverage file. If a shallow checkout makes
  the diff unavailable, use `actions/checkout` with `fetch-depth: 0` or rely on the GitHub API
  fallback.
- The repository no longer tracks the maintainer's PHARN workflow install (`pharn/`,
  `pharn.config.json`, `pharn.records.json` and PHARN's own root `LIMITS.md` and `THREAT-MODEL.md`),
  so `uses: pharn-dev/pharn-ci@...` downloads about 5 MB less. pharn-ci's own threat model and
  limits are [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) and [`docs/LIMITS.md`](./docs/LIMITS.md).

### Fixed

- Docs: the quick start pins `actions/checkout` to a commit SHA; the Action reference gives the
  real `threshold` and `base-ref` defaults; the docs name Cobertura as untrusted input, the
  `GET /user` call, and the bundled transitive dependencies.
- The Action no longer crashes with a stack trace before running when `github-token` is empty. The
  token is used only when an API call is needed, so `comment: false` with a local diff works
  without one; otherwise the compare fallback reports `DIFF_UNAVAILABLE` and the comment step
  warns, as for any API failure. The `github-token` input now says `pull-requests: write` is
  needed only for the comment.

### Fixed

- Merge queue runs (`merge_group`) diff against `merge_group.base_sha` instead of always reporting
  `DIFF_UNAVAILABLE`.
- An explicit `base-ref` found neither in the checkout nor through the GitHub API now fails the
  step with an error naming the ref, instead of reporting `DIFF_UNAVAILABLE`.

### Security

- The Action's `git rev-parse --verify` lookup of the base ref now passes the revision after
  `--end-of-options` too, so every git call that takes a revision separates it from options.
- Release tags are documented as unsigned lightweight tags, with pinning the full commit SHA as the
  integrity control (`README.md`, `SECURITY.md`, `docs/RELEASING.md`). The `packages/action/dist`
  diff is no longer collapsed in pull requests (`.gitattributes` no longer marks it
  `linguist-generated`), and CI writes the changed dist files and the bundle's sha256 to the job
  summary of every pull request so reviewers see the shipped artifact change.

## [0.1.0] - YYYY-MM-DD

The maintainer replaces `YYYY-MM-DD` with the release date, and deletes this line, when cutting
the release.

### Added

- GitHub Action and `pharn-ci check` CLI.
- Diff coverage: the share of lines added in the change that the coverage report (lcov or
  Cobertura XML) marks as executed, with an optional, inclusive threshold gate (`threshold` input,
  `--threshold`, `coverage.threshold`).
- Agent setup inventory: the tracked agent setup files of Claude Code, Cursor, GitHub Copilot,
  Codex, Gemini, Windsurf, Cline and MCP, listed by kind and never read. The kinds are `claude-md`,
  `claude-local-md`, `agents-md`, `gemini-md`, `claude-settings`, `claude-settings-local`,
  `claude-skill`, `claude-hook`, `claude-agent`, `claude-command`, `cursor-rules`, `cursor-mcp`,
  `copilot-instructions`, `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`,
  `vscode-mcp`, `codex-config`, `windsurf-rules`, `cline-rules` and `mcp-config`. `.mcp.json`,
  `.claude/` files and `.cursor/rules/` are found in nested directories, and the more specific
  directory rule wins over a file-name rule.
- Report v1: optional `agentSetup.summary` (counts per kind and the tools involved), and an
  `Agent setup: N files · tools` line in the markdown, with the table collapsed above 25 files.
- Report v1 (`schema/report.v1.json`), the stable JSON output, with message codes
  `DIFF_COVERAGE_BELOW_THRESHOLD`, `NO_COVERABLE_CHANGES`, `COVERAGE_FILE_MISSING`,
  `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`, `DIFF_UNAVAILABLE` and
  `NO_AGENT_SETUP_FILES`.
- One sticky PR comment and a job summary; on fork PRs, where the token cannot comment, the job
  summary only.
- `.pharn/ci.yml` config file, overridden by Action inputs and CLI flags.
- Coverage exclusions: glob patterns (`*`, `**`, `?`) from `coverage.exclude`, the CLI's repeatable
  `--exclude <glob>` and the Action's `exclude` input, merged (their union applies), leave matching
  changed files out of diff coverage. The report gains the optional `diffCoverage.excludedFiles`
  field, and the comment an "Excluded" summary listing them.
- Cobertura XML coverage parsing in core, read by the CLI and the Action.
- Coverage format selection: the `coverage-format` Action input, the `--coverage-format` CLI flag
  and `coverage.format` in `.pharn/ci.yml` take `lcov`, `cobertura` or `auto`. The flag or input
  wins over the config file.
- `auto` is the default: the format is detected from the first 1 KiB of the file, and the CLI
  (stderr) and the Action (log) print which format was used, for example
  `coverage: cobertura (auto-detected)`. Clover and JaCoCo native XML are not supported.
- Message code `COVERAGE_FORMAT_UNSUPPORTED`: under `auto`, a coverage file that is neither lcov
  nor Cobertura XML is an error with a threshold, a warning without.
- Report v1: optional `diffCoverage.format` (`lcov` or `cobertura`), the format the report was
  read as.

### Security

- The PR comment cannot be altered through file names or message text: control characters in
  paths are replaced and HTML in messages is escaped.
- The sticky comment is matched by its author as well as its marker, so a comment someone else
  posted is never taken over.
- A base ref starting with `-` is rejected, and revisions reach git after `--end-of-options`.
- The config parser runs in linear time on hostile input.
- An empty or unparseable coverage file reports `COVERAGE_FILE_EMPTY` instead of passing.
- A `pull_request_target` run that checked out the base branch reports `DIFF_UNAVAILABLE` instead
  of passing.
- PR comments are capped below GitHub's size limit; the job summary keeps the full report.
- Repository protection: signed, linear, squash-merged `main` behind six required checks;
  immutable `v*` tags; every third-party action pinned to a commit SHA.
