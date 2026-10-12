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
  job, through the GitHub API, so they are lightweight and not signed. Consumers should pin the
  full commit SHA the tag points at, not the tag name.
- **Before 1.0, a breaking change bumps the minor version** (0.1.x → 0.2.0). Report v1 stays
  compatible across all of them: fields are only added, message codes are never renamed.

## Cutting a release

1. **Prepare a PR** titled `chore: release X.Y.Z`:
   - Set `"version": "X.Y.Z"` in the root `package.json`, `packages/core/package.json`,
     `packages/cli/package.json` and `packages/action/package.json`, `VERSION` in
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
   - **Update the README pins and the Status note.** Set both `uses: pharn-dev/pharn-ci@vX.Y.Z`
     lines in `README.md` (the snippet at the top and the workflow under Quick start), and rewrite
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
3. **Release.** Run the workflow again with **dry_run** unticked. After `Release verify` passes,
   `Release publish` waits for approval in the `release` environment, then creates the tag `vX.Y.Z`
   at exactly the commit that was verified and the GitHub Release with the changelog section as its
   notes. The publishing job has `contents: write` and checks out and installs nothing.
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

These are repository settings, applied by an admin; see
[`.github/rulesets/README.md`](../.github/rulesets/README.md):

- the `release` environment with a required reviewer, deployable from `main` only;
- immutable releases, so a published release's tag and assets cannot be changed;
- the `release-tags` ruleset (already active).
