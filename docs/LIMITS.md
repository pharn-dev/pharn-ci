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
  the verdict is `pass` with `NO_COVERABLE_CHANGES`, even with a threshold of 100. This holds only
  when the coverage report's paths match tracked files; a report whose paths match none is
  `COVERAGE_PATHS_UNMATCHED` instead (section 7).
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
  matches nothing unless a coverage root is set. The same holds for Cobertura `filename` values:
  they are joined to the report's `<source>` entries, and a report made inside a package directory
  yields paths relative to that package, which match nothing unless a coverage root is set.
  Section 7 describes the check that reports this and the setting that fixes it. A relative
  `filename` that starts with `..`
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
  `COVERAGE_FORMAT_UNSUPPORTED`, `COVERAGE_PATHS_UNMATCHED` and `DIFF_UNAVAILABLE` are errors, and the verdict is `fail`, when a
  threshold is set (0 included): a gate that cannot measure fails closed. Without a threshold they
  are warnings.
- **`DIFF_UNAVAILABLE` has several causes.** It is reported when there is no base to diff against (a
  push without a previous commit, or no `base-ref` outside a pull request or merge queue), when
  neither local git nor the GitHub API can produce the diff (for example a shallow checkout and an
  API error), when the diff is over the size limit, and when a `pull_request_target` run checked out
  the base branch (that run is refused, not measured: checking out the PR head to measure it would
  run fork code with a write token; see `SECURITY.md`).
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
  message. A file (`SF`) with no valid `DA` line is absent from the map, as in Cobertura, and a
  report with no valid `DA` line at all (a crashed or truncated reporter) is `COVERAGE_FILE_EMPTY`.
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
- **Hit counts are summed across coverage files.** When several coverage files list the same
  line, their hits are added, so a line covered in any of them is covered. This is also true of
  two Cobertura files, whose own repeated lines inside one file still merge by maximum. Two
  reports of the same test run have their hits counted twice, which changes the hit counts but
  not whether a line is covered.
- **Several coverage files and globs.** `coverage-file`, `--coverage` and `coverage.file` take
  several entries, each a path or a glob (`*`, `**`, `?`; the exclusion subset). `auto` detects
  the format of each file; an explicit format applies to all of them, so a Cobertura file read as
  lcov is `COVERAGE_FILE_EMPTY` naming it. The report names `diffCoverage.format` only when every
  file has the same format. The first bad file, in entry order and path order within a glob, is
  the one reported. An entry containing `[`, `]`, `{` or `}` is rejected as unsupported glob
  syntax even without `*` or `?`, so a literal coverage path with one of those characters is a
  usage error. The walk goes down from the base, skips `.git` and `node_modules` unless the
  pattern names them, never follows a symbolic link, and stops at 1,000 matched files or 100,000
  visited directory entries per run. A glob that finds nothing is `COVERAGE_FILE_MISSING`.
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
- **The kinds detected are fixed (34):** `claude-md`, `claude-local-md`, `agents-md`, `gemini-md`,
  `claude-settings`, `claude-settings-local`, `claude-skill`, `claude-hook`, `claude-agent`,
  `claude-command`, `claude-rule`, `cursor-rules`, `cursor-mcp`, `copilot-instructions`,
  `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`, `vscode-mcp`, `codex-config`,
  `windsurf-rules`, `cline-rules`, `mcp-config`, `aider-config`, `conventions-md`,
  `continue-rules`, `roo-rules`, `amazonq-rules`, `junie-guidelines`, `zed-rules`,
  `augment-rules`, `kiro-steering`, `goosehints`, `opencode-config` and `gemini-settings`.
- **Nested directories:** `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md` and
  `.goosehints` match anywhere in the tree, as do files under `.claude/skills/`, `.claude/hooks/`,
  `.claude/agents/`, `.claude/commands/`, `.claude/rules/` and `.cursor/rules/`. Everything else
  matches at the repo root only: `.mcp.json`, `.claude/settings.json`, `.claude/settings.local.json`,
  `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`,
  `.cursorrules`, `.windsurfrules`, `.windsurf/rules/`, `.clinerules`, everything under `.github/`,
  `.aider.conf.yml`, `CONVENTIONS.md`, `.continue/rules/`, `.continuerules`, `.roorules`,
  `.roorules-<mode>`, `.roo/rules/`, `.roo/rules-<mode>/`, `.amazonq/rules/`,
  `.junie/guidelines.md`, `.rules`, `.augment/rules/`, `.augment-guidelines`, `.kiro/steering/`,
  `opencode.json`, `opencode.jsonc` and `.gemini/settings.json`.
- **Deliberately not detected:**
  - Sourcegraph Cody: its repo rules were experimental, and the product is being wound down.
  - User-level and global configuration, such as files in a home directory.
  - OpenCode's `.opencode/` directory and Gemini CLI's `.gemini/commands/`.
  - Nested copies of the root-only kinds, such as `packages/app/.rules`, `packages/app/.mcp.json`
    and `packages/app/.claude/settings.json`.
  - Placeholders under a directory kind: a dot-file (`.gitkeep`) or a README (any case, with or
    without an extension) in `.claude/skills/`, `.github/agents/`, `.roo/rules/` and the other
    directories above is not listed, and does not fall through to a file-name kind.
  - Anything with a `node_modules` directory in its path. A vendored copy of agent setup files
    under another name (such as `third_party/`) is still counted, since pharn-ci cannot tell a
    vendored copy from the repo's own.
  - Files that a config names (for example the `read` list in `.aider.conf.yml`): pharn-ci never
    reads a setup file, so it does not follow them.
  - Other tools that also read an existing kind: only `agents-md` credits several tools.
