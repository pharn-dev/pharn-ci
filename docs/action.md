# Action reference

| Input               | Default                     |                                          |
| ------------------- | --------------------------- | ---------------------------------------- |
| `coverage-file`     | `coverage.file` from config | Coverage report paths or globs (`*`, `**`, `?`), one per line, relative to the workspace; all are merged ([Coverage per ecosystem](coverage.md#coverage-per-ecosystem)) |
| `coverage-format`   | `coverage.format`, then `auto` | `lcov`, `cobertura` or `auto` (detect it from the start of the file) |
| `coverage-root`     | `coverage.root`, then the repo root | Directory relative coverage paths start from, e.g. `packages/core` in a monorepo |
| `threshold`         | `coverage.threshold` from config, then none | Minimum diff coverage %, inclusive. A higher `coverage.threshold` in `.pharn/ci.yml` applies over it |
| `base-ref`          | PR base; merge queue base; on `push`, the previous head (`before`) | Ref or SHA to diff against. A `base-ref` found neither in the checkout nor through the GitHub API fails the step |
| `pr-number`         | none                        | Pull request to measure when the event has no `pull_request` payload (`workflow_run`, `workflow_dispatch`). The PR, its diff and its file list come from the GitHub API and no PR code is checked out. See [Fork PRs](#fork-prs-comment-from-workflow_run) |
| `head-sha`          | none                        | Commit SHA the PR head must be; the step fails otherwise. Set it to `${{ github.event.workflow_run.head_sha }}`. Only valid with `pr-number` |
| `exclude`           | none                        | Globs of changed files to leave out of diff coverage, comma or newline separated; added to `coverage.exclude` |
| `require-agent-setup` | `setup.require`, then `false` | Fail when the repo has no agent setup files; the step fails through `fail-on-verdict`. `false` does not turn off a `setup.require: true` in `.pharn/ci.yml` |
| `expect-agent-setup` | `setup.expect`, then none  | Agent tools that must have a setup file, comma or newline separated; added to `setup.expect`; a missing one is `AGENT_SETUP_EXPECTED_MISSING` |
| `test-integrity`    | `warn`                      | How strictly to treat weakened tests: `block`, `warn` or `off`. `test_integrity.mode` in `.pharn/ci.yml` can only make it stricter, never looser (a looser value is ignored with `TEST_INTEGRITY_MODE_IGNORED`). In `block` a block-level finding fails the check, in `warn` it warns, in `off` nothing is checked. The signals so far are TI01 (a test file deleted), TI02 (a test removed from a test file that stays), TI03 (a skip added to a test), TI04 (a `.only`, `fit` or `fdescribe` added), TI05 (a test emptied of its assertions, or with fewer), TI06 (a test weakened), TI07 (an expected value of a test edited to match the source), TI08 (snapshots regenerated or updated in bulk), TI09 (a test-runner setting loosened), TI10 (a test script in `package.json` weakened), TI11 (CI stopped running tests), TI12 (a module under test mocked), TI13 (a coverage-ignore comment added to source), TI14 (a lower coverage threshold or a wider exclusion in the config), TI16 (a lint or type suppression comment added to a test file) and TI17 (an assertion that always passes) |
| `dependencies`      | `auto`                      | [Dependency safety](checks/dependencies.md) for the packages a change adds or changes: `auto` runs the offline checks D04 (lockfile drift) and D05 (a source outside the npm and PyPI registries); `lookup` also looks each added unscoped package up in `registry.npmjs.org`, `api.npmjs.org` and `pypi.org` (D01 to D03; only the package name is sent); `never` runs nothing. `dependencies.lookup: true` in `.pharn/ci.yml` turns lookups on over `auto`, never over `never`. Any other value fails the step |
| `dependency-allowed-hosts` | none               | Registry hosts your team runs (Artifactory, Nexus, a private PyPI index) whose URLs [D05](checks/dependencies.md) accepts besides the four public ones, comma or newline separated. Each is an exact host name matched case-insensitively (the letters A-Z and a-z, digits, `.` and `-`; no scheme, path, port, user name or wildcard), at most 50, and a URL on it still has to be `https` with no user name, password or port. An app policy's `dependencies.allowed_hosts` replaces the list; `.pharn/ci.yml` cannot set it. An entry that is not a host name fails the step |
| `accept-label`      | `pharn/accepted`            | Name of the pull request label a reviewer who is not the PR author applies to sign off `test-integrity: block` findings, at most 50 characters. An app policy's `test_integrity.accept_label` replaces it; never read from `.pharn/ci.yml` or a `file:` policy. See [Accept label](#accept-label) |
| `policy`            | `auto`                      | Where the [org policy](policy.md) comes from: `auto` fetches it from the pharn.dev app when the job grants `id-token: write` (only the OIDC token and the repo name are sent; no policy, or a job that does not grant `id-token: write`, is silent; a token request the runner offers that then fails or times out is a `POLICY_UNAVAILABLE` warning), `never` uses none, `required` fails the check when no policy can be fetched, `file:<path>` reads a policy document from the workspace (the pull request can change it, so it can only tighten; nothing is fetched). Any other value fails the step |
| `app-url`           | `https://pharn.dev`         | Origin of the pharn.dev app the policy is fetched from. `https` only, with no credentials, path, query or fragment; the OIDC audience stays `pharn.dev` whatever it is |
| `upload`            | `auto`                      | Whether to [upload the run to pharn.dev](upload.md): `auto` uploads `report.json` and `meta.json` (redacted) when the job grants `id-token: write` and the organization installed the Pharn GitHub App, `never` turns it off. A failed upload never fails the check. Not read from `.pharn/ci.yml`. Any other value fails the step |
| `junit-paths`       | none                        | JUnit XML files the test step wrote, as paths or globs (`*`, `**`, `?`) relative to the workspace, newline or comma separated; a path outside the workspace fails the step. Fills the [Flaky](checks/flaky-tests.md) section and `flaky`, applies the app's quarantine list, and adds the normalised results to an upload. Test results never change the verdict. Not read from `.pharn/ci.yml` |
| `comment`           | `true`                      | Post/update one sticky PR comment per workflow and job |
| `fail-on-verdict`   | `true`                      | Fail the step when the verdict is `fail`, whatever made it fail: diff coverage, a test-integrity block, or an org policy violation or error (a required policy included). With `false` the step reports and never gates |
| `fail-on-threshold` | none                        | Deprecated old name of `fail-on-verdict`, still read with a warning when `fail-on-verdict` is not set; ignored (with a warning) when both are |
| `config`            | `.pharn/ci.yml`, may be absent | Config file path; a file named here that does not exist fails the step |
| `github-token`      | `github.token`              | Token for the comment and diff fallback, and in `pr-number` mode always for reading the pull request, its diff and its file tree; `pull-requests: write` for the comment (`pull-requests: read` is enough for `pr-number` mode without one), may be empty with `comment: false` and a local diff outside `pr-number` mode. On every run that has a pull request (an event payload with one, such as `pull_request` and `pull_request_target`, or `pr-number` mode) it also lists the pull request's commits (`GET /repos/{owner}/{repo}/pulls/{n}/commits`, at most 3 pages) for [agent-PR detection](output.md#agent-prs), which needs `pull-requests: read`; with an empty or under-scoped token the commits cannot be read and every pull request counts as an agent PR. With `test-integrity: block` the [accept label](#accept-label) also reads the pull request and its issue events (`GET /repos/{owner}/{repo}/issues/{issue_number}/events`), which `pull-requests: read` (or `issues: read`) allows |

| Output          |                                                       |
| --------------- | ----------------------------------------------------- |
| `report-path`   | Path to `report.json` (Report v2)                     |
| `verdict`       | `pass`, `warn` or `fail`                              |
| `diff-coverage` | Diff coverage percent, or empty when not computed     |
| `run-url`       | Page of the uploaded run on pharn.dev; set only when the run was uploaded |

## Accept label

In `test-integrity: block` a block-level finding fails the check. A reviewer who is not the PR author can sign it off
by applying the accept label (`pharn/accepted`, the name in the `accept-label` input, or the name an app policy sets)
to the pull request. The
Action then downgrades every block finding to `warn`, adds `TEST_INTEGRITY_ACCEPTED` (`info`) and records who accepted
it in `testIntegrity.accepted`; the comment says `Accepted via label ... by @login`. The label also lowers a per-file
`TEST_INTEGRITY_INDEX_UNAVAILABLE` error and a `TEST_INTEGRITY_TEXT_TRUNCATED` error to `warn`, but never the error that
says TI02 and TI05, or TI09, did not run. Diff coverage and every other
check are unaffected, so a run below its threshold still fails.

- **Who counts.** The newest `labeled` event for the label decides. Its actor must be a user account (not a bot or an
  organization) and not the PR author, compared case-insensitively. Otherwise the label is ignored, the blocks stand,
  and `TEST_INTEGRITY_ACCEPT_IGNORED` (`warn`) says why: the author applied it, a non-user account applied it, no
  labeling event was found, or the pull request or its events could not be read. Anything the Action cannot read counts
  as ignored. A login is read as GitHub spells it: a letter or digit, then up to 38 letters, digits or `-`, or an
  Enterprise Managed User login `handle_shortcode` (such as `reviewer_acme`: the handle, one `_` and a shortcode of 3
  to 8 letters or digits, at most 39 characters). An actor whose login is neither is unreadable.
- **Where it is set.** The `accept-label` input in the workflow, or an app policy's `test_integrity.accept_label`, which
  replaces the input's name when it passes the same check (a name the check refuses leaves the input's name in force,
  with one warning that does not name it). `test_integrity.accept_label` in `.pharn/ci.yml` is refused with an error,
  and in a `file:` policy it is not applied (`POLICY_OVERRIDE_IGNORED`), because the change under review can edit
  those files.
- **When it is looked at.** On `pull_request` runs and `pr-number` runs, in `test-integrity: block`, with at least one
  block finding, or one of those two errors, and only when the pull request carries the label. `merge_group`, `push`, `pull_request_target` and
  `workflow_run` runs without `pr-number` never ask, so a block there stays a block. The CLI has no pull request and no
  labels and never honours the label; `--accept-label` is an unknown option.
- **Triggers.** The label counts on a run that happens after it is applied, so list `labeled` and `unlabeled` next to
  the defaults: `on: pull_request: types: [opened, synchronize, reopened, labeled, unlabeled]`.
- **Token.** `pull-requests: read` (or `issues: read`); the quick start's `pull-requests: write` includes it.
- **Not tied to a commit.** The sign-off belongs to the pull request: a later push keeps the label. Remove the label
  to have the new commits judged again. See [docs/LIMITS.md](LIMITS.md).

## Fork PRs: comment from workflow_run

On a PR from a fork the `pull_request` token is read-only, so pharn-ci can only write the job
summary. To get the sticky comment on fork PRs without ever running PR code with a write token,
split the work in two workflows. Do not use `pull_request_target` for this: it checks out the base
branch with a write token, and checking out the PR head there would run fork code with that token.

The first workflow runs on `pull_request` with a read-only token, runs your tests and uploads the
coverage file together with the PR number:

```yaml
# .github/workflows/pharn-ci.yml
name: pharn-ci
on: pull_request

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      # ...set up your toolchain and run tests with lcov or Cobertura output, e.g.:
      - run: npx vitest run --coverage --coverage.reporter=lcov
      - uses: pharn-dev/pharn-ci@v0.11.0 # or, better, the tag's full commit SHA
        with:
          coverage-file: coverage/lcov.info
          threshold: 80
          comment: false
      - env:
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: echo "$PR_NUMBER" > pr-number
      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: pharn-ci-input
          path: |
            coverage/lcov.info
            pr-number
```

The second workflow runs on `workflow_run` in the context of your default branch, with a token that
can comment. It downloads the artifact into the runner's temp directory and never executes it:

```yaml
# .github/workflows/pharn-ci-comment.yml
name: pharn-ci comment
on:
  workflow_run:
    workflows: [pharn-ci]
    types: [completed]

permissions:
  contents: read
  pull-requests: write
  actions: read

jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      # The default branch: your trusted config and .pharn/ci.yml, never the PR.
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: pharn-ci-input
          path: ${{ runner.temp }}/pharn-ci-input
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
      # Keep digits only. The artifact is attacker-controlled: never put its text into a script.
      - id: pr
        env:
          PR_FILE: ${{ runner.temp }}/pharn-ci-input/pr-number
        run: echo "number=$(tr -dc '0-9' < "$PR_FILE" | head -c 10)" >> "$GITHUB_OUTPUT"
      - uses: pharn-dev/pharn-ci@v0.11.0 # or, better, the tag's full commit SHA
        with:
          coverage-file: ${{ runner.temp }}/pharn-ci-input/coverage/lcov.info
          pr-number: ${{ steps.pr.outputs.number }}
          head-sha: ${{ github.event.workflow_run.head_sha }}
          fail-on-verdict: false # the first workflow already gates
```

The artifact comes from the fork and is attacker-controlled, so pharn-ci treats `pr-number` and the
coverage file as untrusted. It checks that `pr-number` is a plain number, reads the PR's base and
head through the GitHub API, and fails the step when `head-sha` (the tested commit, from the trusted
`workflow_run` event) is not the PR's head. The diff and the file list also come from the API; no
PR code is checked out or run. What it cannot check is that the coverage file is what the tests
produced: a fork can upload a coverage file that flatters its own PR. The comment reports what the
`pull_request` run uploaded, and that run's verdict is the gate.

The test text cannot be read in `pr-number` mode, so with `test-integrity: block` a PR that modifies a test file or a
test-runner config fails the check there (`TEST_INTEGRITY_INDEX_UNAVAILABLE`, an error). Use `test-integrity: warn` for
that flow and keep the block gate on the `pull_request` run.
