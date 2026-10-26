# Security Policy

pharn-ci runs inside other people's CI. The GitHub Action runs with the `pull-requests: write`
permission to post a sticky PR comment, and it reads files and diffs from the repository it checks.
That makes its integrity, and the integrity of its release tags, part of the product. We welcome
coordinated disclosure of any vulnerability in this repository.

> **Status:** pharn-ci is pre-1.0. Only the **latest** release and `main` receive security fixes.

## Security surface

- **The GitHub Action** (`action.yml`, `packages/action`): runs in a consumer's workflow with their
  `GITHUB_TOKEN`. It makes no network calls except to the GitHub API and, only when the `policy` input is `auto`
  or `required` and the job grants `id-token: write`, one `GET /api/v1/policy` to the `app-url` origin (https only,
  default `https://pharn.dev`) to read the org policy and, unless the `upload` input is `never` and only when the job
  grants `id-token: write`, the upload of the run to pharn.dev: two `POST` requests to the same origin and one `PUT`
  of the redacted `report.json` and `meta.json` to a signed storage URL it names (`upload: never` turns that off). It
  has no telemetry.
- **Input parsing** (`packages/core`): lcov, Cobertura XML, unified diffs and the config file are
  untrusted input, parsed by hand-written parsers. A crafted file must not crash, hang or exhaust memory in the
  consumer's CI.
- **The CLI** (`packages/cli`): reads files and runs `git` in the working directory.
- **Release integrity**: `packages/action/dist` is committed and must match a build of the sources
  (CI fails if it is stale), and consumers pin exact release tags such as
  `pharn-dev/pharn-ci@v0.3.0`, or their commit SHA. Tags matching `v*` are never moved or deleted
  (enforced by a ruleset), and releases are cut from verified `main` commits
  ([`docs/RELEASING.md`](./docs/RELEASING.md)). Release tags are unsigned lightweight tags, so the
  full commit SHA, not the tag, is what a consumer can verify.

## Maintainer model: one person today

pharn-ci has a single maintainer, who is also the only code owner (`.github/CODEOWNERS`). Every
control in this repository that needs a second person is therefore procedural, not enforced:

- **Merges.** The `main` ruleset requires one approving review from a code owner, but GitHub does not
  let an author approve their own pull request. Pull requests, including ones written with AI coding
  agents, are merged under the maintainer's account using the ruleset's admin bypass
  (`pull_request` mode). No second person reviews them.
- **Releases.** The `release` environment's required reviewer is the same maintainer, who approves
  their own release; `prevent_self_review` is off, because turning it on with one reviewer would
  block every release.

What still holds without a second person, because GitHub enforces it for the admin too:

- no direct push, force-push or deletion on `main`; changes land only as signed, squash-merged
  commits with linear history;
- the bypass skips the approval only: a pull request cannot merge until all six required checks pass
  (`ci`, with its stale-`dist` check; `Action pins`; `gitleaks`; CodeQL's
  `Analyze (javascript-typescript)`; and the two Socket Security checks);
- third-party actions pinned to commit SHAs; `v*` tags that nobody can move or delete; immutable
  releases, cut only from a verified `main` commit by a job that installs nothing.

**Plan:** when a second maintainer joins, add them to `.github/CODEOWNERS` and as a reviewer of the
`release` environment, set `prevent_self_review: true` on that environment, and stop using the admin
bypass for merges (then remove it from the `main` ruleset). Until then, treat a pharn-ci release as
reviewed by one person, and pin the commit SHA you have checked.

