# Config

`.pharn/ci.yml` (each setting meets the CLI flag or Action input by its own rule, listed after the example):

```yaml
coverage:
  file: coverage/lcov.info # or a list of paths and globs, see "Coverage files and globs" below
  format: auto # lcov, cobertura or auto (the default)
  threshold: 80
  exclude:
    - src/generated/**
    - "*.gen.ts"
  # root: packages/core # directory relative coverage paths start from (monorepo); default: the repo root
setup:
  require: false # true fails the check when the repo has no agent setup files
  # expect: [claude-code, cursor] # agent tools that must have a setup file
# test_integrity:
#   mode: block # block, warn or off; can only tighten the test-integrity input (default warn), never loosen it
# dependencies:
#   lookup: true # look added packages up in the public registries (D01-D03); never over the input's `never`
#   min_age_days: 30 # D02; can only be raised
#   min_weekly_downloads: 100 # D03; can only be raised
```

A pull request can edit this file, so a flag or input does not simply override it. Setting by setting:

- `coverage.file`, `coverage.format` and `coverage.root`: the flag or input replaces the config's value.
- `coverage.threshold`: the larger of the flag or input and the config applies; with no flag or input the config's
  value applies as written.
- `coverage.exclude` and `setup.expect`: the config's entries plus the flag's or input's.
- `setup.require`: `true` in either turns it on; a `false` does not turn off the other's `true`.
- `test_integrity.mode`: can only make the `test-integrity` flag or input (default `warn`) stricter; a looser value is
  ignored with `TEST_INTEGRITY_MODE_IGNORED`.
- `dependencies.lookup: true`: turns lookups on over the `dependencies` input's `auto`, never over `never`.
  `dependencies.min_age_days` and `dependencies.min_weekly_downloads` can only raise the defaults (30 and 100).
- `test_integrity.accept_label` and `dependencies.allowed_hosts` are refused with an error: set the `accept-label` and
  `dependency-allowed-hosts` inputs instead.

An org policy applies over all of these; see [Org policy](policy.md), **Precedence**.

**A pull request that edits the config is checked with the config as it is at the merge base; the edit applies
after merge**, as with CODEOWNERS (since 0.12.0). This holds for `.pharn/ci.yml` and for the file the `config` input or
`--config` names:

- The change does not touch the config: it is read from the checkout.
- The change modifies or deletes it: its copy at the merge base is read from git objects (never through a symbolic
  link), so a pull request cannot widen `coverage.exclude`, point `coverage.file` or `coverage.root` elsewhere, lower
  `coverage.threshold` or turn `dependencies.lookup` on for itself.
- The change adds it: the check runs as if there were none, on the inputs and the defaults.
- The copy at the merge base cannot be read (a shallow checkout without the base commit, no common history, a file
  there that is not a regular file): the check runs with no config. `CONFIG_CHANGED_IN_DIFF` is then an error, and the
  verdict `fail`, when a threshold is in force or `test-integrity` is `block`, and a warning otherwise. Check out the
  full history (`fetch-depth: 0`) so it can be read. A copy at the merge base that does not parse fails the step.

`CONFIG_CHANGED_IN_DIFF` says which copy the check used, and TI14 still reports a lowered threshold or an added
exclusion, because it applies to every later pull request once merged. To change the config and rely on the change,
merge the config change first. The Action applies this rule on every run with a local diff; the CLI applies it when you
pass `--base`, and without `--base` it reads the config from the working tree.

## Coverage files and globs

`coverage.file` is one path, or a list of paths and globs (a block list, or a one-line list such as
`file: [coverage/lcov.info, "packages/*/coverage/lcov.info"]`). The `--coverage` flag and the
`coverage-file` input take the same entries.

- An entry with `*`, `**` or `?` is a glob: the same subset as [exclusions](#excluding-files),
  relative to its base, with a leading `*` quoted in YAML. An entry with `[`, `]`, `{` or `}` is
  rejected as unsupported glob syntax, so is a leading `/` or `..`. Any other entry is a literal path.
- The walk skips `.git` and `node_modules` unless the pattern names them, and never follows a
  symbolic link. It stops at 1,000 matched files or 100,000 visited directory entries per run
  (exit code 2 on the CLI, a failed step in the Action).
- An entry that finds nothing is `COVERAGE_FILE_MISSING`, naming it.
- The files are merged: a line's hit counts are summed, so a line covered in any file is covered.
  `auto` detects the format per file; the report names a format only when every file is the same.
- Each file read is logged with its format, on stderr in the CLI. When more than one file is read,
  the line names the file: `coverage: coverage/a.info: lcov (auto-detected)`; with one file it is
  `coverage: lcov (auto-detected)`.

## Excluding files

Generated code, vendored files and the like can be left out of diff coverage with glob patterns.
Patterns come from three sources that are **merged** (a union, never an override):
`coverage.exclude` in `.pharn/ci.yml`, the CLI's `--exclude` flags and the Action's `exclude` input.

- The glob subset is `*` (any run of characters within one path segment), `**` as a whole segment
  (any number of segments, including none) and `?` (one character). Patterns are anchored at the
  repository root, must match the whole path, and are case-sensitive. Braces, `[...]` classes,
  negation (`!`) and backslashes are rejected with an error rather than guessed at.
- A pattern that starts with `*` must be quoted in YAML (`"*.gen.ts"`).
- The list can also be written on one line: `exclude: ["dist/**", "*.gen.ts"]`. Longer lists read
  better as a block list (one `- pattern` line each).
- Only changed files are affected. Excluded files count nowhere in diff coverage; they are listed
  under `diffCoverage.excludedFiles` in the report and in an "Excluded" summary in the comment.
- The agent setup inventory is not affected by exclusions.
- A pull request's own edit to `coverage.exclude` applies after merge, not to itself: the config is read at the merge
  base when the change edits it (see [Config](#config)). The `exclude` input lives in the workflow file, which the
  pull request can still edit; protect it with CODEOWNERS.
