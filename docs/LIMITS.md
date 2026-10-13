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
  or no class-level `<line>` record in a Cobertura file (a comment, a type, a blank line, a
  declaration the tool does not instrument) is left out of the denominator. What is "coverable" is
  decided by your coverage tool, not by pharn-ci.
- **Files missing from the coverage report are invisible.** A new source file that no test imports
  is often absent from the coverage report entirely, so it adds nothing to the denominator instead
  of counting as 0%. Configure your coverage tool to include all source files (for example vitest's
  `coverage.include` or `all`) if you want untested files to count.
- **Deleted and binary files are skipped.** Renamed files are measured under their new path; a
  pure rename adds no lines. Rename detection is git's default similarity (`--find-renames`).
- **No coverable changes passes.** When none of the added lines are tracked by the coverage report,
  the verdict is `pass` with `NO_COVERABLE_CHANGES`, even with a threshold of 100.
- **Exclusions apply to changed files only.** Patterns from `coverage.exclude`, `--exclude` and the
  Action's `exclude` input (merged, never overriding each other) remove matching changed files from
  every count and from the table. They are listed in `diffCoverage.excludedFiles` and in the
  comment's "Excluded" summary; a deleted file is never listed. The agent setup inventory and
  `COVERAGE_FILE_EMPTY` are unaffected, and a change whose every file is excluded is the
  `NO_COVERABLE_CHANGES` pass.
- **The glob subset is small.** `*`, `**` as a whole segment and `?`, anchored at the repository
  root, matching the whole path, case-sensitively. Not supported, and rejected with an error rather
  than matched literally: braces, `[...]` classes, negation (`!`), backslashes, unanchored
  gitignore-style patterns (`foo/` or `*.ts` matching in subdirectories: use `**/*.ts`), `..`
  segments, and case-insensitive matching.
- **Coverage paths must be relative to the repository root.** `SF:` paths are matched exactly
  (case-sensitive) against repo-relative diff paths. Absolute paths under the repo root are
  relativized. In a monorepo, a coverage file whose paths are relative to a package directory
  matches nothing. The same holds for Cobertura `filename` values: they are joined to the
  report's `<source>` entries, and a report made inside a package directory yields paths
  relative to that package, which match nothing. A relative `filename` that starts with `..`
  (after normalization) is joined only to the first 16 distinct `<source>` entries; past them it
  is used as written. Other filenames are joined to every source.
- **Percentages are rounded to two decimals, but the threshold is compared exactly.** 15,999 of
  20,000 lines (79.995%) fails a threshold of 80. When rounding up would show a failing coverage as
  reaching the threshold, it is rounded down instead (79.99%), so the number shown agrees with the
  verdict. 100% and 0% are reserved for exactly all and exactly none covered.
- **Threshold 0 gates no percentage.** Any measured coverage meets it, and the report says so with
  `DIFF_COVERAGE_UNGATED`, as it does without a threshold. Unlike no threshold, it still makes a
  missing coverage file or diff an error (below).

## 2. When an input is missing

- **A missing input fails only with a threshold.** `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`,
  `COVERAGE_FORMAT_UNSUPPORTED` and `DIFF_UNAVAILABLE` are errors, and the verdict is `fail`, when a
  threshold is set (0 included): a gate that cannot measure fails closed. Without a threshold they
  are warnings.
- **`DIFF_UNAVAILABLE` has several causes.** It is reported when there is no base to diff against (a
  push without a previous commit, or no `base-ref` outside a pull request or merge queue), when
  neither local git nor the GitHub API can produce the diff (for example a shallow checkout and an
  API error), when the diff is over the size limit, and when a `pull_request_target` run checked out
  the base branch.
  Use `fetch-depth: 0` (or let the GitHub API fallback fetch the diff) and a `pull_request` trigger
  and this does not happen in practice. A `base-ref` you set that is found neither in the checkout
  nor through the GitHub API is not `DIFF_UNAVAILABLE`: it fails the step, like a bad `--base` in
  the CLI.
- **`fail-on-threshold: false` makes the step report, not gate.** The verdict and outputs are still
  set.

## 3. Coverage formats

- **lcov and Cobertura, in the Action and the CLI.** Both read the format you name (`lcov`,
  `cobertura`) or, with `auto` (the default), detect it from the start of the file. Clover and
  JaCoCo native XML are not supported; other formats are on the roadmap.
- **Detection reads only the first 1 KiB.** After an optional byte order mark and leading
  whitespace, a file that starts with `TN:` or `SF:` is lcov. XML is Cobertura when its root
  element is named `coverage`, the root has no `clover` attribute, and its first child, if the
  window shows one, is not `project` (that is Clover). The XML declaration, comments and DOCTYPE
  before the root are skipped. A root start tag that does not end within the first 1 KiB makes
  the file unknown, so a real Cobertura report with a very long prolog needs
  `coverage-format: cobertura`. A file of only whitespace is empty.
