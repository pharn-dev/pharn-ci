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
| A1  | Parsing untrusted input (lcov, Cobertura, diff, config) | A crafted file crashes the job, hangs it, or is misread | Parsers are hand-written, pure and non-recursive. Malformed lcov records and diff headers are skipped, never thrown (`lcov.test.ts › merges repeated files, handles CRLF and checksums, skips malformed DA and orphan DA`, `unified.test.ts › handles header-like content lines, quoted paths, binary files and context lines`). The Cobertura reader is a regex-free XML scanner with no element stack: comments, CDATA, processing instructions and DOCTYPE are skipped and markup inside them is never read (`cobertura.test.ts › AC-5: returns the same map for every surface form and ignores markup inside comments and CDATA`), a malformed `<line>` is skipped and empty or garbage input yields an empty map, never a throw (`cobertura.test.ts › AC-7: reads a line without hits as 0 hits and skips non-numeric number or hits`, `cobertura.test.ts › AC-13: returns an empty map for empty, garbage and line-less reports, and keeps only valid classes`), and unterminated comments, CDATA, quoted values, runs of `<` and very deep nesting parse in linear time (`cobertura-hostile.test.ts › AC-16: an unterminated comment of several megabytes parses in linear time`, `cobertura-hostile.test.ts › AC-16: an unterminated CDATA section of several megabytes parses in linear time`, `cobertura-hostile.test.ts › AC-16: an unterminated quoted attribute of several megabytes parses in linear time`, `cobertura-hostile.test.ts › AC-16: a run of several million < characters parses in linear time`, `cobertura-hostile.test.ts › AC-16: many thousands of nested open tags around a valid class parse in linear time`). Format auto-detection reads only the first 1 KiB of the untrusted file, reuses the same regex-free scanner, never throws, and costs time bounded by that window on hostile text (`ac-format-detect.test.ts › AC-6: returns quickly, without throwing, on several megabytes of hostile text`); look-alikes are not taken for a known format (`ac-format-detect.test.ts › AC-4: does not take Clover look-alikes for Cobertura or lcov`, `ac-format-detect.test.ts › AC-5: does not take JaCoCo native XML, garbage, <coverageReport> or a root past 1 KiB for a known format`). The config parser accepts a strict YAML subset and rejects everything else with a `ConfigError` (`config.test.ts › rejects %j`); `setup.require` accepts only `true` or `false` and rejects any other value with a `ConfigError` (`ac-require-setup-config.test.ts › AC-2: reads setup.require true and false as booleans, and rejects a non-boolean naming setup.require`); it parses in linear time on hostile lines (`config.test.ts › parses %s in linear time`). The one block list it reads, `coverage.exclude`, accepts only quoted or plain strings and rejects numbers, mappings, nested and flow lists and empty items (`config-exclude.test.ts › AC-5: reads coverage.exclude as a block list of quoted and plain strings, in order`, `config-exclude.test.ts › AC-6: rejects coverage.exclude values that are not a list of valid glob strings`), in linear time on 100,000 items or a 100,000-character pattern (`config-exclude.test.ts › AC-7: parses 100,000 items and a 100,000-character pattern in linear time`). The glob matcher behind it is regex-free: it rejects unsupported syntax (braces, classes, negation, `..`, backslashes) with a `ConfigError` naming the pattern (`glob.test.ts › AC-2: accepts ./src/** as src/** and rejects unsupported patterns with a ConfigError naming them`), matches hostile paths as given without normalizing or throwing (`glob.test.ts › AC-3: matches paths a pull request can name as given, without normalizing or throwing`) and is linear on 100,000-character paths (`glob.test.ts › AC-4: matches 100,000-character paths in linear time`). **Residual:** no input size caps beyond git's 256 MiB buffer (`LIMITS.md` §5); Cobertura path resolution is not linear: it tries one join per distinct `filename` × distinct `<source>`, so a crafted report with very many of both is slow (bounded by the job timeout, and only the PR's own job). | Partly enforced |
| A2  | Path handling | A coverage path makes pharn-ci attribute coverage to the wrong file, or read files it names | `SF:` paths are normalized (separators, `.`, `..`, drive letters); an absolute path is relativized only on a whole-segment match of the repo root, and one outside the root stays absolute and never matches (`paths.test.ts`, `lcov.test.ts › strips the repo root from absolute paths and leaves outside paths absolute`). Cobertura `filename` values go through the same normalization, joined to a `<source>` only when relative: an absolute filename is never joined (`cobertura.test.ts › AC-9: relativizes an absolute filename under the root and keeps one outside it absolute, normalized`), a join is accepted only when it lies under the repo root (`cobertura.test.ts › AC-10: builds the key from the first source whose join lies under the repo root`, `cobertura.test.ts › AC-11: uses the normalized filename as written when there are no sources or none lies under the root`), and no key produced by a source join begins with `..` (`cobertura.test.ts › AC-12: never chooses a source join that climbs above the repo root`). Paths inside lcov, Cobertura and the diff are map keys only; pharn-ci never opens them. **Residual:** the coverage and config file paths themselves are not confined to the repo (§3). | Enforced today |
| B1  | PR comment and job summary | PR-controlled text injects markdown, HTML, mentions or a fake verdict into the comment | File names are rendered in code spans with pipes and backticks escaped and control characters (newlines included) replaced, so a path cannot end its table row. Message text is put on one line with HTML escaped (`markdown.test.ts › keeps PR-controlled paths and message text from injecting markdown`, `markdown.test.ts › truncates long tables and escapes paths`). Excluded paths are rendered through the same code spans, one list line each (`exclusions-report.test.ts › AC-16: keeps hostile excluded paths from adding lines, headings or raw HTML`). | Enforced today |
| B2  | PR comment | Someone else's comment carrying pharn-ci's marker is overwritten, or makes pharn-ci's report disappear | Only a comment that starts with the marker and was written by the token's own login is updated; otherwise a new one is created (`run.test.ts › never takes over a marker comment written by someone else`, `run.test.ts › updates the comment of a non-default token's own login`). **Residual:** with a GitHub App token other than `GITHUB_TOKEN`, the login cannot be read and falls back to `github-actions[bot]`, so pharn-ci posts a new comment on each run instead of updating. | Enforced today |
| B3  | PR comment | An oversized report fails to post, hiding the verdict | Tables are cut at 50 rows, and the comment at 65,000 characters at a line break, with a pointer to the job summary, which keeps the full report (`run.test.ts › truncates a comment over GitHub's size limit and keeps the full report in the summary`). | Enforced today |
| C1  | Git invocation (CLI and Action) | A ref input such as `--output=<file>` is read by git as an option | Git runs through `execFile` with no shell. A base ref starting with `-` is rejected, and revisions are passed after `--end-of-options` (`main.test.ts › exits 2 for %j`, `run.test.ts › fails clearly for invalid inputs %j`, `run.test.ts › passes the base to git diff after --end-of-options`, `run.test.ts › keeps a base that starts with -x after --end-of-options in every git call`, `main.test.ts › passes the only user-influenced revision to git after --end-of-options`). | Enforced today |
| D1  | GitHub token (Action) | The token is leaked, or used for more than the PR comment | The token is passed to Octokit only, never logged or written. Calls: compare commits (read), list comments (read), create or update one comment. The only file written is `report.json` under `RUNNER_TEMP`. No network calls other than the GitHub API; no telemetry. The documented permissions are `contents: read` plus `pull-requests: write` for the comment. **Residual:** pharn-ci cannot narrow a token the consumer over-grants. | Partly enforced |
| D2  | Fork PRs | The comment step fails and takes the check down, or tempts users into `pull_request_target` | A failed comment is a warning; the report stays in the job summary and the step's verdict is unaffected (`run.test.ts › falls back to the job summary when it cannot comment (fork PRs)`). `SECURITY.md` tells users not to run pharn-ci on `pull_request_target` with untrusted checkouts. | Enforced today |
| D3  | `pull_request_target` | The default checkout is the base branch, so the PR is measured as empty and passes | If local `HEAD` is not the PR head, diff coverage is not computed and `DIFF_UNAVAILABLE` says to check out the PR head (`run.test.ts › refuses to measure a pull_request_target run that checked out the base branch`), and with a threshold the run fails (`ac-diff-unavailable.test.ts › AC-3: fails the step with a threshold and only warns without one`). | Enforced today |
| E1  | Verdict integrity | Missing or unusable inputs pass the gate silently | A missing or record-less coverage file is `COVERAGE_FILE_MISSING` / `COVERAGE_FILE_EMPTY`, an error with a threshold (`golden.test.ts › reports a missing coverage file`, `golden.test.ts › reports %s (threshold %s) as COVERAGE_FILE_EMPTY instead of passing`). A coverage file in no recognized format is `COVERAGE_FORMAT_UNSUPPORTED`, an error with a threshold, never a pass (`ac-format-check.test.ts › AC-7: reports Clover and JaCoCo native XML under auto as COVERAGE_FORMAT_UNSUPPORTED`). A diff that cannot be obtained is `DIFF_UNAVAILABLE`, an error with a threshold (`ac-diff-unavailable-check.test.ts › AC-2: fails with a threshold and warns without one, carrying DIFF_UNAVAILABLE`). Every report is validated against `schema/report.v1.json` in tests (`report.test.ts › rejects reports that break the contract`, `golden.test.ts › matches the expected report JSON and the schema`). **Residual:** pharn-ci trusts the coverage numbers the PR's test run wrote (§3). | Partly enforced |
| F1  | `packages/core` | Core gains I/O, network access or non-determinism | Core may import only relative modules and may not reference `process`, `require`, `fetch`, `globalThis`, `eval` or `new Function` (`purity.test.ts › %s does no I/O`); a Biome import ban and `"types": []` in core's tsconfig back this up. | Enforced today |
| G1  | Committed bundle (`packages/action/dist`) | The bundle consumers run differs from the reviewed source | `ci` rebuilds and fails if `packages/action/dist` differs from the committed copy; `release.yml` repeats the check before a release. **Residual:** a compromised dev dependency in the build can alter what the build emits; review of the dist diff is the backstop (§3). | Partly enforced |
| G2  | Supply chain and releases | A malicious or tampered workflow, dependency or release | Third-party actions are pinned to commit SHAs (`Action pins` check, plus the repository's SHA-pinning requirement). Two runtime dependencies (`@actions/core`, `@actions/github`), Socket Security checks on every PR, CodeQL, and a pinned, checksum-verified gitleaks scan. `main` takes only signed, squash-merged, reviewed PRs with all checks green. Release tags are exact `vX.Y.Z`, created by `release.yml` from a verified `main` commit in a job that installs nothing, and the `release-tags` ruleset forbids moving or deleting them. | Enforced today |

## 3. Named residual risks

These are accepted, not hidden:

1. **pharn-ci trusts the coverage file.** The PR's own tests produce it in the same job. A PR that
   alters its test setup to write a favorable lcov file will pass. Review changes to test and
   coverage configuration like any other code.
2. **Coverage and config paths are not confined** (A2). Confining them would break legitimate
   setups that write coverage outside the workspace, and the PR's own code can already read
   whatever the job can.
3. **The PR's code shares the job.** pharn-ci limits what it does itself; it cannot stop code that
   ran earlier in the job from using the token the workflow granted.
4. **A compromised build dependency could alter the bundle** (G1). The bundle is rebuilt and
   compared in CI, but a dependency that tampers with the build would tamper with both builds the
   same way. Keep dev dependencies few, pinned by lockfile, and review `dist` diffs.
5. **No input size limits** (A1). A hostile coverage file or diff can exhaust the job's time or
   memory. It cannot make pharn-ci write anywhere other than its report, summary and comment.
6. **Exclusions come from the PR.** `coverage.exclude` (in `.pharn/ci.yml`) and the Action's
   `exclude` input (in the workflow file) are part of the change under review, so a PR can exclude
   its own files, ultimately every file, which passes as `NO_COVERABLE_CHANGES`. The gate is only as
   honest as the config the PR carries, as with the coverage file. Excluded files are listed in the
   report and the comment so a reviewer can see them; protect `.pharn/ci.yml` and the workflow with
   CODEOWNERS.
8. **The agent setup requirement comes from the PR.** `setup.require` lives in the PR-carried
   `.pharn/ci.yml`, so a PR can switch the requirement off (and it is off by default). The Action's
   `require-agent-setup` input in the workflow file is the stronger setting; protect both with
   CODEOWNERS.

## 4. Keeping this document honest

A new surface (new parsing of untrusted input, a new place the Action writes to, a new GitHub API
call or permission) needs a row before it merges. When a mitigation ships, its tests must
demonstrate it and its status changes in the same pull request.
