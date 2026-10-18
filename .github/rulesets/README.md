# Repository rules and settings

These files record the GitHub configuration that protects `pharn-dev/pharn-ci`, so it can be
reviewed in a PR and compared with what is live. **Committing them does not configure GitHub.** An
admin applies a change after it merges, from an up-to-date `main` checkout. The
[live rules](https://github.com/pharn-dev/pharn-ci/rules) are what is actually enforced.

## Rulesets

- [`main.json`](main.json) (ruleset ID `24927484`) protects the default branch:
  - no deletion, no force-push, linear history, signed commits;
  - changes only through a PR, squash-merged, with one approval including a code owner
    (`.github/CODEOWNERS`), stale approvals dismissed on push, review threads resolved;
  - the branch up to date with `main` and six checks green: `ci`, `Action pins`, `gitleaks` and
    `Analyze (javascript-typescript)` from GitHub Actions, and `Socket Security: Project Report` and
    `Socket Security: Pull Request Alerts` from the Socket Security app (integration ID `156372`);
  - the only bypass actor is the repository admin role (ID `5`), in `pull_request` mode: an admin
    can merge a PR without the approval, but cannot push to `main` directly. With one maintainer
    (the only code owner, who cannot approve their own PR), every merge uses this bypass today; the
    required checks still apply. Remove the bypass once a second code owner exists
    ([`SECURITY.md`](../../SECURITY.md#maintainer-model-one-person-today)).
- [`release-tags.json`](release-tags.json) (ruleset ID `24927486`) makes every `v*` tag immutable:
  no update, no force-push, no deletion, and no bypass for anyone. Tags can be created (that is how
  [`release.yml`](../workflows/release.yml) cuts a release), never moved. See
  [`docs/RELEASING.md`](../../docs/RELEASING.md).

The check names are a contract with the workflows: the job ids `ci` and `gitleaks`, the job name
`Action pins` and the CodeQL job name `Analyze (${{ matrix.language }})`. Renaming a job blocks
every PR until the ruleset lists the new name. A job with a `strategy.matrix` reports as
`<name> (<value>)`.

## Check for drift

Each file holds the ruleset's `name`, `target`, `enforcement`, `conditions`, `bypass_actors` and
`rules`. Compare it with the live ruleset:

```bash
diff <(jq -S . .github/rulesets/main.json) \
  <(gh api repos/pharn-dev/pharn-ci/rulesets/24927484 \
    | jq -S '{name, target, enforcement, conditions, bypass_actors, rules}')
diff <(jq -S . .github/rulesets/release-tags.json) \
  <(gh api repos/pharn-dev/pharn-ci/rulesets/24927486 \
    | jq -S '{name, target, enforcement, conditions, bypass_actors, rules}')
```

No output means they match.

## Apply a change

After the PR that changes a file merges, save the live ruleset, then update it in place (do not
create a duplicate):

```bash
gh api repos/pharn-dev/pharn-ci/rulesets/24927484 > /tmp/main-ruleset.before.json
gh api --method PUT repos/pharn-dev/pharn-ci/rulesets/24927484 --input .github/rulesets/main.json
```

Use ID `24927486` and `release-tags.json` for the tag ruleset. Run the drift check afterwards.

## Release settings

Applied and live, but not represented by a file here:

1. **The `release` environment**, used by the `Release publish` job: a required reviewer (the
   maintainer), and deployments from `main` only. `prevent_self_review` is off: the maintainer who
   dispatches a release also approves it, since turning it on with a single reviewer would block every
   release. Turn it on, with a second reviewer, when a second maintainer joins. Check it with:

   ```bash
   gh api repos/pharn-dev/pharn-ci/environments/release \
     --jq '{protection_rules: [.protection_rules[].type], deployment_branch_policy}'
   gh api repos/pharn-dev/pharn-ci/environments/release/deployment-branch-policies \
     --jq '[.branch_policies[] | {name, type}]'
   ```

   It was created with (re-run only to restore it):

   ```bash
   gh api --method PUT repos/pharn-dev/pharn-ci/environments/release --input - <<'JSON'
   {
     "reviewers": [{ "type": "User", "id": 7968018 }],
     "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
   }
   JSON
   gh api --method POST repos/pharn-dev/pharn-ci/environments/release/deployment-branch-policies \
     -f name=main -f type=branch
   ```

2. **Immutable releases**, so a published release's tag and assets cannot be changed. Check it
   with `gh api repos/pharn-dev/pharn-ci/immutable-releases` (`"enabled": true`); it was turned on
   with `gh api --method PUT repos/pharn-dev/pharn-ci/immutable-releases`.

## Settings to apply later

Not yet applied. Apply as an admin if wanted:

1. **Optional: turn off the wiki**, which is unused (docs live in the repository):

   ```bash
   gh api --method PATCH repos/pharn-dev/pharn-ci -F has_wiki=false
   ```

## Already in place

For reference, these are on and should stay on: squash merge only, delete branch on merge, Actions
must be pinned to a full commit SHA, default workflow token read-only and unable to approve PRs,
private vulnerability reporting, secret scanning with push protection, Dependabot security updates.
