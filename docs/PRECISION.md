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

### What this means for the signals

- **Silent test tampering is rare in merged agent PRs.** It is well below the roughly 1% that
  DECISIONS 2026-10-21 set as the bar for revisiting the positioning. What does occur is disclosed
  and still lands. Those are the cases where a named, recorded override (the accept label) fits better
  than a silent green check.
- **As specced, TI03 and TI01 would block honest PRs about 1.1% of the time** (22 of 1,966),
  which is above the 1% false-block bar. Two rules fix every false hit in this sample:
  - **TI03:** block only an *unconditional* skip added to an existing test. A skip guarded by a
    condition and given a reason (`test.skip(cond, "why")`, `pytest.skip()` inside an `if`,
    `skipif`/`skipUnless`) is at most a warn.
  - **TI01:** do not block when the PR also deletes the source file the test covers, matched
    by name (`foo.test.ts` with `foo.ts`). This becomes a must-not-trigger fixture.

### Limits of this measurement

- **Merged PRs only.** A PR that tampered with tests and was then closed by a reviewer is not in
  the sample. The rate of attempts may be higher than the rate that lands.
- **Ten days, mostly small repositories.** About 500 PRs per app fill up within ten days, and most
  of the sampled repositories are personal or small-team projects.
- **Diff-only signals.** Weakening that keeps the test, such as loosened assertions, edited expected
  values or hard-coded answers (TI02, TI05–TI07, TI15), is not measured. The precision run in E2
  covers those.
- **A regex is not the detector.** The Action's signals will be tested on fixtures, and their own
  precision is measured separately on a frozen corpus. That gets its own section here with v0.3.0.

To reproduce: `GH_TOKEN=$(gh auth token) node scripts/agent-pr-baserate.mjs --until 2026-10-23`.
It writes `hits.csv` and `summary.json` to `.cache/baserate/`, which is gitignored. Today's search
results will differ, because the sample is newest first.
