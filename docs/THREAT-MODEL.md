# pharn-ci — Threat Model

> **Status: pre-1.0, not yet released.** This document is the security design the code is held to.
> Each row is marked:
>
> - **Enforced today**: the code does what the row says, and a named test or required CI check in
>   this repository fails if it stops doing so.
> - **Partly enforced**: the code does part of it; the gap is stated in the row as a residual risk.
> - **Documented limit**: pharn-ci does not do this, and the docs say so.
>
> It never claims that untested or unbuilt code is secure. What pharn-ci does _not_ guarantee is in
> [`LIMITS.md`](./LIMITS.md); how to report a problem is in [`SECURITY.md`](../SECURITY.md).

pharn-ci runs **inside other people's CI**, on the change under review, with their `GITHUB_TOKEN`.
It reads files the PR controls (coverage, config, file names) and writes a PR comment others will
read and trust as a verdict. A flaw in pharn-ci is a flaw in every pipeline that uses it, and a
release that is not what its source says is a supply-chain attack on all of them.

Test names below are `file › test`; files are under `packages/*/test/`.

## 1. Trust assumptions

- **Trusted:** the maintainers of the consumer's repository who write the workflow that runs
  pharn-ci and choose its permissions; GitHub itself; the GitHub-hosted runner.
- **Not trusted:** everything the change under review controls: the coverage file and the test run
  that produced it, `.pharn/ci.yml`, file names, diff content, refs passed as inputs; other users'
  PR comments; and every dependency, build step and release artifact in pharn-ci's own supply chain.
- **Out of scope:** the PR's own code running in the same job (on `pull_request` its tests run
  before pharn-ci; pharn-ci cannot protect the job from them), a consumer workflow that grants
  broader permissions than documented, and an attacker who already controls the runner.

## 2. Surfaces, threats and mitigations

