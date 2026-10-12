# pharn-ci — Limits

What pharn-ci does **not** guarantee, stated plainly. pharn-ci is pre-1.0 and not yet released.
These are the design's inherent limits and the known gaps in what is built. For the security design
see [`THREAT-MODEL.md`](./THREAT-MODEL.md).

## 1. What diff coverage measures

- **Coverage is not test quality.** A covered line was executed by some test; nothing says a test
  asserted anything about it. A suite that runs code without checking results scores 100%.
- **Only added lines count.** Removed lines and unchanged context are not measured (a moved line
  counts as added at its new position). A change that deletes the tests for code it leaves in place
  does not lower diff coverage.
- **Only lines the coverage report knows count.** An added line with no `DA` entry in the lcov file
  (a comment, a type, a blank line, a declaration the tool does not instrument) is left out of the
  denominator. What is "coverable" is decided by your coverage tool, not by pharn-ci.
- **Files missing from the coverage report are invisible.** A new source file that no test imports
  is often absent from lcov entirely, so it adds nothing to the denominator instead of counting as
  0%. Configure your coverage tool to include all source files (for example vitest's
  `coverage.include` or `all`) if you want untested files to count.
- **Deleted and binary files are skipped.** Renamed files are measured under their new path; a
  pure rename adds no lines. Rename detection is git's default similarity (`--find-renames`).
- **No coverable changes passes.** When none of the added lines are tracked by the coverage report,
  the verdict is `pass` with `NO_COVERABLE_CHANGES`, even with a threshold of 100.
- **There is no exclude list yet.** Generated or vendored files that appear in the coverage report
  count like any other.
- **Coverage paths must be relative to the repository root.** `SF:` paths are matched exactly
  (case-sensitive) against repo-relative diff paths. Absolute paths under the repo root are
  relativized. In a monorepo, a coverage file whose paths are relative to a package directory
  matches nothing.
- **Percentages are rounded to two decimals** and compared after rounding, so the verdict agrees
  with the number shown. 100% and 0% are reserved for exactly all and exactly none covered.

## 2. When the gate is soft

- **`DIFF_UNAVAILABLE` is a warning, never a failure,** even with a threshold. It is reported when
  there is no base to diff against (a push without a previous commit, or no `base-ref` outside a
  pull request), when neither local git nor the GitHub API can produce the diff (for example a
  shallow checkout and an API error), and when a `pull_request_target` run checked out the base
  branch. Use `fetch-depth: 0` and a `pull_request` trigger and this does not happen in practice.
- **A missing or empty coverage file fails only with a threshold.** `COVERAGE_FILE_MISSING` and
  `COVERAGE_FILE_EMPTY` are errors when a threshold is set and warnings otherwise.
- **`fail-on-threshold: false` makes the step report, not gate.** The verdict and outputs are still
  set.

## 3. Coverage formats

- **lcov only.** The `cobertura` format is accepted by the config parser but not implemented: the
  Action rejects it, and the CLI exits with an error. Other formats are on the roadmap.
- **Malformed lcov lines are skipped silently.** Invalid or orphan `DA` records do not produce a
  message; only a report with no records at all does (`COVERAGE_FILE_EMPTY`).

## 4. Agent setup inventory

- **It is an inventory, not a review.** pharn-ci lists agent setup files and never reads them. It
  does not validate their syntax, judge their content, or check them for prompt injection.
- **Only tracked files are seen.** The list comes from `git ls-files`, so untracked or ignored
  files (a typical `.claude/settings.local.json`) are not listed.
- **The kinds detected are fixed:** `CLAUDE.md` and `AGENTS.md` anywhere in the tree;
  `.claude/settings.json`, `.claude/settings.local.json`, `.cursorrules`,
  `.github/copilot-instructions.md` and `.mcp.json` at the root; and files under `.claude/skills/`,
  `.claude/hooks/`, `.claude/agents/`, `.claude/commands/` and `.cursor/rules/`. Not detected yet,
  among others: `CLAUDE.local.md`, `GEMINI.md`, `.github/instructions/`, `.vscode/mcp.json`,
  `.cursor/mcp.json`, and nested `.mcp.json` or `.claude/` directories.

## 5. Security limits

- **The report is derived from untrusted input.** File paths, coverage data and the config file
  come from the change under review. pharn-ci neutralizes what would break the PR comment's markdown
  (control characters, HTML in messages), but the numbers are only as honest as the coverage file
  the PR's own test run produced. pharn-ci cannot detect a test run that was altered to write a
  favorable lcov file.
- **Coverage and config paths are not confined to the repository.** They are resolved against the
  workspace (Action) or the current directory and repo root (CLI), and may point anywhere the job
  can read, such as `$RUNNER_TEMP`. The file is only parsed as lcov or config, never echoed, but its
  path appears in `COVERAGE_FILE_MISSING` messages.
- **Input sizes are not capped.** The coverage, diff and config parsers read their whole input. Git
  output is limited to 256 MiB. A hostile file can make the job slow or run out of memory; it cannot
  make pharn-ci write anywhere but `report.json`, the job summary and its PR comment.
- **pharn-ci cannot protect the job from the PR.** On `pull_request`, the PR's own code (its tests)
  runs in the same job before pharn-ci does. pharn-ci's guarantees are about what pharn-ci itself
  does with the token and with the input it reads.

## 6. Distribution

- **Pre-1.0.** Report v1 is stable within v1 (fields are only added; codes are never renamed), but
  inputs, defaults and the comment layout may still change between minor versions.
- **The CLI is not published to npm yet.** Build it from source (`pnpm install && pnpm build`).
- **The Action runs on the runner's Node 24** (`runs.using: node24`).
- **Platform.** Developed and tested on Linux and macOS. The Action is tested on `ubuntu-latest`
  only.