The security design, with each mitigation tied to the test that enforces it, is in
[`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md); what pharn-ci does not guarantee is in
[`docs/LIMITS.md`](./docs/LIMITS.md).

## Data handling

pharn-ci has no backend of its own in the Action. Everything it reads stays on the runner, and everything it writes
goes to your own GitHub: the PR comment, the job summary, the step log and a file in `RUNNER_TEMP`. The one exception
is the org policy request (row below), which sends only an OIDC token and the repository name. The table describes
the GitHub Action; the CLI makes no network calls and prints to your terminal.

| Data | Where it goes | Retention |
| ---- | ------------- | --------- |
| Source code and working tree | Nowhere. Read locally by `git ls-files`, `git ls-tree` (file sizes only) and `git diff`. In PR-number mode (the `pr-number` input) the checkout is not the PR, so the file list is read from the git trees API instead: the request carries the owner/repo and the PR head SHA, and the response lists paths only. | Not stored. |
| Unified diff of the change | Nowhere when the base commit is in the local checkout. In PR-number mode it always comes from GitHub's compare API, with a request carrying the owner/repo, the PR base SHA (or the `base-ref` input text) and the PR head SHA. Otherwise (for example on a shallow checkout) it is fetched from GitHub's compare API, at `api.github.com` or your GHES instance via `GITHUB_API_URL`; the request carries the owner/repo, the base ref as given (the `base-ref` input text, the PR base SHA or the push `before` SHA) and the head SHA. | Held in memory for the run, not stored. |
| Coverage file contents | Parsed locally. Only derived data leaves the parser: the percentages and line numbers of changed files (see below) and, when no path in the coverage report matches a tracked file, `COVERAGE_PATHS_UNMATCHED` quotes one example path from the report and a suggested coverage root in the comment, summary and `report.json`. | Not stored; the quoted path lives as long as the comment or summary. |
| `.pharn/ci.yml` and Action inputs | Parsed locally. A parse or validation error can quote a key name and some values (for example an unsupported YAML value, an exclude pattern or the `coverage-format` input) into the step log. | Step log, under your log retention. |
| Paths of changed files the coverage report tracks, their uncovered line numbers, per-file and total percentages and line counts, the threshold, excluded changed-file paths, changed config and workflow paths, deleted or renamed-away test file paths, changed files the diff shows as binary, agent setup file paths and kinds, the verdict | The PR comment and job summary in your own GitHub, and `report.json`. Agent setup files are matched by path only and never read. | The comment persists until someone deletes it; the summary follows your log retention. |
| Workflow name and job id | The PR comment's scope line, `<!-- pharn-ci scope: <workflow>/<job> -->`, URL-encoded. It tells the workflow and job's comments apart. | The comment persists until someone deletes it. |
| Paths and refs quoted in messages | Message text in the comment, summary and `report.json`: the coverage path in `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `COVERAGE_FILE_TRACKED`; one coverage-report path and a suggested root directory in `COVERAGE_PATHS_UNMATCHED`; `base...head` (or the `base-ref` input text) in `DIFF_UNAVAILABLE`; changed config or workflow paths in `CONFIG_CHANGED_IN_DIFF`, deleted or renamed-away test file paths in `TEST_FILES_DELETED` and binary file paths in `DIFF_BINARY_COVERED_FILE` (up to five each, the rest counted); and the first empty agent setup file path in `AGENT_SETUP_FILE_EMPTY`. | As above. |
| Repo owner/name, PR number, base and head SHAs or refs | Your GitHub API only: compare commits (the diff fallback above), in PR-number mode `GET` of the pull request (its base and head SHAs) and `GET` of the git tree of its head (file paths), `GET /user` (to learn which login the token comments as; when the token cannot read it, no login is guessed and comments are matched by scope), list PR comments, create or update the one pharn-ci comment of this workflow and job, and delete duplicates of it that concurrent runs left (only comments that start with pharn-ci's marker and share the kept comment's author login and scope line). Requests carry Octokit's standard `User-Agent` (library and Node.js versions, OS and architecture). | Per GitHub's own policies. |
| `github-token` | Only as the `Authorization` header of those GitHub API requests. Never logged or written. | Not stored. |
| Other environment variables and secrets | Not read, apart from the runner's standard `GITHUB_*` and `RUNNER_*` variables (workspace, temp dir, event payload, repository, API URL) through `@actions/core` and `@actions/github`. `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are honoured for the GitHub API. | Not stored. |
| Step log | Progress lines (coverage format, verdict, comment id) and warnings, which can include `git` or GitHub API error text. | Your log retention. |
| `report.json` | Written to `$RUNNER_TEMP/pharn-ci/report.json` (the `report-path` output): the same data as the comment, untruncated. | Ephemeral: the runner clears `RUNNER_TEMP` after the job, unless your workflow uploads the file. |
| Org policy request (`policy: auto` or `required`, only with `id-token: write`) | One `GET <app-url>/api/v1/policy?repo=<owner>/<name>` with a GitHub OIDC token (audience `pharn.dev`, masked in the log, sent only to the https `app-url` origin, never on a redirect) as the `Authorization` header, `Accept` and a `User-Agent: pharn-ci/<version>`. Nothing else: no file contents, diff, coverage or log. Fork PRs and jobs without `id-token: write` get no token, so nothing is sent. With `policy: never` or `file:<path>`, nothing is sent. | Per the app's own policy. |
| Anything else sent to Pharn | Nothing. No telemetry, no license check, no update check. | Nothing to retain. |

## Supported versions

| Version  | Supported          |
| -------- | ------------------ |
| Latest   | :white_check_mark: |
| < Latest | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull
requests.**

Report privately through
[GitHub private vulnerability reporting](https://github.com/pharn-dev/pharn-ci/security/advisories/new).
The report stays confidential and embargoed until a fix ships.

Please include, as far as you can:

- The type of issue (e.g. token exposure, path traversal, command injection, denial of service,
  supply-chain).
- The package and source file(s) involved.
- The affected version, tag, branch or commit.
- Step-by-step reproduction instructions and a proof of concept, if you have one.
- The impact: how an attacker might exploit the issue, and what they would gain.

## Response timeline

- **Initial acknowledgement**: within 3 business days of your report.
- **Preliminary assessment and severity**: within 7 days.
- **Resolution target**: critical issues within 30 days; other issues within 90 days.

We will keep you informed, coordinate disclosure timing with you, and credit you in the advisory
unless you ask to remain anonymous.

## Scope

### In scope

- Leaking or misusing the consumer's `GITHUB_TOKEN`, or writing anywhere other than the PR comment
  and job summary.
- Path traversal or arbitrary file read or write through lcov, Cobertura, diff or config input.
- Command injection through the CLI's `git` calls or the Action's inputs.
- A crafted input that crashes, hangs or exhausts memory in the consumer's CI.
- Any way to publish, alter or substitute a release artifact, move a `v*` tag, or ship a
  `packages/action/dist` that does not match the sources.
- A new runtime dependency introduced unnoticed.

### Out of scope

- Vulnerabilities in third-party dependencies that an upstream patch fixes. Please report those
  upstream.
- Issues that require the attacker to already control the CI runner or the consumer's workflow.
- Social engineering, or attacks requiring physical access to a machine.
- Denial of service that does not exploit a specific vulnerability.

## Security best practices for users

1. **Pin the Action to a commit SHA**, not only to a tag (release tags are not signed), and keep
   `permissions:` minimal (`contents: read`, plus `pull-requests: write` only if you want the PR
   comment).
2. **Do not run it on `pull_request_target`.** That event runs in the base repository's context with a
   write token. Its default checkout is the base branch, so the PR cannot be measured, and checking
   out the PR head to measure it would run fork code with that token. pharn-ci reports the diff as
   unavailable instead (`DIFF_UNAVAILABLE`) and never advises checking out the PR head. Two safe
   routes: run pharn-ci on `pull_request` (fork PRs get the job summary only), or, to get the comment
   on fork PRs too, run your tests on `pull_request`, upload the coverage file and PR number as an
   artifact, and run pharn-ci in a second workflow on `workflow_run` with the `pr-number` and
   `head-sha` inputs (see the [README](./README.md#fork-prs-comment-from-workflow_run)). That run reads
   the PR through the GitHub API, checks out and runs no PR code, and fails when the artifact does not
   match the tested commit.
3. **Review the report** before acting on it; it is derived from untrusted PR content.

Thank you for helping keep pharn-ci and its users safe.
