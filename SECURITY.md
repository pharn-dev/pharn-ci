# Security Policy

pharn-ci runs inside other people's CI. The GitHub Action runs with the `pull-requests: write`
permission to post a sticky PR comment, and it reads files and diffs from the repository it checks.
That makes its integrity, and the integrity of its release tags, part of the product. We welcome
coordinated disclosure of any vulnerability in this repository.

> **Status:** pharn-ci is pre-1.0. Only the **latest** release and `main` receive security fixes.

## Security surface

- **The GitHub Action** (`action.yml`, `packages/action`): runs in a consumer's workflow with their
  `GITHUB_TOKEN`. It makes no network calls except to the GitHub API, and has no telemetry.
- **Input parsing** (`packages/core`): lcov, unified diffs and the config file are untrusted input,
  parsed by hand-written parsers. A crafted file must not crash, hang or exhaust memory in the
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
- Path traversal or arbitrary file read or write through lcov, diff or config input.
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
