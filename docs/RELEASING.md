# Releasing pharn-ci

A maintainer decides when to release and what the version is. A release is an exact Git tag
`vX.Y.Z` on `main` plus its GitHub Release; consumers reference it as
`uses: pharn-dev/pharn-ci@vX.Y.Z`, or better, by the tag's commit SHA. The CLI is not published to
npm yet.

## Tag policy

- **Exact versions only.** pharn-ci does not publish moving major tags such as `v0` or `v1`; the
  same policy as the other pharn-dev repositories.
- **Tags never move and are never deleted.** The `release-tags` ruleset
  ([`.github/rulesets/release-tags.json`](../.github/rulesets/release-tags.json)) forbids updating,
  force-pushing or deleting any `v*` tag, with no bypass. A broken release is fixed by releasing a
  new patch version.
- **Tags are not signed.** Release tags are created by `gh release create` in the `Release publish`
  job, through the GitHub API, so they are lightweight and not signed: there is no tag signature to
  verify. The `main` ruleset's signed-commits rule covers commits, not tags. The integrity control
  is the commit SHA: consumers should pin the full commit SHA the tag points at, not the tag name,
  and can check that the commit is on `main` and that its bundle rebuilds from the sources
  ([Verify the release](#verify-the-release)).
- **Before 1.0, a breaking change bumps the minor version** (0.1.x → 0.2.0). Within one report
  schema version, fields are only added and message codes are never renamed.

**v0.2.0 is a breaking release for report consumers.** It ships Report v2 (`schema/report.v2.json`):
`schemaVersion` becomes the number 2 (Report v1 used the string "1"), and the report gains optional top-level
objects (`testIntegrity`, and `meta` from the Action). Every v1 field keeps its name, type and meaning, but
`schema/report.v1.json` has `additionalProperties: false`, so a v2 report does not validate against it. Tools
that validate `report.json` must switch on `schemaVersion`. Inputs, outputs and message codes are unchanged.

## Inputs, outputs and message codes

Consumers pin a release and let Dependabot or Renovate bump it, so a bump must not break a workflow
that worked on the previous release. Before 1.0 the rules are:

- **Never removed.** No Action input or output, CLI flag or report message code is removed in 0.x.
  `packages/action/test/input-aliases.test.ts` lists every shipped input and output and fails when
  one disappears from `action.yml`; message codes are held by `schema/report.v1.json`,
  `schema/report.v2.json` and the golden tests.
- **Renames keep the old name for at least one minor release.** A renamed input stays declared in
  `action.yml` and is mapped to its new name in `INPUT_ALIASES` (`packages/action/src/run.ts`). The
  old name keeps working and logs a `core.warning` saying to rename it; when both names are set, the
  new one wins and the warning says the old one is ignored. The old name may be dropped only in a
  later minor release than the one that renamed it, and its removal is a breaking change listed in
  the changelog. A renamed CLI flag keeps its old spelling under the same rule. Message codes are
  never renamed (Report v1 and v2).
- **A changed default is a breaking change.** It ships only in a minor release, under **Changed** in
  `CHANGELOG.md`, with the old behaviour named and how to get it back (usually by setting the input).
- **The comment and summary layout may change** in any release; tools should read `report.json`
  (the `report-path` output), not the markdown.

## Cutting a release

1. **Prepare a PR** titled `chore: release X.Y.Z`:
   - Set `"version": "X.Y.Z"` in the root `package.json`, `packages/core/package.json`,
     `packages/cli/package.json`, `packages/action/package.json` and `packages/node-io/package.json`, `VERSION` in
     `packages/core/src/version.ts`, and the version in the `uses: pharn-dev/pharn-ci@vX.Y.Z` line of
     the quick start in `docs/MARKETPLACE.md`. `version.test.ts` and the docs tests fail when they
     disagree.
   - In `CHANGELOG.md`, move the `[Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD`
     heading, with the one-line date note beneath it, and leave an empty `## [Unreleased]` with
     `### Added`, `### Changed` and `### Security` above it.
   - **Set the CHANGELOG date.** The maintainer replaces the `YYYY-MM-DD` placeholder with the
     release date, and deletes the date note beneath the heading so the extracted release notes do
     not carry it, before running the release workflow. `Release verify` refuses the release unless
     the heading is exactly `## [X.Y.Z] - <date>` with a real date and its notes contain neither
     `YYYY-MM-DD` nor the date note (`scripts/check-release-notes.mjs`).
   - **Update the README pins and the Status note.** Set all four `uses: pharn-dev/pharn-ci@vX.Y.Z`
     lines in `README.md` (the snippet at the top, the workflow under Quick start, and the two
     workflows under "Fork PRs: comment from workflow_run"), and rewrite
     the **Status** note under the badges so it no longer says the release has not been cut. The
     docs tests fail when a pin disagrees with the package version.
   - Run `pnpm build` (the version is compiled into `packages/action/dist`) and commit the result.
   - Merge with all required checks green, then dispatch `release.yml` (steps 2 and 3).
2. **Dry run.** Actions → **release** → **Run workflow**, branch `main`, version `X.Y.Z`, leave
   **dry_run** ticked. The `Release verify` job refuses anything but `main`, a strict `X.Y.Z` equal
   to the package version, an untagged version and a non-empty `CHANGELOG.md` section under an
   exactly dated heading, free of the placeholder and the date note. It then runs
   lint, tests and the build, fails if `packages/action/dist` differs from the committed bundle, and
   shows the release notes in the job summary. `Release publish` is skipped.
   - **Smoke in the dry run.** The dry run also runs `node scripts/smoke-release.mjs .` on the committed
     bundle, after the stale-dist check. It builds a throwaway repository from `fixtures/smoke/` and runs the
     bundle against it. A red smoke means no release.
   - **Fork PR check.** Before the release run, open a pull request from a fork against a throwaway
     repository whose workflow uses `pharn-dev/pharn-ci@<the release commit SHA>` on `pull_request`. Check that the
     run is green, that the job summary carries the report, and that no comment is posted: the fork token is
     read-only, so pharn-ci warns and uses the job summary only. This repository's CI cannot produce a fork PR, so
     this is a manual step.
3. **Release.** Run the workflow again with **dry_run** unticked. After `Release verify` passes,
   `Release publish` waits for approval in the `release` environment (today the maintainer approves
   their own release; see [`SECURITY.md`](../SECURITY.md#maintainer-model-one-person-today)), then
   creates the tag `vX.Y.Z`
   at exactly the commit that was verified and the GitHub Release with the changelog section as its
   notes. The publishing job has `contents: write` and checks out and installs nothing.
   - **Release smoke.** After `Release publish`, the `Release smoke` job checks out the new tag and runs
     `node scripts/smoke-release.mjs .`. It builds a throwaway repository from `fixtures/smoke/`, runs the tagged
     bundle with no token and no event, and checks the exit code, the `verdict` output, the job summary and the
     footer version. If `Release smoke` is red, skip the Marketplace step and fix it with a new patch release (tags
     never move).
4. **The Marketplace.** The workflow creates the release through the API, which does not list it on
   the GitHub Marketplace. Open the new release, choose **Edit**, tick **Publish this Action to the
   GitHub Marketplace** (the first time, accept the agreement and pick the categories) and save.
   Check that the Marketplace page shows the new version.

## Verify the release

1. The `release` workflow run is green, and `Release publish` ran for this version.
2. The tag points at a commit on `main`:

   ```bash
   git fetch --tags origin
   git merge-base --is-ancestor "vX.Y.Z" origin/main && echo "on main"
   ```

3. The bundle in the tag is what the sources build:

   ```bash
   git checkout "vX.Y.Z"
   pnpm install --frozen-lockfile && pnpm build
   git status --porcelain packages/action/dist   # prints nothing
   ```

4. A throwaway repository using `uses: pharn-dev/pharn-ci@<tag commit SHA>` posts its PR comment
   and reports `pharn-ci X.Y.Z` in the footer.

## One-time setup

These repository settings are already applied by an admin and must stay on; see
[`.github/rulesets/README.md`](../.github/rulesets/README.md) for how to check them:

- the `release` environment with a required reviewer, deployable from `main` only (one reviewer,
  self-review allowed until a second maintainer exists);
- immutable releases, so a published release's tag and assets cannot be changed;
- the `release-tags` ruleset.
