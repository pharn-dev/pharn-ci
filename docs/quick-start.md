# Quick start

The workflow to paste is the first code block of the [README](../README.md#quick-start). This page explains its
choices in full.

Working with Claude Code? The `pharn-ci-install` skill can do this setup for you; see
[Agent skills](agent-skills.md).

Add a workflow that runs your tests with lcov or Cobertura XML output, then pharn-ci. With vitest,
`@vitest/coverage-v8` must be a dev dependency of the project (`npm install --save-dev
@vitest/coverage-v8`); without it `vitest run --coverage` aborts and writes no report.

`fetch-depth: 0` lets pharn-ci diff against the PR base locally, and it is required for TI02, TI05, TI06, TI07, TI09,
TI12, P13, dependency safety, the stale-instruction check (SI01–SI03) and the base copy of a `file:` policy, which read
the text of the change. A7 and P02–P07 read the committed files at `HEAD`, so they need the checkout to be the pull
request head. Without `fetch-depth: 0` the diff comes from the GitHub compare API and none of that text is read: this is
a warning in `test-integrity: warn`, and a failed check in `test-integrity: block`
when the change modifies a test file or a test-runner config. A local `git diff` that fails against a base that is in
the checkout fails the step in every mode. Without a threshold, pharn-ci never fails the step on coverage alone, but
`test-integrity: block` can fail it. With a merge queue, add `merge_group` to `on:`; pharn-ci diffs
the queued change against the queue's base (`merge_group.base_sha`). The `concurrency` group
cancels an older run when a new commit is pushed; without it, two runs that each post the sticky
comment are cleaned up to one, but the older run may write last. Keep the `|| github.ref`
fallback: a `merge_group` event has no PR number, so without it every queue entry shares one group
and cancels the others' required check.

Each GitHub API request pharn-ci makes is aborted after 30 s, and a 5xx, a network error or a rate
limit that asks for at most 60 s is retried once; each `git` call is killed after 2 minutes. The OIDC
token request (only with `id-token: write`) is given up after 30 s, and the run goes on as if the runner offered no
token. A run makes a handful of requests, and the upload to pharn.dev ends within 90 s whatever the app does, so
`timeout-minutes: 5` on the step bounds even a slow GitHub or pharn.dev without cutting a normal run short; without
it, a stuck step runs until the job's 6-hour limit.

Release tags are exact versions (`v0.1.0`), never moved or deleted, but they are unsigned
lightweight tags, so there is no tag signature to verify. Pinning the tag's full commit SHA is the
integrity control; Dependabot keeps either up to date.

`coverage-file` may be left out. With no `coverage-file` input and no `coverage.file` in the
config, pharn-ci auto-discovers the report at one of five paths, relative to the repo root:
`coverage/lcov.info`, `lcov.info`, `coverage.xml`, `coverage/cobertura-coverage.xml` and
`**/coverage.cobertura.xml` (anywhere in the repo outside `.git` and `node_modules`; several
matches are read and merged). If reports are found at more than one of those paths, pharn-ci
refuses to guess and fails with an error asking you to set the path; if none is found, the report
carries a `COVERAGE_FILE_MISSING` message. Each file it reads is logged as `coverage: <path>
(auto-discovered)`. A complete workflow for each of vitest, jest, pytest, .NET and cargo, with no
`coverage-file` set, is in [`examples/workflows/`](../examples/workflows/).

For other test runners and monorepos, see [Coverage](coverage.md).
