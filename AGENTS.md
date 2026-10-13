# AGENTS.md

Instructions for AI coding agents (and humans) working in this repo. They govern all changes.

## What this is

pharn-ci is a GitHub Action + CLI that checks whether AI coding agents can safely work in a
repo: diff coverage of the change under review, and an inventory of agent setup files. It is
AI-agnostic and fully stateless (Phase 0): no backend, no telemetry.

## Layout

- `packages/core` — pure functions: lcov, Cobertura and unified-diff parsing, diff coverage, agent
  setup scan, Report v1 builder, markdown renderer, config parser. Entry point: `check()` in `src/check.ts`.
- `packages/cli` — `pharn-ci check`: reads files, runs git, calls core, prints output.
- `packages/action` — thin GitHub Action wrapper: inputs, PR diff, sticky comment, job summary, exit code.
- `schema/report.v1.json` — JSON Schema for the report. **Source of truth for all output.**
- `fixtures/` — hand-written lcov files, diffs and golden outputs used by tests.
- `action.yml` — Action metadata; runs `packages/action/dist/index.js`.

## Rules

1. **core is pure: no I/O.** No `fs`, `process`, `child_process`, network, clocks or randomness in
   `packages/core/src`. All I/O lives in `packages/cli` and `packages/action`, which gather inputs
   and pass plain data to core. This is enforced by core's tsconfig (`"types": []`), a Biome
   import ban and `packages/core/test/purity.test.ts`.
2. **`schema/report.v1.json` is the source of truth.** Changing it is a versioned decision. Within
   v1 you may only add optional fields, message codes or setup kinds (and document them in the
   schema). Never remove, rename or retype a field; never silently break consumers. Update the
   TypeScript types in `packages/core/src/report.ts` to match. Message `code`s are stable API.
3. **Every core change ships with fixture-based tests.** Put inputs in `fixtures/` and assert on
   outputs. Reports produced in tests must be validated against the schema (`expectValidReport`).
4. **Never weaken, skip or delete an existing test to make CI pass.** If a test is wrong, fix it
   and explain why in the PR description. Golden files (`fixtures/golden/*`) change only when the
   output intentionally changes; regenerate with `pnpm test -u` and review the diff.
5. **No network calls except the GitHub API inside the action. No telemetry.**
6. **Keep dependencies minimal; justify every new one** in the PR. Direct runtime deps
   today: `@actions/core`, `@actions/github` (action only; bundled into `packages/action/dist` with
   their transitive dependencies). Parsers (lcov, Cobertura XML, diff, config YAML subset) are
   hand-written on purpose.
7. **`packages/action/dist` is committed.** Run `pnpm build` before committing any change that
   affects the action (including core). CI fails if dist is stale.

## Repo protection

`main` and `v*` tags are protected by GitHub rulesets (no direct pushes, no force-push, no deletion;
squash-merge only, signed commits, linear history; a PR needs one approval including a code owner).
A PR can merge only when these checks pass: `ci`, `Action pins`, `gitleaks`,
`Analyze (javascript-typescript)`, and the two Socket Security app checks (`Socket Security: Project
Report`, `Socket Security: Pull Request Alerts`). The job names in `.github/workflows/` are a contract
with the ruleset: renaming one blocks every PR until the ruleset is edited to match. Third-party
actions must be pinned to a commit SHA (`scripts/check-action-pins.mjs`). Never weaken the rulesets to
get a change through. The rulesets are kept as code in `.github/rulesets/` (committing them does not
apply them; see its README).

Release tags are exact `vX.Y.Z`, cut by `.github/workflows/release.yml` and never moved or deleted
(`docs/RELEASING.md`). That workflow's job names must not collide with the required check names.
Add a line under **Unreleased** in `CHANGELOG.md` for every user-visible change. A change that adds
parsing of untrusted input, a new place the action writes to, or a new GitHub API call updates
`docs/THREAT-MODEL.md` in the same PR.

## Commands

```bash
pnpm install          # install
pnpm build            # typecheck + build core, bundle cli and action
pnpm test             # vitest (all packages)
pnpm test:coverage    # vitest with lcov output in coverage/
pnpm lint             # biome check + typecheck
pnpm format           # biome autofix
pnpm pharn-ci check   # run the built CLI on this repo
```

## Conventions

- TypeScript strict, ESM, Node 24. Relative imports use `.js` extensions.
- Workspace packages resolve to TypeScript sources via the `source` export condition, so tests
  and typechecks need no prior build.
- Paths in reports are repo-relative with forward slashes.
- Exit codes (CLI): 0 pass/warn, 1 fail, 2 usage or runtime error.