| #   | Surface | Threat | Mitigation (what is true today) | Status |
| --- | ------- | ------ | ------------------------------- | ------ |
| A1  | Parsing untrusted input (lcov, diff, config) | A crafted file crashes the job, hangs it, or is misread | Parsers are hand-written, pure and non-recursive. Malformed lcov records and diff headers are skipped, never thrown (`lcov.test.ts › merges repeated files, handles CRLF and checksums, skips malformed DA and orphan DA`, `unified.test.ts › handles header-like content lines, quoted paths, binary files and context lines`). The config parser accepts a strict YAML subset and rejects everything else with a `ConfigError` (`config.test.ts › rejects %j`), in linear time on hostile lines (`config.test.ts › parses %s in linear time`). **Residual:** no input size caps beyond git's 256 MiB buffer (`LIMITS.md` §5). | Partly enforced |
| A2  | Path handling | A coverage path makes pharn-ci attribute coverage to the wrong file, or read files it names | `SF:` paths are normalized (separators, `.`, `..`, drive letters); an absolute path is relativized only on a whole-segment match of the repo root, and one outside the root stays absolute and never matches (`paths.test.ts`, `lcov.test.ts › strips the repo root from absolute paths and leaves outside paths absolute`). Paths inside lcov and the diff are map keys only; pharn-ci never opens them. **Residual:** the coverage and config file paths themselves are not confined to the repo (§3). | Enforced today |
| B1  | PR comment and job summary | PR-controlled text injects markdown, HTML, mentions or a fake verdict into the comment | File names are rendered in code spans with pipes and backticks escaped and control characters (newlines included) replaced, so a path cannot end its table row. Message text is put on one line with HTML escaped (`markdown.test.ts › keeps PR-controlled paths and message text from injecting markdown`, `markdown.test.ts › truncates long tables and escapes paths`). | Enforced today |
| B2  | PR comment | Someone else's comment carrying pharn-ci's marker is overwritten, or makes pharn-ci's report disappear | Only a comment that starts with the marker and was written by the token's own login is updated; otherwise a new one is created (`run.test.ts › never takes over a marker comment written by someone else`, `run.test.ts › updates the comment of a non-default token's own login`). **Residual:** with a GitHub App token other than `GITHUB_TOKEN`, the login cannot be read and falls back to `github-actions[bot]`, so pharn-ci posts a new comment on each run instead of updating. | Enforced today |
| B3  | PR comment | An oversized report fails to post, hiding the verdict | Tables are cut at 50 rows, and the comment at 65,000 characters at a line break, with a pointer to the job summary, which keeps the full report (`run.test.ts › truncates a comment over GitHub's size limit and keeps the full report in the summary`). | Enforced today |
| C1  | Git invocation (CLI and Action) | A ref input such as `--output=<file>` is read by git as an option | Git runs through `execFile` with no shell. A base ref starting with `-` is rejected, and revisions are passed after `--end-of-options` (`main.test.ts › exits 2 for %j`, `run.test.ts › fails clearly for invalid inputs %j`, `run.test.ts › passes the base to git diff after --end-of-options`). | Enforced today |
| D1  | GitHub token (Action) | The token is leaked, or used for more than the PR comment | The token is passed to Octokit only, never logged or written. Calls: compare commits (read), list comments (read), create or update one comment. The only file written is `report.json` under `RUNNER_TEMP`. No network calls other than the GitHub API; no telemetry. The documented permissions are `contents: read` plus `pull-requests: write` for the comment. **Residual:** pharn-ci cannot narrow a token the consumer over-grants. | Partly enforced |
| D2  | Fork PRs | The comment step fails and takes the check down, or tempts users into `pull_request_target` | A failed comment is a warning; the report stays in the job summary and the step's verdict is unaffected (`run.test.ts › falls back to the job summary when it cannot comment (fork PRs)`). `SECURITY.md` tells users not to run pharn-ci on `pull_request_target` with untrusted checkouts. | Enforced today |
| D3  | `pull_request_target` | The default checkout is the base branch, so the PR is measured as empty and passes | If local `HEAD` is not the PR head, diff coverage is not computed and `DIFF_UNAVAILABLE` says to check out the PR head (`run.test.ts › refuses to measure a pull_request_target run that checked out the base branch`). **Residual:** `DIFF_UNAVAILABLE` is a warning, not a failure (§3). | Partly enforced |
| E1  | Verdict integrity | Missing or unusable inputs pass the gate silently | A missing or record-less coverage file is `COVERAGE_FILE_MISSING` / `COVERAGE_FILE_EMPTY`, an error with a threshold (`golden.test.ts › reports a missing coverage file`, `golden.test.ts › reports %s (threshold %s) as COVERAGE_FILE_EMPTY instead of passing`). Every report is validated against `schema/report.v1.json` in tests (`report.test.ts › rejects reports that break the contract`, `golden.test.ts › matches the expected report JSON and the schema`). **Residual:** pharn-ci trusts the coverage numbers the PR's test run wrote (§3). | Partly enforced |
| F1  | `packages/core` | Core gains I/O, network access or non-determinism | Core may import only relative modules and may not reference `process`, `require`, `fetch`, `globalThis`, `eval` or `new Function` (`purity.test.ts › %s does no I/O`); a Biome import ban and `"types": []` in core's tsconfig back this up. | Enforced today |
| G1  | Committed bundle (`packages/action/dist`) | The bundle consumers run differs from the reviewed source | `ci` rebuilds and fails if `packages/action/dist` differs from the committed copy; `release.yml` repeats the check before a release. **Residual:** a compromised dev dependency in the build can alter what the build emits; review of the dist diff is the backstop (§3). | Partly enforced |
| G2  | Supply chain and releases | A malicious or tampered workflow, dependency or release | Third-party actions are pinned to commit SHAs (`Action pins` check, plus the repository's SHA-pinning requirement). Two runtime dependencies (`@actions/core`, `@actions/github`), Socket Security checks on every PR, CodeQL, and a pinned, checksum-verified gitleaks scan. `main` takes only signed, squash-merged, reviewed PRs with all checks green. Release tags are exact `vX.Y.Z`, created by `release.yml` from a verified `main` commit in a job that installs nothing, and the `release-tags` ruleset forbids moving or deleting them. | Enforced today |

## 3. Named residual risks

These are accepted, not hidden:

1. **pharn-ci trusts the coverage file.** The PR's own tests produce it in the same job. A PR that
   alters its test setup to write a favorable lcov file will pass. Review changes to test and
   coverage configuration like any other code.
2. **The gate is soft when the diff is unavailable** (D3). `DIFF_UNAVAILABLE` warns instead of
   failing, so a misconfigured checkout yields `warn`, not `fail`. Watch for the warning.
3. **Coverage and config paths are not confined** (A2). Confining them would break legitimate
   setups that write coverage outside the workspace, and the PR's own code can already read
   whatever the job can.
4. **The PR's code shares the job.** pharn-ci limits what it does itself; it cannot stop code that
   ran earlier in the job from using the token the workflow granted.
5. **A compromised build dependency could alter the bundle** (G1). The bundle is rebuilt and
   compared in CI, but a dependency that tampers with the build would tamper with both builds the
   same way. Keep dev dependencies few, pinned by lockfile, and review `dist` diffs.
6. **No input size limits** (A1). A hostile coverage file or diff can exhaust the job's time or
   memory. It cannot make pharn-ci write anywhere other than its report, summary and comment.

## 4. Keeping this document honest

A new surface (new parsing of untrusted input, a new place the Action writes to, a new GitHub API
call or permission) needs a row before it merges. When a mitigation ships, its tests must
demonstrate it and its status changes in the same pull request.
