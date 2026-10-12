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
- **Before 1.0, a breaking change bumps the minor version** (0.1.x → 0.2.0). Report v1 stays
  compatible across all of them: fields are only added, message codes are never renamed.

## Cutting a release

1. **Prepare a PR** titled `chore: release X.Y.Z`:
   - Set `"version": "X.Y.Z"` in `packages/core/package.json`, `packages/cli/package.json` and
     `packages/action/package.json`, and `VERSION` in `packages/core/src/version.ts`.
     `version.test.ts` fails if they disagree.
   - In `CHANGELOG.md`, move the `[Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD`
     heading and leave an empty `## [Unreleased]` above it.
   - Run `pnpm build` (the version is compiled into `packages/action/dist`) and commit the result.
   - Merge with all required checks green.
2. **Dry run.** Actions → **release** → **Run workflow**, branch `main`, version `X.Y.Z`, leave
   **dry_run** ticked. The `Release verify` job refuses anything but `main`, a strict `X.Y.Z` equal
   to the package version, an untagged version and a non-empty `CHANGELOG.md` section. It then runs
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
