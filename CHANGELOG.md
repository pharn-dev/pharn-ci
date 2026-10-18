# Changelog

All notable changes to pharn-ci are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). Before 1.0, a breaking change bumps the minor version.
Releases are cut by a maintainer; see [`docs/RELEASING.md`](./docs/RELEASING.md).

## [Unreleased]

### Added

- Expected agent tools: `setup.expect` in `.pharn/ci.yml`, the `expect-agent-setup` Action input and the CLI's `--expect-agent-setup` flag (repeatable) name agent tools (for example `claude-code`, `cursor`) that should have a setup file. Any tool no setup file configures is listed in the new `agentSetup.missing` field and reported as `AGENT_SETUP_EXPECTED_MISSING` (warn, or error when agent setup is required). A repo that expects nothing sees no change.
- `AGENT_SETUP_FILE_EMPTY` (warn): a listed agent setup file that is empty (size 0 in `HEAD`, from `git ls-tree -r -l`) is reported with the first path, and stays in the inventory. When `git ls-tree` fails, none is reported (the CLI notes it on stderr, the Action warns). Because it is a warning, the verdict of a repo with an empty `CLAUDE.md` changes from `pass` to `warn`.
- `TEST_FILES_DELETED` (info): the change deletes a test file, or renames one to a name that is not a test file
  (F-21). The message names up to five of them; the verdict is unchanged. Test files are recognized by name
  (`.test.`/`.spec.` in the basename, or a `test`, `tests` or `__tests__` directory).
- Agent setup inventory covers more tools (F-11): 13 new setup kinds, `claude-rule` (`.claude/rules/`), `aider-config`, `conventions-md`, `continue-rules`, `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`, `augment-rules`, `kiro-steering`, `goosehints`, `opencode-config` and `gemini-settings`, so the files of Aider, Continue, Roo Code, Amazon Q Developer, Junie, Zed, Augment, Kiro, Goose, OpenCode and Gemini CLI are listed. `agents-md` is now also credited to amp, jules, opencode and zed, and `agentSetup.summary.tools` in Report v1 accepts new tool names within v1 (a lowercase name pattern replaces the closed list).
- PR-number mode: the `pr-number` and `head-sha` Action inputs let pharn-ci measure and comment on a
  pull request from a `workflow_run` or `workflow_dispatch` run, with no PR code checked out. The PR,
  its diff and its file list come from the GitHub API (two new read-only calls: get a pull request,
  get a git tree), `pr-number` is validated, and `head-sha` is checked against the PR head. The README
  documents the two-workflow pattern for comments on fork PRs.
- Three warn-level messages for a change that touches the inputs of its own grade: `CONFIG_CHANGED_IN_DIFF` (the diff edits the pharn-ci config in use or a file under `.github/workflows/`), `COVERAGE_FILE_TRACKED` (the coverage file is a tracked file, so the change can supply its own numbers) and `DIFF_BINARY_COVERED_FILE` (the diff shows a covered source file as binary, e.g. through `-diff` in `.gitattributes`, so its added lines were not measured). They lift a `pass` to `warn` and never fail the check.
- Several coverage files and globs: the `coverage-file` Action input takes one entry per line, the CLI's `--coverage` flag is repeatable and `coverage.file` in `.pharn/ci.yml` can be a list. Each entry is a path or a glob (`*`, `**`, `?`, relative to the workspace, the current directory or the repo root), so `TestResults/**/coverage.cobertura.xml` and `packages/*/coverage/lcov.info` work. The files are merged with hit counts summed; `auto` detects the format of each file. A glob that finds nothing is `COVERAGE_FILE_MISSING`; a walk stops at 1,000 matched files or 100,000 visited entries, never follows a symbolic link and skips `.git` and `node_modules` unless named.
- Require agent setup: the `require-agent-setup` Action input, the CLI's `--require-agent-setup` flag and `setup.require` in `.pharn/ci.yml` (off by default) make `NO_AGENT_SETUP_FILES` an error and the verdict `fail` when the repo has no agent setup files.
- `DIFF_COVERAGE_UNGATED` (info): diff coverage was measured, with its percent in the text, but no
  threshold gates it (none is set, or it is 0). Before, an ungated run passed with no message.
- Data handling section in `SECURITY.md`, linked from the README's Safety model: what the Action reads, what it sends to your GitHub API, what lands in the PR comment, job summary, step log and `report.json`, and that nothing is sent to Pharn.

- The rendered report (PR comment, job summary, CLI markdown) adds a one-line hint under each message
  saying how to fix it, and says what is missing (typically `AGENTS.md` or `CLAUDE.md`) when no agent
  setup files are found. Message text in `report.json` is unchanged.
- `coverage.exclude` in `.pharn/ci.yml` can be written as a one-line flow list, e.g.
  `exclude: ["**", "dist/**"]`, which used to stop the check with exit code 2.
