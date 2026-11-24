# Safety model

pharn-ci runs inside other people's CI, on untrusted changes, with their token. It is built for
that:

- **Stateless.** No backend of its own, no telemetry, and no network calls except these, all made by the Action (the
  CLI makes none of its own; on a partial clone its git calls may fetch, as below): the GitHub API; only with `policy` set to `auto` or `required` and an OIDC token granted, one `GET`
  of the pharn.dev policy endpoint that sends the OIDC token and the repository name ([Org policy](policy.md)); with
  `upload` not set to `never` and an OIDC token granted, the redacted `report.json` and `meta.json` of the run to
  pharn.dev ([Upload](upload.md)); and only with the `dependencies` mode `lookup` (the input,
  `dependencies.lookup: true` in `.pharn/ci.yml`, or an org policy), one `GET` per added unscoped package to
  `registry.npmjs.org/<name>`, `api.npmjs.org/downloads/point/last-week/<name>` or `pypi.org/pypi/<name>/json`, which
  sends the package name in the path and nothing else: no token, no repository name
  ([Dependency safety](checks/dependencies.md)). The OIDC token itself comes from the runner's GitHub token service,
  and on a partial clone git may fetch missing objects from the remote, in the Action and the CLI. No other host is
  called.
  What it reads, what it sends to your GitHub and to pharn.dev, and what it stores is listed in
  [Data handling](../SECURITY.md#data-handling).
- **Small token footprint.** `contents: read` plus `pull-requests: write`, and `id-token: write` only for
  the org policy and the upload to pharn.dev. It reads the compare API and the PR's comments, calls
  `GET /user` to learn which login its own comment has, lists the pull request's commits for agent-PR
  detection on every run that has a pull request (`pull_request`, `pull_request_target` or `pr-number` mode), with `test-integrity: block` reads the pull request and its
  issue events (`GET /issues/{n}/events`) for the accept label, and in `pr-number` mode also reads the
  pull request and its git tree. It updates only a comment its own
  login wrote for this workflow and job. When the token cannot read its login, that is a comment by
  `github-actions[bot]`, or by another bot that did not write the pull request or any of its commits. It deletes a comment only when concurrent runs left
  duplicates of that own marker comment.
- **Untrusted input stays data.** The lcov, Cobertura, diff and config parsers are hand-written,
  pure and non-recursive. JS and TS test files and test-runner config files go through TypeScript's
  parser (`typescript` 5.9.3, used only through `createSourceFile` to build a syntax tree; nothing
  in them is compiled, imported or run), and Python test files through the runner's own `python3`,
  which only parses them (`ast.parse`, in a subprocess). File names render in code spans and message text is escaped, so neither can add links, images, emphasis,
  mentions, issue references or HTML to the PR comment. Git runs without a shell, and refs starting with `-` are
  rejected.
- **Pure core.** `packages/core` cannot do I/O; a test, a lint rule and its tsconfig enforce it.
- **Reviewable releases.** The committed Action bundle is rebuilt and diffed in CI. Third-party
  actions are pinned to commit SHAs. The Action has three direct runtime dependencies:
  `@actions/core` and `@actions/github`, bundled into `packages/action/dist/index.js` together with
  their transitive dependencies, and `typescript5` (`typescript` 5.9.3), shipped as
  `packages/action/dist/typescript.js` and loaded on the first parse, only if its sha256 matches the
  pin held in `index.js` ([THREAT-MODEL, row G1](THREAT-MODEL.md#2-surfaces-threats-and-mitigations)).
  CodeQL, gitleaks and Socket checks run on every PR, and release tags are never moved.

Each claim is mapped to the test or check that enforces it in
[`docs/THREAT-MODEL.md`](THREAT-MODEL.md). pharn-ci cannot measure a `pull_request_target`
run safely and reports the diff as unavailable: run it on `pull_request` instead, and use the
[`workflow_run` pattern](action.md#fork-prs-comment-from-workflow_run) for a comment on fork PRs
([`SECURITY.md`](../SECURITY.md)).
