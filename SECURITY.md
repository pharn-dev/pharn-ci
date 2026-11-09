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
  `pharn-dev/pharn-ci@v0.10.0`, or their commit SHA. Tags matching `v*` are never moved or deleted
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
goes to your own GitHub: the PR comment, the job summary, the step log and a file in `RUNNER_TEMP`. Two things go to
Pharn, and both only when the job grants `id-token: write`: the org policy request, which sends an OIDC token and the
repository name, and the run upload, which sends the redacted `report.json` and `meta.json` of the run, and with
`junit-paths` a rebuilt, redacted `junit/results.xml` (rows below).
One thing goes to the public package registries, and only when you turn it on with `dependencies: lookup` (or
`dependencies.lookup: true` in `.pharn/ci.yml`, or an org policy): the names of the packages a pull request adds,
one `GET` per name (row "Registry lookups"). The table describes the GitHub Action; the CLI makes no network calls and
prints to your terminal.

| Data | Where it goes | Retention |
| ---- | ------------- | --------- |
| Source code and working tree | Nowhere. Read locally by `git ls-files`, `git ls-tree` (file sizes only), `git diff`, `git cat-file` (committed file text at the merge base and `HEAD`, held in memory in the job), `git merge-base` and `git rev-parse` (commit ids only). In PR-number mode (the `pr-number` input) the checkout is not the PR, so the file list is read from the git trees API instead: the request carries the owner/repo and the PR head SHA, and the response lists paths only. | Not stored. |
| Unified diff of the change | Nowhere when the base commit is in the local checkout. In PR-number mode it always comes from GitHub's compare API, with a request carrying the owner/repo, the PR base SHA (or the `base-ref` input text) and the PR head SHA. Otherwise (for example on a shallow checkout) it is fetched from GitHub's compare API, at `api.github.com` or your GHES instance via `GITHUB_API_URL`; the request carries the owner/repo, the base ref as given (the `base-ref` input text, the PR base SHA or the push `before` SHA) and the head SHA. | Held in memory for the run, not stored. |
| Coverage file contents | Parsed locally. Only derived data leaves the parser: the percentages and line numbers of changed files (see below) and, when no path in the coverage report matches a tracked file, `COVERAGE_PATHS_UNMATCHED` quotes one example path from the report and a suggested coverage root in the comment, summary and `report.json`. | Not stored; the quoted path lives as long as the comment or summary. |
| `.pharn/ci.yml` and Action inputs | Parsed locally. A parse or validation error can quote a key name and some values (for example an unsupported YAML value, an exclude pattern or the `coverage-format` input) into the step log. | Step log, under your log retention. |
| Paths of changed files the coverage report tracks, their uncovered line numbers, per-file and total percentages and line counts, the threshold, excluded changed-file paths, changed config and workflow paths, deleted or renamed-away test file paths, changed files the diff shows as binary, agent setup file paths and kinds, the verdict | The PR comment and job summary in your own GitHub, and `report.json`. The inventory matches agent setup files by path and does not read them. Check A7 reads the committed text of the machine-readable kinds at `HEAD` and looks for committed secrets, and policy mode reads the agent settings, MCP and instruction files (next row). | The comment persists until someone deletes it; the summary follows your log retention. |
| Text of the agent config, settings and instruction files (check A7; policy rules P02 to P07) | Read locally from committed git objects at `HEAD` (`git cat-file`), never the working tree, and held in memory in the job. Check A7 reads the machine-readable kinds (`.mcp.json`, `.claude/settings*.json`, hooks, `.codex/config.toml` and the like) with or without a policy, and the Action does so only when the diff comes from local git; under an org policy, P02 to P06 read the settings and MCP JSON and P07 reads the Markdown instruction files. The text never reaches the PR comment, the job summary, the step log, `report.json` or the upload to pharn.dev: a message holds only a shape or rule id, the path and a line number. Details in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) rows C4, C5 and C6. | Not stored. |
| Text of the agent instruction files, the root `package.json` and `Makefile`, and their commit times (stale instructions SI01 to SI04) | Read locally on every run with a diff from local git, with or without a policy: the instruction files at `HEAD` and the root manifests at `HEAD` and the merge base (`git cat-file`), and `git log -1 --format=%ct` of at most 20 instruction files; held in memory in the job. Only inline code spans, shell blocks, link targets and `@` imports are read. A finding in `report.json` (and so in the upload to pharn.dev, the PR comment and the job summary) names the instruction file, a line number and the path or the canonical command (`pnpm run build`, `make test`) it names, only when that is made of repo-path characters (letters, digits, `. _ - + /`, and `: @` in a script name) and at most 220 long; the messages name paths and line numbers only. No other text of the files leaves the job. Details in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) row C8. | Not stored. |
| JUnit XML the test step wrote (`junit-paths`; CLI `--junit`) | Read locally from the workspace, never through a symbolic link, at most 50 files, 25 MiB and 20,000 test cases, and parsed in memory; a file with a DOCTYPE is refused and no entity is expanded. The report, the comment and the summary get counts and, for failed tests on the org's quarantine list, their test ids; refused files are named by path. `system-out` and `system-err` are never kept. With a run upload, `junit/results.xml` goes with it: suite, class name, test name, id, time, status and, for a failure, its message redacted for secret shapes and cut to 2048 bytes (or the org's smaller `messageMaxBytes`), rebuilt by pharn-ci, never the file itself; the org's `settings.uploadJunit: false` leaves it out. | Not stored by the Action; uploaded results are kept by pharn.dev under your plan's retention. |
| Text of the manifests and lockfiles a change touches (dependency safety D04 and D05) | Read locally from committed git objects at the merge base and `HEAD` (`git cat-file`) by the CLI and the Action, unless the `dependencies` mode is `never`: the touched `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, requirements files, `pyproject.toml`, `poetry.lock` and `uv.lock`, and a lockfile in an ancestor directory of a touched `package.json`; at most 5 MiB a file; held in memory in the job. A finding in `report.json` (and so in the upload to pharn.dev, the PR comment and the job summary) names the file, a line number, fixed words and, only when they pass a strict allow-list, the package name and the version spec (never a URL, a git spec or a path); the messages name counts and paths with lines only. No other text of the files leaves the job. Details in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) row C9. | Not stored. |
| Registry lookups (`dependencies: lookup` only; the Action only) | For each package the pull request adds to a manifest, except scoped npm names (`@scope/x`), `workspace:`, git, URL and path specs, and names a touched lockfile resolves outside the registries: one `GET https://registry.npmjs.org/<name>` and one `GET https://api.npmjs.org/downloads/point/last-week/<name>` for npm, one `GET https://pypi.org/pypi/<name>/json` for PyPI. The package name in the path is all that is sent: no query, no body, no token, no repository name, only `Accept: application/json` and `User-Agent: pharn-ci`; no redirect followed, 5 s per request, at most 50 packages per run. The answers are read on the runner (first-publish time, last week's downloads) and only derived facts (not found, an age in days, a download count) reach the report. With the default `auto` and with `never`, nothing is sent. Details in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) row D8. | Per each registry's own policy. |
| Workflow name and job id | The PR comment's scope line, `<!-- pharn-ci scope: <workflow>/<job> -->`, URL-encoded. It tells the workflow and job's comments apart. | The comment persists until someone deletes it. |
| Paths and refs quoted in messages | Message text in the comment, summary and `report.json`: the coverage path in `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `COVERAGE_FILE_TRACKED`; one coverage-report path and a suggested root directory in `COVERAGE_PATHS_UNMATCHED`; `base...head` (or the `base-ref` input text) in `DIFF_UNAVAILABLE`; changed config or workflow paths in `CONFIG_CHANGED_IN_DIFF`, deleted or renamed-away test file paths in `TEST_FILES_DELETED` and binary file paths in `DIFF_BINARY_COVERED_FILE` (up to five each, the rest counted); and the first empty agent setup file path in `AGENT_SETUP_FILE_EMPTY`. | As above. |
| Repo owner/name, PR number, base and head SHAs or refs | Your GitHub API only: compare commits (the diff fallback above), in PR-number mode `GET` of the pull request (its base and head SHAs) and `GET` of the git tree of its head (file paths), `GET /user` (to learn which login the token comments as; when the token cannot read it, no login is guessed and comments are matched by scope), on every `pull_request` run `GET` of the pull request's commits (`/pulls/{n}/commits`, at most 3 pages of 100) for agent-PR detection, which needs `pull-requests: read` (without it every pull request counts as an agent PR), with `test-integrity: block` the accept-label reads (a second `GET` of the pull request and `GET` of its issue events), list PR comments, create or update the one pharn-ci comment of this workflow and job, and delete duplicates of it that concurrent runs left (only comments that start with pharn-ci's marker and share the kept comment's author login and scope line). Requests carry Octokit's standard `User-Agent` (library and Node.js versions, OS and architecture). | Per GitHub's own policies. |
| `github-token` | Only as the `Authorization` header of those GitHub API requests. Never logged or written. | Not stored. |
| Other environment variables and secrets | Not read, apart from the runner's standard `GITHUB_*` and `RUNNER_*` variables (workspace, temp dir, event payload, repository, API URL) through `@actions/core` and `@actions/github`. `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are honoured for the GitHub API. | Not stored. |
| Step log | Progress lines (coverage format, verdict, comment id) and warnings, which can include `git` or GitHub API error text. | Your log retention. |
| `report.json` | Written to `$RUNNER_TEMP/pharn-ci/report.json` (the `report-path` output): the same data as the comment, untruncated. | Ephemeral: the runner clears `RUNNER_TEMP` after the job, unless your workflow uploads the file. |
| Org policy request (`policy: auto` or `required`, only with `id-token: write`) | One `GET <app-url>/api/v1/policy?repo=<owner>/<name>` with a GitHub OIDC token (audience `pharn.dev`, masked in the log, sent only to the https `app-url` origin, never on a redirect) as the `Authorization` header, `Accept` and a `User-Agent: pharn-ci/<version>`. Nothing else: no file contents, diff, coverage or log. Fork PRs and jobs without `id-token: write` get no token, so nothing is sent. With `policy: never` or `file:<path>`, nothing is sent. | Per the app's own policy. |
| Run upload (`upload: auto`, only with `id-token: write`) | Three requests after the check. (1) `POST <app-url>/api/v1/runs/upload-url` with a JSON body of `repository`, `headSha`, `runId`, `runAttempt`, `scope` and the bundle `sizes`. It goes out before pharn-ci knows whether the Pharn GitHub App is installed for the repository: a `404` means it is not, and nothing more is sent. (2) One `PUT` of a gzip tar of `report.json` and `meta.json` to the signed https storage URL the app names in its answer, with only `Content-Type` and `User-Agent` headers: never the token, no redirect followed, never retried. (3) `POST <app-url>/api/v1/runs` with a JSON body of `objectKey`, `repository`, `repositoryId`, `prNumber`, `headSha`, `baseSha`, `scope`, `runId`, `runAttempt`, `event` and `prHeadShaExpected`. Both POSTs go to the https `app-url` origin only (default `https://pharn.dev`), never on a redirect, with the GitHub OIDC token (audience `pharn.dev`, masked in the log) as the `Authorization` header, `Accept`, `Content-Type` and a `User-Agent: pharn-ci/<version>`, and each is retried once after a network error or a 5xx answer. `meta.json` holds `schemaVersion`, `tool`, `createdAt`, `event`, `repository`, `repositoryId`, `prNumber`, `headSha`, `baseSha`, `mergeBase`, `scope`, `runId`, `runAttempt`, `actor`, `prAuthor`, `prLabels`, `coAuthors`, `agentHint`, `isAgentPr` and `commentUrl` (the link to this job's own PR comment) — `schema/upload-meta.v1.json`. `report.json` is the report above with every string redacted for secret-shaped text, each message and test-integrity signal text cut to 2048 bytes, and no test-integrity base or head excerpt. Never file contents, a diff, a coverage file or a log. Fork PRs and jobs without `id-token: write` get no token, so nothing is sent; `upload: never` turns the upload off. | Per the app's own policy. |
| Anything else sent to Pharn or anywhere else | No other request: no telemetry, no license check, no update check. | Nothing to retain. |

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
   comment). Grant `id-token: write` only if you want the org policy and the run upload: with it the Action
   fetches the policy and, with the default `upload: auto`, sends the redacted report and run metadata to
   pharn.dev. A same-repository pull request can edit the workflow that grants it, so protect
   `.github/workflows/` with CODEOWNERS and required reviews (docs/THREAT-MODEL.md, residuals 26 and 27).
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
