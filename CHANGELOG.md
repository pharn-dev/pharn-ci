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
- Report v1 (`schema/report.v1.json`), the stable JSON output, with message codes
  `DIFF_COVERAGE_BELOW_THRESHOLD`, `NO_COVERABLE_CHANGES`, `COVERAGE_FILE_MISSING`,
  `COVERAGE_FILE_EMPTY`, `DIFF_UNAVAILABLE` and `NO_AGENT_SETUP_FILES`.
- One sticky PR comment and a job summary; on fork PRs, where the token cannot comment, the job
  summary only.
- `.pharn/ci.yml` config file, overridden by Action inputs and CLI flags.
- Cobertura XML coverage parsing in core, read by the CLI through `coverage.format: cobertura`.
  The Action still accepts lcov only.

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