- Coverage root: `coverage.root` in `.pharn/ci.yml`, the `coverage-root` Action input and the CLI's `--coverage-root` flag name the repo-relative directory that relative coverage paths start from, so a package-relative lcov or Cobertura report in a monorepo is measured at the right files. Absolute paths are never remapped.
- `COVERAGE_PATHS_PARTIALLY_UNMATCHED` (info): some of the coverage report's file paths are not tracked files, so their coverage is not used. The verdict is unchanged. The `fixtures/golden` and `fixtures/golden-cobertura` reports gain this message.

### Changed

- Internal refactor: the CLI and the Action share their Node I/O (git, file reads, directory listing) and their coverage-file reading through a private workspace package, `@pharn-ci/node-io`. No user-visible change.
- Large inputs: the diff and lcov coverage are read line by line (F-15), so a diff is no longer limited by a 256 MiB buffer and lcov no longer by the longest string the engine can build (only one line that long still fails). The CLI and the Action stream git's output and the coverage file instead of reading them whole. Cobertura coverage and the config stay string-based. The limits of each input and what you see when one is passed are in `docs/LIMITS.md` §8 (Size limits).
- Versioning policy for 0.x (`docs/RELEASING.md`): Action inputs and outputs, CLI flags and message
  codes are never removed before 1.0; a renamed input keeps working under its old name, with a
  warning, for at least one minor release; a changed default ships only in a minor release and is
  listed here. The README status note and `docs/LIMITS.md` say the same.
- Agent setup inventory quality (F-10): `.mcp.json`, `.claude/settings.json` and `.claude/settings.local.json` count at the repo root only (a nested copy in a package or a test fixture is no longer listed); a dot-file or README under a directory kind (such as `.claude/skills/x/.gitkeep` or `.github/agents/README.md`) is not listed; and a path with a `node_modules` directory is never listed. Repos with such files see fewer files in `agentSetup.files`.
- A coverage entry (the `coverage-file` input, `--coverage` or `coverage.file`) containing `[`, `]`, `{` or `}` is
  rejected as unsupported glob syntax, even without `*` or `?`. A literal coverage path with one of those characters
  is now a usage error.
- The rendered report lists messages before the agent setup inventory, and a file's uncovered-lines cell shows
  at most 20 ranges followed by `…and N more`. The Action fits an oversized PR comment (65,000 characters) or
  job summary (1 MiB) by rendering fewer table rows instead of cutting the end, so the verdict and messages
  stay visible; `report.json` keeps the full report.
