<!--
Thanks for contributing to pharn-ci! Please read AGENTS.md first.
Keep one logical change per PR. The PR title must be a Conventional Commit
(feat: / fix: / docs: / chore: ...). PRs are squash-merged and the title becomes the commit
message on main.
-->

## What this changes

A short description of the change and the problem it solves.

Closes #<!-- issue number -->

## Type of change

- [ ] `feat`: new capability
- [ ] `fix`: bug fix
- [ ] `docs`: docs-only change
- [ ] `chore` / `refactor` / `test` / `ci`: no behavior change

## Package(s) touched

<!-- packages/core | packages/cli | packages/action | packages/node-io | schema | fixtures | docs | repo tooling -->

## Checklist

- [ ] `packages/core` stays pure: no I/O (`fs`, `process`, network, clocks, randomness).
- [ ] Core changes ship with fixture-based tests; reports are validated with `expectValidReport`.
- [ ] No existing test was weakened, skipped or deleted. Golden files changed only because the output
      intentionally changed (explained below).
- [ ] `schema/report.v1.json` is untouched, and `schema/report.v2.json` is untouched or changed only
      additively (optional fields, message codes, setup kinds) with `packages/core/src/report.ts`
      updated to match.
- [ ] No new dependency, or it is justified below.
- [ ] `pnpm build` was run, and `packages/action/dist` is committed and current.
- [ ] User-visible changes have a line under **Unreleased** in `CHANGELOG.md`.
- [ ] New untrusted input, output or GitHub API call? `docs/THREAT-MODEL.md` has a row for it.

## Security-sensitive changes

<!-- Touches token handling, file or git access, input parsing, the PR comment, or the release
process? Say what changed and what you checked. Write "n/a" otherwise. -->

## Notes for the reviewer

Anything the reviewer should look at first.