- **Precedence:** a path is classified by the first matching rule, and rules tied to a directory
  or full path come before the file-name rules. So `.claude/agents/CLAUDE.md` is a `claude-agent`,
  not a `claude-md`.
- **Empty files are reported from `HEAD`.** `AGENT_SETUP_FILE_EMPTY` (`warn`) comes from the file
  sizes in `git ls-tree -r -l HEAD`, while the inventory comes from `git ls-files`. A file that is
  staged or changed but not committed has its `HEAD` size, or none. Only size 0 counts: a file
  with only whitespace or a comment is not reported. When `git ls-tree` fails, no empty file is
  reported (the CLI notes it on stderr, the Action warns) and the rest of the report is unchanged.
  In the Action's PR-number mode the checkout is not the PR, so no sizes are read and no empty
  file is reported.
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
- **A PR controls the inputs that grade it.** Besides the config and the workflow, it can add a
  committed coverage file or change `.gitattributes`: `*.ts -diff` makes `git diff` print
  `Binary files ... differ` with no line counts, so those files' added lines are never measured.
  pharn-ci flags these with three warnings, `CONFIG_CHANGED_IN_DIFF` (the diff touches the config in
  use or a file under `.github/workflows/`), `COVERAGE_FILE_TRACKED` (the coverage file is a tracked
  file) and `DIFF_BINARY_COVERED_FILE` (the diff shows a file the coverage report knows as binary).
  They are warnings only, never a `fail`. pharn-ci does not read the base branch's copies of these
  files and does not detect changes to `.gitattributes` itself.
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
- **PR-number mode depends on the GitHub API.** With the `pr-number` input, the diff comes from the
  compare API, so it is subject to GitHub's size limit for compare diffs (a diff over it is
  `DIFF_UNAVAILABLE`), and the file list comes from the git trees API. For a very large repository
  that listing is truncated: pharn-ci warns, and the agent setup scan may miss files. The coverage
  file still comes from the workflow, so a forged one can flatter its own PR; the `pull_request`
  run's verdict is the gate, not the comment.

## 6. Distribution

- **Pre-1.0.** Report v1 is stable within v1 (fields are only added; codes are never renamed).
  Inputs, outputs and message codes are never removed before 1.0, and a renamed input keeps its old
  name, with a warning, for at least one minor release. Defaults may still change, but only in a
  minor release listed under **Changed** in the changelog, and the comment layout may change in any
  release ([`RELEASING.md`](./RELEASING.md#inputs-outputs-and-message-codes)).
- **The CLI is not published to npm yet.** Build it from source (`pnpm install && pnpm build`).
- **The Action runs on the runner's Node 24** (`runs.using: node24`).
- **Platform.** Developed and tested on Linux and macOS. The Action is tested on `ubuntu-latest`
  only.

## 7. Coverage path mapping

- **Paths are matched exactly against `git ls-files`.** After normalization, every path in the
  coverage report is compared with the tracked files, case-sensitively. pharn-ci reads no files,
  so a tracked path is the only evidence a coverage path names a real file.
- **No path matches: `COVERAGE_PATHS_UNMATCHED`.** Diff coverage is not computed, and the report
  says so instead of passing as `NO_COVERABLE_CHANGES`. It is an error, and the verdict `fail`,
  with a threshold (0 included), and a warning without one. When a tracked file ends in a
  coverage path at a path-segment boundary, the message suggests the directory in front of it as
  the coverage root. The hint is a suggestion, never applied.
- **Some paths do not match: `COVERAGE_PATHS_PARTIALLY_UNMATCHED`.** An `info` message with the
  count. Those files' coverage is not used, and the verdict is unchanged.
- **A coverage root fixes package-relative reports.** `coverage.root` in `.pharn/ci.yml`, the
  Action's `coverage-root` input and the CLI's `--coverage-root` flag (the input and the flag win
  over the config) name the repo-relative directory that relative coverage paths start from. It is joined in front of paths that are relative as written, and never in front of an
  absolute one. It is one root for the whole report: a report that mixes packages cannot be mapped
  with it.
- **Absolute paths from another root are reported, not remapped.** A Docker build's `/app/src/a.ts`
  stays unmatched, and so do paths through a symlinked workspace. Write coverage paths relative to
  the repository, or as absolute paths under the checkout path.
- **Both checks are skipped when the tracked-files list is empty**, which is what the Action does
  when `git ls-files` fails (it warns). The report is then what it was before these checks.
- **A changed file missing from the coverage report is never looked at here.** The checks read the
  coverage report's paths only, so a docs-only change with mapped coverage still passes as
  `NO_COVERABLE_CHANGES`.