- The diff coverage table lists files by coverage, lowest first (then by path), so the files that
  need tests stay visible when the table is cut at 50 rows; a cut table now points to the full list
  in `report.json` (the Action's `report-path` output, or `--format json`).
- `.pharn/ci.yml` errors for unsupported YAML now name the supported form (for example "use a block
  list").
- A coverage report whose paths match no tracked file is now `COVERAGE_PATHS_UNMATCHED`: an error, and
  the verdict `fail`, when a threshold is set (a warning without one), with the suggested coverage
  root when one can be found. Before, it passed as `NO_COVERABLE_CHANGES`. If your coverage paths are
  relative to a package directory, set `coverage.root`.
- `DIFF_UNAVAILABLE` is now an error, and the verdict `fail`, when a threshold is set (a warning
  without one), like a missing, empty or unrecognized coverage file. If a shallow checkout makes
  the diff unavailable, use `actions/checkout` with `fetch-depth: 0` or rely on the GitHub API
  fallback.
- The diff coverage threshold is compared exactly against covered / coverable lines instead of the
  percent rounded to two decimals: 15,999 of 20,000 lines (79.995%) now fails a threshold of 80.
  A failing coverage that would round up to the threshold is shown rounded down (79.99%).
- Threshold 0 is documented as gating no percentage (reported with `DIFF_COVERAGE_UNGATED`); it
  still fails closed when coverage cannot be measured.
- The repository no longer tracks the maintainer's PHARN workflow install (`pharn/`,
  `pharn.config.json`, `pharn.records.json` and PHARN's own root `LIMITS.md` and `THREAT-MODEL.md`),
  so `uses: pharn-dev/pharn-ci@...` downloads about 5 MB less. pharn-ci's own threat model and
  limits are [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) and [`docs/LIMITS.md`](./docs/LIMITS.md).

### Fixed

- The README quick start no longer aborts for vitest: it says `@vitest/coverage-v8` must be a dev dependency, and a
  new "Coverage per ecosystem" table shows the report and `coverage-file` for vitest, jest, pytest-cov, coverlet,
  cargo-llvm-cov, Go, and JaCoCo/Kover through a Cobertura converter.
- An lcov file whose `SF` records carry no `DA` lines (a crashed or truncated reporter) is now
  `COVERAGE_FILE_EMPTY`, as the Cobertura equivalent already was, instead of passing as
  `NO_COVERABLE_CHANGES`. lcov files without a valid `DA` line are left out of the coverage map.
- Docs: the quick start pins `actions/checkout` to a commit SHA; the Action reference gives the
  real `threshold` and `base-ref` defaults; the docs name Cobertura as untrusted input, the
  `GET /user` call, and the bundled transitive dependencies.
- The Action no longer crashes with a stack trace before running when `github-token` is empty. The
  token is used only when an API call is needed, so `comment: false` with a local diff works
  without one; otherwise the compare fallback reports `DIFF_UNAVAILABLE` and the comment step
  warns, as for any API failure. The `github-token` input now says `pull-requests: write` is
  needed only for the comment.
- Concurrent runs on one PR no longer leave two sticky comments: after creating its comment, the
  Action deletes newer duplicates of its own marker comment (only ones its own login wrote) and
  keeps updating the oldest. The README quick start now sets a per-PR `concurrency` group.
- Merge queue runs (`merge_group`) diff against `merge_group.base_sha` instead of always reporting
  `DIFF_UNAVAILABLE`.
- An explicit `base-ref` found neither in the checkout nor through the GitHub API now fails the
  step with an error naming the ref, instead of reporting `DIFF_UNAVAILABLE`.
- A `config` input naming a file that does not exist now fails the step with "config file not
  found", like the CLI's `--config`, instead of running with no config (and so without a threshold
  held only in the config). The input no longer has a default in `action.yml`; left empty, it reads
  `.pharn/ci.yml` when present, as before.
- The CLI lists tracked files from the repository root when run from a subdirectory, so coverage
  paths are compared with the same names wherever it runs. The agent setup inventory of a
  subdirectory run now covers the whole repo.
- With a GitHub App token, the sticky comment is now found and updated instead of re-posted on every
  run. Each workflow and job owns its own comment, marked by a `<!-- pharn-ci scope: ... -->` line
  under the marker, so sibling jobs no longer overwrite each other. Comments from earlier versions
  keep being updated, but a PR whose single comment was shared by two jobs gains one comment for
  the second job after the upgrade.
- When the Action falls back to the GitHub compare API and the response has no `charset=utf-8` (it
  arrives as bytes) the diff is decoded as UTF-8, and a body that is not diff text (such as JSON)
  degrades to `DIFF_UNAVAILABLE`. Before, the step crashed with "text.split is not a function" and
  wrote no summary, report or outputs.
- A hung GitHub API or `git` call no longer stalls the Action for minutes per stage. Each API request
  is aborted after 30 s, and a 5xx, a network error or a rate limit asking for at most 60 s is retried
  once (honouring `retry-after` and `x-ratelimit-reset`); `git` calls in the Action and the CLI are
  killed after 2 minutes. The README example sets `timeout-minutes: 5` on the step.
- Docs: the `github-token` input says the token is always used in `pr-number` mode; the README
  quick start's `concurrency` group falls back to `github.ref`, so merge-queue entries no longer
  cancel each other; the token-footprint bullet lists `GET /user` and the `pr-number` reads; and
  SECURITY.md's data handling names every message code that quotes a path, including the coverage
  report path quoted by `COVERAGE_PATHS_UNMATCHED`.

### Security

- `SECURITY.md` and `docs/THREAT-MODEL.md` state that pharn-ci has one maintainer: pull requests
  are merged with the `main` ruleset's admin bypass and releases are self-approved, so no second
  person reviews a change; they list what still enforces integrity and the plan for when a second
  maintainer joins. The threat model no longer says `main` takes only reviewed pull requests (F-18).
- A `pull_request_target` run that checked out the base branch no longer tells users to check out the
  PR head, which would run fork code with a write token. `DIFF_UNAVAILABLE` now says it cannot be
  measured safely and points to `pull_request` and `SECURITY.md`; the safe `workflow_run` pattern for
  comments on fork PRs is documented in the README.
- Cobertura path resolution no longer slows down quadratically on a crafted report with thousands
  of `<source>` entries and thousands of filenames (F-24). Results are unchanged, except that a
  relative `filename` starting with `..` is now joined to at most the first 16 distinct sources.
- PR-controlled text in messages (the coverage path from `.pharn/ci.yml`, the base ref) no longer
  renders as links, images, emphasis or @mentions in the PR comment and job summary: markdown
  characters are escaped, `@` cannot mention, and bare URLs are not autolinked. The report JSON
  keeps the message text unchanged.
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
  `vscode-mcp`, `codex-config`, `windsurf-rules`, `cline-rules` and `mcp-config`, plus, for Aider,
  Continue, Roo Code, Amazon Q Developer, Junie, Zed, Augment, Kiro, Goose, OpenCode and Gemini CLI
  and for `.claude/rules/`, `claude-rule`, `aider-config`, `conventions-md`, `continue-rules`,
  `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`, `augment-rules`, `kiro-steering`,
  `goosehints`, `opencode-config` and `gemini-settings`. `.mcp.json`, `.claude/` files and
  `.cursor/rules/` are found in nested directories, and the more specific directory rule wins over
  a file-name rule.
- Report v1: optional `agentSetup.summary` (counts per kind and the tools involved), and an
  `Agent setup: N files · tools` line in the markdown, with the table collapsed above 25 files.
- Report v1 (`schema/report.v1.json`), the stable JSON output, with message codes
  `DIFF_COVERAGE_BELOW_THRESHOLD`, `DIFF_COVERAGE_UNGATED`, `NO_COVERABLE_CHANGES`,
  `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`,
  `DIFF_UNAVAILABLE` and `NO_AGENT_SETUP_FILES`.
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
