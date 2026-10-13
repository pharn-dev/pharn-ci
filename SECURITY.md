# Security Policy

pharn-ci runs inside other people's CI. The GitHub Action runs with the `pull-requests: write`
permission to post a sticky PR comment, and it reads files and diffs from the repository it checks.
That makes its integrity, and the integrity of its release tags, part of the product. We welcome
coordinated disclosure of any vulnerability in this repository.

> **Status:** pharn-ci is pre-1.0. Only the **latest** release and `main` receive security fixes.

## Security surface

- **The GitHub Action** (`action.yml`, `packages/action`): runs in a consumer's workflow with their
  `GITHUB_TOKEN`. It makes no network calls except to the GitHub API, and has no telemetry.
- **Input parsing** (`packages/core`): lcov, Cobertura XML, unified diffs and the config file are
  untrusted input, parsed by hand-written parsers. A crafted file must not crash, hang or exhaust memory in the
  consumer's CI.
- **The CLI** (`packages/cli`): reads files and runs `git` in the working directory.
- **Release integrity**: `packages/action/dist` is committed and must match a build of the sources
  (CI fails if it is stale), and consumers pin exact release tags such as
  `pharn-dev/pharn-ci@v0.1.0`, or their commit SHA. Tags matching `v*` are never moved or deleted
  (enforced by a ruleset), and releases are cut from verified `main` commits
  ([`docs/RELEASING.md`](./docs/RELEASING.md)). Release tags are unsigned lightweight tags, so the
  full commit SHA, not the tag, is what a consumer can verify.

The security design, with each mitigation tied to the test that enforces it, is in
[`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md); what pharn-ci does not guarantee is in
[`docs/LIMITS.md`](./docs/LIMITS.md).

## Data handling

pharn-ci has no backend. Everything it reads stays on the runner, and everything it writes goes to
your own GitHub: the PR comment, the job summary, the step log and a file in `RUNNER_TEMP`. The table
describes the GitHub Action; the CLI makes no network calls and prints to your terminal.

| Data | Where it goes | Retention |
| ---- | ------------- | --------- |
| Source code and working tree | Nowhere. Read locally by `git ls-files` and `git diff`. | Not stored. |
| Unified diff of the change | Nowhere when the base commit is in the local checkout. Otherwise (for example on a shallow checkout) it is fetched from GitHub's compare API, at `api.github.com` or your GHES instance via `GITHUB_API_URL`; the request carries the owner/repo, the base ref as given (the `base-ref` input text, the PR base SHA or the push `before` SHA) and the head SHA. | Held in memory for the run, not stored. |
| Coverage file contents | Nowhere. Parsed locally and never echoed. | Not stored. |
| `.pharn/ci.yml` and Action inputs | Parsed locally. A parse or validation error can quote a key name and some values (for example an unsupported YAML value, an exclude pattern or the `coverage-format` input) into the step log. | Step log, under your log retention. |
| Paths of changed files the coverage report tracks, their uncovered line numbers, per-file and total percentages and line counts, the threshold, excluded changed-file paths, agent setup file paths and kinds, the verdict | The PR comment and job summary in your own GitHub, and `report.json`. Agent setup files are matched by path only and never read. | The comment persists until someone deletes it; the summary follows your log retention. |
| Coverage file path and diff `base...head` text | Message text in the comment, summary and `report.json`: the coverage path in `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY` and `COVERAGE_FORMAT_UNSUPPORTED`, and `base...head` in `DIFF_UNAVAILABLE`. | As above. |
| Repo owner/name, PR number, base and head SHAs or refs | Your GitHub API only: compare commits (the diff fallback above), `GET /user` (to learn which login the token comments as), list PR comments, and create or update the one pharn-ci comment. Requests carry Octokit's standard `User-Agent` (library and Node.js versions, OS and architecture). | Per GitHub's own policies. |
| `github-token` | Only as the `Authorization` header of those GitHub API requests. Never logged or written. | Not stored. |
| Other environment variables and secrets | Not read, apart from the runner's standard `GITHUB_*` and `RUNNER_*` variables (workspace, temp dir, event payload, repository, API URL) through `@actions/core` and `@actions/github`. `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are honoured for the GitHub API. | Not stored. |
| Step log | Progress lines (coverage format, verdict, comment id) and warnings, which can include `git` or GitHub API error text. | Your log retention. |
| `report.json` | Written to `$RUNNER_TEMP/pharn-ci/report.json` (the `report-path` output): the same data as the comment, untruncated. | Ephemeral: the runner clears `RUNNER_TEMP` after the job, unless your workflow uploads the file. |
| Anything sent to Pharn | Nothing. No backend, no telemetry, no license check, no update check. | Nothing to retain. |

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
2. **Do not run it on `pull_request_target` with untrusted checkouts.**
3. **Review the report** before acting on it; it is derived from untrusted PR content.

Thank you for helping keep pharn-ci and its users safe.
