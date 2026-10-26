# pharn-ci — Precision

How often the test-integrity signals fire on real pull requests, and how often they are right.
Measured before the signals are built, so their design follows the data. Every number here can be
reproduced with the script named in each section.

## 1. Base rate: how often agent PRs delete, skip, narrow or weaken tests

Measured on 2026-10-24 with [`scripts/agent-pr-baserate.mjs`](../scripts/agent-pr-baserate.mjs).

### Sample

- **Who:** merged public PRs authored by four coding-agent GitHub Apps: `claude`, `copilot-swe-agent`,
  `devin-ai-integration` and `cursor`. They were found with the search query
  `is:pr is:merged is:public author:app/<name>`.
- **Size:** 500 per app, newest first, merged between 2026-10-14 and 2026-10-23.
- **Spread:** at most 3 PRs from any one repository, so a few busy repositories do not dominate.
  The sample covers 1,099 repositories.
- **Excluded:**
  - test runners' own repositories (`vitest-dev`, `jestjs`, `jest-community`, `mochajs`, `pytest-dev`),
    whose fixtures are full of intentional `.skip` and `.only`;
  - `pharn-dev`.
- **Scanned:** 1,966 of the 2,000 diffs. 34 were too large or unavailable from the API.

### What was detected

These are plain regexes over the diff text: an approximation of four signals from the
test-integrity spec, not the Action's implementation. A test file is matched by the spec's globs
(`*.test.*`, `*.spec.*`, `test/`, `tests/`, `__tests__/`, `test_*.py`, `*_test.py`, `*_test.go` and
others), limited to code files.

| Signal | Detected when the PR… |
|---|---|
| TI01 | deletes a test file, or renames it to a name that is not a test |
| TI03 | adds a skip to a test file: `.skip`, `xit`, `.todo`, `.fails`, `@pytest.mark.skip`/`skipif`/`xfail`, `pytest.skip()`, `@unittest.skip*`, Go `t.Skip` |
| TI04 | adds `.only`, `fit(` or `fdescribe(` to a test file |
| TI10 | adds `\|\| true`, `exit 0`, `--passWithNoTests`, `-t` or a test-path filter to a `test*` script in `package.json`, or removes `pretest`/`posttest` |

A line that the same file also removes is ignored, so a moved or re-indented line does not count.
Comment lines are ignored too.

### Result

**25 of 1,966 PRs (1.3%) triggered at least one signal. Reviewed by hand, 3 of them (0.15%) weaken
tests. All 3 say so in the PR description.**

| App | Scanned | Any hit | TI01 | TI03 | TI04 | TI10 |
|---|---:|---:|---:|---:|---:|---:|
| claude | 497 | 7 | 1 | 6 | 0 | 0 |
| copilot-swe-agent | 477 | 7 | 0 | 7 | 0 | 0 |
| devin-ai-integration | 493 | 4 | 1 | 3 | 0 | 1 |
| cursor | 499 | 7 | 3 | 4 | 0 | 0 |
| **Total** | **1,966** | **25** | **5** | **20** | **0** | **1** |

A first pass also counted 1 TI04 hit, which was `solver.fit(` (a scikit-learn call). The script now
matches `fit(` only as a bare call, and the table above is from the fixed script.

**Hand review of the 25 PRs:**

| Verdict | PRs | What they are |
|---|---:|---|
| Weakens tests; a reviewer should decide | 3 | All 3 are listed below |
| Test deleted together with the code it tests | 3 | Legitimate cleanup |
| Conditional skip that guards the environment | 19 | All in test code the same PR adds or extends, each with a reason: no camera, no Docker, needs root, mobile-only test, fixture not downloaded |

The three PRs that weaken tests:

