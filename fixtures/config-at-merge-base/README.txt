# config-at-merge-base

Inputs for CORE-95: a pull request that edits the pharn-ci config in use is checked with the config as it is at the
merge base; the edit applies after merge.

- `base-ci.yml`: `.pharn/ci.yml` at the merge base. It names the coverage file and excludes `src/b.ts`.
- `coverage.info`: the coverage the PR's test run wrote, with repo-relative paths. `src/a.ts` has one of its two added
  lines covered and `src/b.ts` none, so diff coverage is 50% with the base config (`src/b.ts` excluded), 25% with no
  config, and nothing to measure when every file is excluded.
- `files.txt`: the tracked files.
- `untouched.diff`: the change adds two lines to `src/a.ts` and to `src/b.ts` and leaves the config alone.
- `exclude-all/`: the change also appends `"**"` to `coverage.exclude` (`ci.yml` is the copy it leaves).
- `deleted.diff`: the change also deletes the config.
- `added/`: there is no config at the merge base; the change adds one that excludes every file and sets
  `dependencies.lookup: true`.
- `coverage-file/`: the change points `coverage.file` at `coverage/committed.info`, a coverage file it commits that
  marks every line covered.
- `threshold-raised/`: the config at the merge base sets `threshold: 80`; the change raises it to 90.
