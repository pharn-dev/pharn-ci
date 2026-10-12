# Contributing to pharn-ci

Thanks for your interest in pharn-ci, the CI check that tells you whether AI coding agents can
safely work in your repo.

## Project shape

pharn-ci is a pnpm monorepo with three packages: `packages/core` (pure functions: parsers, diff
coverage, the agent setup scan, the Report v1 builder and the markdown renderer),
`packages/cli` (`pharn-ci check`) and `packages/action` (the GitHub Action). `schema/report.v1.json`
is the source of truth for all output. [`AGENTS.md`](./AGENTS.md) describes the layout and holds the
hard rules every change follows; read it before your first PR.

## Getting set up

pharn-ci uses **pnpm** (the version is pinned in `package.json` `packageManager`) and Node 24
(`.nvmrc`).

```bash
pnpm install          # install
pnpm build            # typecheck + build core, bundle cli and action
pnpm test             # vitest (all packages)
pnpm test:coverage    # vitest with lcov output in coverage/
pnpm lint             # biome check + typecheck
pnpm format           # biome autofix
pnpm pharn-ci check   # run the built CLI on this repo
```

Commit `pnpm-lock.yaml` changes together with the `package.json` change that caused them.

## What CI checks

These are required status checks on `main`:

| Check                                | What it runs                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `ci`                                 | `pnpm lint`, `pnpm test:coverage`, `pnpm build`, a check that `packages/action/dist` is current, then pharn-ci on its own PR (threshold 80%) |
| `Action pins`                        | `node scripts/check-action-pins.mjs`: every third-party action is pinned to a commit SHA                           |
| `gitleaks`                           | Secret scan of the full git history, with a pinned and checksum-verified gitleaks binary                           |
| `Analyze (javascript-typescript)`    | CodeQL                                                                                                             |
| `Socket Security: Project Report`    | Socket Security GitHub App (no workflow in this repo produces it)                                                  |
| `Socket Security: Pull Request Alerts` | Socket Security GitHub App                                                                                       |

The job names are a contract with the `main` ruleset (kept as code in
[`.github/rulesets/`](./.github/rulesets/README.md)): renaming one means updating the ruleset too.
The branch must be up to date with `main` before it can merge.

## Tests

- Every core change ships with fixture-based tests: inputs go in `fixtures/`, tests assert on
  outputs, and any report a test produces is validated against the schema with `expectValidReport`.
- Golden files (`fixtures/golden/*`) change only when the output intentionally changes. Regenerate
  them with `pnpm test -u` and review the diff.
- Never weaken, skip or delete an existing test to make CI pass. If a test is wrong, fix it and say
  why in the PR description.
- Bug fixes include a regression test.

## Threat model and limits

pharn-ci's security design is in [`docs/THREAT-MODEL.md`](./docs/THREAT-MODEL.md) and what it does
not guarantee is in [`docs/LIMITS.md`](./docs/LIMITS.md). A change that adds parsing of untrusted
input, a new place the Action writes to, or a new GitHub API call needs a row in the threat model in
the same PR.

## Commits & releases

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, …). PRs are squash-merged, so the
  PR title becomes the commit message on `main`; write it in that style. Commits on `main` are
  signed and history is linear.
- Add a line under **Unreleased** in [`CHANGELOG.md`](./CHANGELOG.md) for any user-visible change.
- Run `pnpm build` and commit `packages/action/dist` with any change that affects the action,
  including core changes. CI fails if dist is stale.
- Releases are cut by a maintainer: see [`docs/RELEASING.md`](./docs/RELEASING.md).
- Keep PRs focused; one logical change per PR.

## Dependabot PRs

Dependabot groups its updates. Development-dependency and GitHub Actions groups need no extra
step. The `actions-runtime` group (`@actions/*`) changes what is bundled into
`packages/action/dist`, so its `ci` check fails until dist is rebuilt:

```bash
gh pr checkout <number>
pnpm install --frozen-lockfile
pnpm build
git add packages/action/dist
git commit -m "chore: rebuild dist"
git push
```

## Conduct and security

- This project follows the [Code of Conduct](./CODE_OF_CONDUCT.md). By participating you are
  expected to uphold it.
- Found a vulnerability? **Do not open a public issue or PR.** Follow the private disclosure process
  in [`SECURITY.md`](./SECURITY.md).

By contributing, you agree your contributions are licensed under the repository's
[Apache 2.0 license](./LICENSE).