- [arthuryan-k/devin-demo#31](https://github.com/arthuryan-k/devin-demo/pull/31) (Devin):
  - deletes a service's whole `test/` directory and `vitest.config.ts`;
  - changes its `test` script to `vitest run --passWithNoTests` (TI01 + TI10);
  - the PR title says "drop reference-data-service tests".
- [kamoshika-san/TextUI-Designer#338](https://github.com/kamoshika-san/TextUI-Designer/pull/338) (Cursor):
  - adds `it.skip` to an existing test that failed in CI (TI03);
  - the description calls the test racy and points to another test that checks the same exit code.
- [kody-hq/kody#3851](https://github.com/kody-hq/kody/pull/3851) (Cursor):
  - deletes a test file while the code it tested stays (TI01);
  - the PR is a stated cleanup of low-value tests.

### PRs closed without merging

Merged PRs leave out the attempts a reviewer caught, so the same script also sampled agent PRs that
were closed without merging (`--state unmerged`). It used the same apps, sizes and exclusions, for
PRs closed between 2026-09-06 and 2026-10-24, across 1,247 repositories. 1,786 of the 2,000 diffs
could be read; closed PRs often have a deleted branch.

**35 of 1,786 PRs (2.0%) triggered at least one signal. Reviewed by hand, 7 of them (0.39%) weaken
tests. All 7 say so in the PR description.**

| App | Scanned | Any hit | TI01 | TI03 | TI04 | TI10 |
|---|---:|---:|---:|---:|---:|---:|
| claude | 478 | 6 | 3 | 3 | 0 | 0 |
| copilot-swe-agent | 353 | 6 | 4 | 2 | 0 | 0 |
| devin-ai-integration | 464 | 14 | 6 | 8 | 0 | 1 |
| cursor | 491 | 9 | 3 | 6 | 0 | 0 |
| **Total** | **1,786** | **35** | **16** | **19** | **0** | **1** |

This sample exposed two more detector mistakes, and the script now handles both; the table is from
the fixed script:
- `def fit(` in Python matched TI04. `.only` and `fit(` now count only in JS/TS files.
- An existing `it.fails` on a line the PR edited (sync → async) looked like a new skip. A skip now
  counts as already there when the same token and test name were removed.

**Hand review of the 35 PRs:**

| Verdict | PRs | What they are |
|---|---:|---|
| Weakens tests; a reviewer should decide | 7 | Listed below |
| Conditional skip, or a skip in a test the PR adds | 14 | Environment guards with a reason (`REDIS_URL not set`, OpenSSL version, Windows), and `xfail` on new tests for known bugs |
| Tests deleted with the code they test | 11 | A whole server, app, package or theme removed, or a repository restructured |
| Test migrated | 2 | Mocha specs rewritten as Vitest tests under a new name (Cypress) |
| No tests yet | 1 | `--passWithNoTests` added to a project that has no tests |

The seven PRs that weaken tests:

- [jgarrison929/pitbull#679](https://github.com/jgarrison929/pitbull/pull/679), [#678](https://github.com/jgarrison929/pitbull/pull/678) and [#663](https://github.com/jgarrison929/pitbull/pull/663) (Cursor): each `test.skip`s an existing e2e test that failed once in CI, and the title says "skip flaky".
- [COG-GTM/juice-shop#1248](https://github.com/COG-GTM/juice-shop/pull/1248) and [#1251](https://github.com/COG-GTM/juice-shop/pull/1251) (Devin): each fixes a deliberate vulnerability in OWASP Juice Shop and disables (`xdescribe`, `it.skip`) the e2e tests that exploited it, saying so.
- [StorminRH/lgi-tools#558](https://github.com/StorminRH/lgi-tools/pull/558) (Cursor): a stated cleanup that deletes a low-value test file.
- [VividLemon/bootstrap-vue-next#158](https://github.com/VividLemon/bootstrap-vue-next/pull/158) (Copilot): a component rewrite that replaces two spec files with one; about 100 test cases removed, 16 added.

### What this means for the signals

- **Test weakening is rare, and it is not hidden.** 10 of 3,752 PRs weaken tests: 0.15% of
  merged PRs and 0.39% of closed ones. That is well below the roughly 1% that DECISIONS 2026-10-21
  set as the bar for revisiting the positioning. All 10 say what they do in the PR. The most common
  case is skipping a test that failed in CI (4 of 10), then deliberate test cleanup (3).
- **The useful check is a recorded sign-off, not catching a cheat.** What lands is disclosed but
  goes unnoticed in review: 3 of these PRs merged. The accept label fits this better than a silent
  green check: the PR fails, a person other than the author applies the label, and the run records
  who.
- **As specced, TI03 and TI01 would block honest PRs** about 1.1% of the time on merged PRs (22 of
  1,966) and 1.6% on closed ones (28 of 1,786). Both are above the 1% false-block bar. These rules
  fix all but one false hit across both samples:
  - **TI03:** block only an *unconditional* skip added to a test that exists at base. A skip guarded
    by a condition and given a reason (`test.skip(cond, "why")`, `pytest.skip()` inside an `if`,
    `skipif`/`skipUnless`), or any skip in a test the PR adds, is at most a warn. A skip that is
    already there does not count when its line is moved or edited.
  - **TI01:** a deleted file counts only if its removed lines define tests (not a helper or an
    `__init__.py` under `tests/`). It does not block when the PR also deletes the code the test
    covers: a source file with the same name, or source files in the package the test belongs to
    (the test's directory, or the one holding its `test`/`tests`/`__tests__` folder). It does not
    block either when the PR adds a test file with the same name elsewhere (a move or a migration).
  - **TI04:** `.only` and `fit(` only in JS/TS test files, and `fit(` only as a bare call.
  - **TI10:** adding `--passWithNoTests` does not block when the repository has no test files
    (`git ls-files`, which the check already reads).
  - The one false hit left is a wholesale rewrite of a small project that deletes its old tests
    without deleting their code in the same PR.

### Limits of this measurement

- **Merged and closed PRs, not open ones.** Open PRs and PRs still under review are not sampled.
- **Days to weeks, mostly small repositories.** About 500 PRs per app fill up within ten days for
  merged PRs and seven weeks for closed ones. Most of the sampled repositories are personal or
  small-team projects.
- **Diff-only signals.** Weakening that keeps the test, such as loosened assertions, edited expected
  values or hard-coded answers (TI02, TI05–TI07, TI15), is not measured. The precision run in E2
  covers those.
- **A regex is not the detector.** The Action's signals will be tested on fixtures, and their own
  precision is measured separately on a frozen corpus (section 2). The results land there with v0.3.0.

To reproduce:
`GH_TOKEN=$(gh auth token) node scripts/agent-pr-baserate.mjs --until 2026-10-23` for merged PRs, and
`… --state unmerged --until 2026-10-24 --out .cache/baserate-unmerged` for closed ones. Each run
writes `hits.csv` and `summary.json` to its `--out` folder, which is gitignored. Today's search
results will differ, because the sample is newest first.

## 2. Precision corpus

The signals' own precision is measured on real merged PRs from three public repositories. The
sample is frozen before any detector runs over it. A newest-first sample drifts every day, and a
sample chosen after seeing detector output could be tuned to it. So the list of PRs is fixed here,
in files committed to the repository, and the detector run (`scripts/corpus-run.mjs`), the hand
review and any false-block rate come afterwards.

An early dry run of the detectors over this corpus, made before the official run, found false hits in four signals.
The narrower rules for TI11 (commands compared by key), TI09 (projects matched by name),
TI15 (same package, a 6-character and 4-digit minimum, at most 10 per change) and TI06 (equivalent matcher rewrites)
came from that dry run. They are not a measured result. The official numbers come with item 18, the full precision
run over the frozen corpus, and may recommend demoting TI15 to `info`.

### Repositories

Picked for a test runner the Action's signals understand (vitest), an MIT license and enough merged
PRs to fill 200 human PRs within a year. At least one is a monorepo.

| Repository | License | Runner | Monorepo | Merged PRs into main, 12 months (non-bot) | Excluded bots | Excluded releases |
|---|---|---|---|---:|---:|---:|
| `TanStack/query` | MIT | vitest | yes | 1540 | 1 | 0 |
| `shadcn-ui/ui` | MIT | vitest | yes | 697 | 96 | 0 |
| `honojs/hono` | MIT | vitest | no | 288 | 0 | 0 |

The 12-month count is merged PRs into the default branch from 2025-10-25 to 2026-10-24, counted
with the rule below. It is how many PRs were available, not how many were frozen: 200 per
repository are frozen, so the corpus is 600 PRs.

Why these three:

- **`TanStack/query`** is the monorepo: about 20 packages under `packages/` in one pnpm workspace,
  built with nx, each tested with vitest. It also has the busiest PR flow, and many of its PRs only
  add or change tests, which is where a false block would show.
- **`shadcn-ui/ui`** is a second monorepo (`apps/*` and `packages/*`, turbo), tested with vitest in
  `packages/shadcn`. Most of its PRs touch the component registry or the docs app and no test file:
  a realistic share of PRs on which a signal should stay silent.
- **`honojs/hono`** is a single library (its workspace only adds small `adapters/*` packages) with
  dense vitest tests under `src/`, run through Vite+ (`vp test`). It is the non-monorepo case.

Rejected: `withastro/astro`. Its unit and integration tests run on `node:test` (through
`astro-scripts`) plus Playwright, not vitest or jest.

### How the corpus is frozen

`scripts/corpus-freeze.mjs` writes one file per repository to `fixtures/corpus/`. It is a maintainer
script: nothing in the Action or the CLI imports it, and it reaches GitHub only through `gh api`.

- **Freeze instant:** `2026-10-25T00:00:00Z`. A PR merged at that instant or later is not in the
  corpus.
- **Which PRs:** merged PRs into the repository's default branch, ordered by merge time, newest
  first, ties by PR number, highest first. The first 200 that qualify are kept.
- **Exclusions:** a PR does not qualify if its author is a bot (a `Bot` account type, a `[bot]`
  login, or a login that is or starts with `renovate` or `dependabot`, in any case) or if it is a
  changesets release PR (a `changeset-release/` branch, or a title that is exactly "version
  packages" after an optional `chore:`-style prefix). The bot test runs first, so a bot's release PR
  counts once, as a bot.
- **Excluded counts:** each file records how many bot and release PRs were left out between the
  oldest kept merge time and the freeze instant, so a reader can see how much of the activity the
  rule removed. The table above copies these numbers from the files.
- **What is stored:** for each PR, its number, merge time and the base, head and merge-commit shas.
  Titles and logins are read only to apply the rule and are never stored.
- **Reproducible:** the same repository state gives the same bytes. The files are never edited by
  hand.
- **Windows:** the 200 PRs of `TanStack/query` were merged between 2026-10-18 and 2026-10-24, those
  of `shadcn-ui/ui` between 2026-07-16 and 2026-10-24, and those of `honojs/hono` between 2026-03-31
  and 2026-10-17.

To reproduce, with `gh` authenticated (`gh auth login`):

```
node scripts/corpus-freeze.mjs --repo TanStack/query --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/TanStack__query.json --monorepo true
node scripts/corpus-freeze.mjs --repo shadcn-ui/ui --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/shadcn-ui__ui.json --monorepo true
node scripts/corpus-freeze.mjs --repo honojs/hono --frozen-at 2026-10-25T00:00:00Z --count 200 --out fixtures/corpus/honojs__hono.json --monorepo false
```

### How the run works

Two maintainer scripts turn the frozen PR lists into a false-block rate. Neither is part of the Action or
the CLI. Build the CLI first (`pnpm build`), then:

```
node scripts/corpus-run.mjs [--repo owner/name] [--limit n] [--jobs n] --out <file.csv>
```

`scripts/corpus-run.mjs` reads the files in `fixtures/corpus/` and, for each repository, makes one blobless
clone in the cache. For each PR it fetches the base and head shas (falling back to GitHub's `pull/<n>/head`
ref), adds a detached worktree at the head sha, runs
`check --base <baseSha> --test-integrity block --format json` there, writes one row per signal of the report,
and removes the worktree. `--jobs` runs several PRs at once; the CSV is the same whatever its value.

- **Cache:** `~/.cache/pharn-ci-corpus` by default, or the directory in `PHARN_CORPUS_CACHE`, or `--cache`.
  Without `--out` the CSV is `corpus-run.csv` in the cache, not in the repository.
- **Safety:** the script reaches github.com only through git, with no GitHub API call. Git hooks and LFS
  smudge are off. It installs nothing, runs nothing from a cloned repository and writes none of its
  configuration.
- **Columns:** `repo,pr,signal,severity,path,line,code,detail,verdict,note`. A PR with no signal gets one row
  whose signal is `none`. A PR that could not be run (a failed clone or fetch, a CLI that crashes or runs
  past `--timeout`) gets one row whose signal is `error` and whose `detail` says why; the run goes on.
- **Resume:** a PR already in `--out` is not run again and its rows are kept as they are, so the verdicts you
  type survive a rerun. To run a PR again, delete its rows.

Review is by hand: fill the `verdict` column of every `block` row with `TP` (a true block), `FP` (a false
block) or `unclear` (reviewed, and not counted as a false block), and use `note` for the reason. Then:

```
node scripts/corpus-rate.mjs <file.csv> [--format md|json]
```

`scripts/corpus-rate.mjs` prints, for each signal that has a `block` row, how many PRs it blocked, the verdict
counts and the false-block rate. The rate is the number of PRs with an `FP` block row of that signal over
all PRs in the CSV, PRs that errored included. A signal whose rate is below 1 % and whose `block` rows are all
reviewed ships as block; otherwise it demotes to warn. Exactly 1 % demotes. The script exits 1 while a
`block` row has no verdict, and 2 on a missing file, a wrong header or an unknown verdict.

The reviewed CSV and the rates land with `v0.3.0`.

### Limits

- **Base branch is the default branch today.** A PR whose base was changed after it merged is not
  listed by GitHub under the new base and is missed.
- **Bots are matched by account, not by behavior.** An agent that opens PRs from a human account
  is in the corpus, which is what the corpus is for. A coding-agent GitHub App whose PRs carry a
  `Bot` account type (such as `copilot-swe-agent`) is excluded with the dependency bots.
- **One busy week for `TanStack/query`.** Its 200 PRs cover seven days, so that repository's share
  reflects one stretch of work rather than a year.
- **The runs are not here yet.** The scripts are, but running them on the 600 PRs, the hand review and
  any false-block rate land with BACKLOG item 18 and v0.3.0.
