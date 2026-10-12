# Changelog

All notable changes to pharn-ci are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a breaking change bumps the minor version.
Releases are cut by a maintainer; see [`docs/RELEASING.md`](./docs/RELEASING.md).

## [Unreleased]

Planned first release: **0.1.0**. The release date and versioned heading will be set when the
release is cut.

### Added

- GitHub Action and `pharn-ci check` CLI.
- Diff coverage: the share of lines added in the change that the lcov report covers, with an
  optional, inclusive threshold gate (`threshold` input, `--threshold`, `coverage.threshold`).
- Agent setup inventory: `CLAUDE.md`, `AGENTS.md`, `.claude/` settings, skills, hooks, agents and
  commands, `.cursor/rules`, `.cursorrules`, `.github/copilot-instructions.md`, `.mcp.json`.
- Agent setup inventory: new kinds `claude-local-md`, `gemini-md`, `copilot-instructions-scoped`,
  `copilot-agents`, `copilot-prompts`, `cursor-mcp`, `vscode-mcp`, `codex-config`, `windsurf-rules`
  and `cline-rules`; `.mcp.json`, `.claude/` files and `.cursor/rules/` are now also found in nested
  directories, and the more specific directory rule wins over a file-name rule.
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
  `--exclude <glob>` and the Action's `exclude` input, merged, leave matching changed files out of
  diff coverage. The report gains the optional `diffCoverage.excludedFiles` field, and the comment
  an "Excluded" summary listing them.
- Cobertura XML coverage parsing in core, read by the CLI and the Action (`coverage.format:
  cobertura`).
- Coverage format selection: the `coverage-format` Action input, the `--coverage-format` CLI flag
  and `coverage.format` in `.pharn/ci.yml` take `lcov`, `cobertura` or `auto`. The flag or input
  wins over the config file.
- `auto` is the new default: the format is detected from the first 1 KiB of the file, and the CLI
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