- **Unknown is not guessed.** Under `auto`, a file that is neither lcov nor Cobertura (Clover,
  JaCoCo native XML, any other text) is `COVERAGE_FORMAT_UNSUPPORTED`, an error with a
  threshold. An empty file is `COVERAGE_FILE_EMPTY`. Naming a format skips detection: `cobertura`
  on a Clover or JaCoCo native file reads no records and is `COVERAGE_FILE_EMPTY`.
- **Malformed lcov lines are skipped silently.** Invalid or orphan `DA` records do not produce a
  message; only a report with no records at all does (`COVERAGE_FILE_EMPTY`).
- **Malformed Cobertura lines are skipped silently too.** A `<line>` whose `number` is not an
  integer >= 1, or whose `hits` is present but not a finite number >= 0, is dropped (a missing
  `hits` counts as 0). A file with no valid line is absent from the map, and a report with no
  valid line at all is `COVERAGE_FILE_EMPTY`.
- **Cobertura methods, branches and rates are ignored.** Only class-level `<line>` records count.
  A `<line>` inside `<methods>`, the `branch` and `condition-coverage` attributes, and every
  `line-rate` or `branch-rate` are not read, so branch coverage never affects the verdict.
- **Cobertura merges by maximum, lcov by sum.** One file repeated across classes (JaCoCo inner
  classes) or packages (a shared source) keeps the highest hit count per line, because Cobertura
  repeats a file's lines and summing would double-count them. Repeated lcov records are summed.
- **The first usable `<source>` wins.** A relative `filename` is joined to the report's sources in
  order and the first join that lies under the repo root is used. pharn-ci reads no files, so it
  cannot tell which source actually holds the file; with several sources under the root, the
  first can be wrong. An absolute `filename` is never joined. With no usable source, the
  filename is used as written, normalized.
- **The XML reader is minimal.** It skips comments, CDATA, processing instructions and DOCTYPE
  declarations (no entity or DTD expansion), decodes only the five predefined and numeric
  character references, and ignores namespace-prefixed element names. Text inside CDATA, such
  as a source path written as CDATA, is not read.

## 4. Agent setup inventory

- **It is an inventory, not a review.** pharn-ci lists agent setup files and never reads them. It
  does not validate their syntax, judge their content, or check them for prompt injection.
- **Only tracked files are seen.** The list comes from `git ls-files`, so untracked or ignored
  files (a typical `.claude/settings.local.json`) are not listed.
- **The kinds detected are fixed (21):** `claude-md`, `claude-local-md`, `agents-md`, `gemini-md`,
  `claude-settings`, `claude-settings-local`, `claude-skill`, `claude-hook`, `claude-agent`,
  `claude-command`, `cursor-rules`, `cursor-mcp`, `copilot-instructions`,
  `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`, `vscode-mcp`, `codex-config`,
  `windsurf-rules`, `cline-rules` and `mcp-config`.
- **Nested directories:** `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md` and `.mcp.json`
  match anywhere in the tree, as do `.claude/settings.json`, `.claude/settings.local.json` and
  files under `.claude/skills/`, `.claude/hooks/`, `.claude/agents/`, `.claude/commands/` and
  `.cursor/rules/`. Everything else matches at the repo root only: `.cursor/mcp.json`,
  `.vscode/mcp.json`, `.codex/config.toml`, `.cursorrules`, `.windsurfrules`, `.windsurf/rules/`,
  `.clinerules` and everything under `.github/`.
- **Precedence:** a path is classified by the first matching rule, and rules tied to a directory
  or full path come before the file-name rules. So `.claude/agents/CLAUDE.md` is a `claude-agent`,
  not a `claude-md`.
- **The summary is derived.** `agentSetup.summary` holds counts per kind and the tools those kinds
  belong to, from a fixed list. It is computed from the file list and says nothing about content.

## 5. Security limits

- **The report is derived from untrusted input.** File paths, coverage data and the config file
  come from the change under review. pharn-ci neutralizes what would break the PR comment's markdown
  (control characters, HTML in messages), but the numbers are only as honest as the coverage file
  the PR's own test run produced. pharn-ci cannot detect a test run that was altered to write a
  favorable coverage file.
- **Exclusions come from the PR.** `coverage.exclude` lives in `.pharn/ci.yml` and the Action's
  `exclude` input in the workflow file, both of which the change under review can edit. A PR can
  exclude its own files, ultimately all of them, which passes as `NO_COVERABLE_CHANGES`. The gate
  is only as honest as the config the PR carries. Protect `.pharn/ci.yml` and the workflow with
  CODEOWNERS so changes to them need a code owner's review.
- **Coverage and config paths are not confined to the repository.** They are resolved against the
  workspace (Action) or the current directory and repo root (CLI), and may point anywhere the job
  can read, such as `$RUNNER_TEMP`. The file is only parsed as coverage (lcov or Cobertura) or
  config, never echoed, but its path appears in `COVERAGE_FILE_MISSING` messages.
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
