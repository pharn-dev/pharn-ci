# RUN REPORT — coverage-exclusions

Every line below is derived by `pharn/floor/render-run-report.mjs` from artifacts this run already
produced. No line is authored by a model.

**Trust split (P2).** The values this report reads from deterministic tool output — verdicts, exit
codes, token counts, paths — are the enum-gated / floor-verifiable class. Everything shown inside a
fenced block is **free text that inherits its source's untrusted tag** and is rendered as DATA:
quoted for a person to read, never executed, and never an instruction to any later stage.

**This report ANNOTATES a run and gates nothing.** No proceed/stop anywhere reads it. It is not a
judgment that the change is good, correct, or worth its cost.

## Outcome

The `decision` below is copied verbatim from `LOOP.md`'s frontmatter by the ledger; this report
introduces no second source of truth for it.

```text
decision         STOP_GREEN
iterations       1
blocked          none
base             8cc31571e0fa196543f8452deaa8e1eb3b116939
command          /pharn-loop
skills_version   6.57.0
ledger coverage  partial
run membership   bounded
```

## Tokens — stage x iteration x model

**Measured population: the RUN'S OWN CONTEXTS inside its window** (`run-window/2`) — only requests of the
selected session that fall inside the window below AND come from the context that printed the run's
markers or an agent that context tree spawned during the run. Earlier and later activity in that session,
and other contexts working inside the window (a concurrent run, its agents, the main thread), are excluded
and counted, never summed. This is NOT a feature's lifetime cost, other sessions' requests are not
collected, and the request that opened the window falls just before it. A floor on this run's spend,
never the total.

```text
status             bounded
method             run-window/2
window start       2026-10-12T18:59:17.593Z
window end         2026-10-12T19:25:30.590Z
selected session   cc1d5017-6a5e-4e64-a6d2-cdb06aaf4640
run context        agent:a03d51a52a57c3a47
run contexts       agent:a03d51a52a57c3a47, agent:a17ed07d1474790e5, agent:a4d6ff910673062ac, agent:a80f8f6d0b713785d, agent:ae468dd75d868b9f8
excluded requests  954
```

Copied from `cost.json`'s stored views, never recomputed here — `check-cost-ledger.mjs` already
holds those views to a recompute from `requests[]`, so this is one number with one owner.

**TOKENS ONLY.** There is no price table here or in `cost.json`; money is the reader's own
multiplication against their own list, and `output_thinking` is a SUBSET of `output`, not a seventh
class. `unattributed` is an honest STAGE bucket — run requests before the first stage marker — never
folded into a neighbouring stage.

```text
stage           iter  model              reqs  input  cache_write_5m  cache_write_1h  cache_read  output  output_thinking
--------------  ----  -----------------  ----  -----  --------------  --------------  ----------  ------  ---------------
(unattributed)  -     claude-opus-5-5      19     38           32991               0     2291392    2088              213
pharn-build     1     claude-opus-5-5       2      4            2140               0      238173      32                0
pharn-build     1     claude-sonnet-5-5    36     72          180451               0     4930387   20550             5424
pharn-grill     -     claude-opus-5-5       6     12           11950               0      669084    1022               21
pharn-plan      -     claude-opus-5-5      31     62          251872               0     4330817   25861            10942
pharn-spec      -     claude-opus-5-5      27     54          239740               0     3092716   18209            10083
pharn-test      -     claude-opus-5-5      35     70          222820               0     4521803   17982             1233
TOTAL           -     -                   156    312          941964               0    20074372   85744            27916
unattributed    -     -                    19     38           32991               0     2291392    2088              213
```

## Stage elapsed and deterministic work

**Observed elapsed** is wall-clock time between two PHARN markers — the stage's start and the orchestrator's
return — read by two different processes. It is NOT CPU time, model time or tool time, it is not monotonic, and
it includes orchestration, subprocesses, waiting and any answer a human gave inside the stage. An `unmeasured`
row names why no interval could be paired, and is never a zero. **Deterministic work** is counted from each
`/pharn-regress` and `/pharn-verify` execution's own gate-run stamp at its `done` exit; an execution that ended any
other way recorded none. Nothing here is subtracted from anything else.

```text
observed elapsed — wall clock between PHARN's stage markers (not CPU, model or tool time; not monotonic)
  stage              iter  run  elapsed
  pharn-spec            -    1  348.9 s
  pharn-plan            -    1  459.0 s
  pharn-grill           -    1  25.9 s
  pharn-test            -    1  373.9 s
  pharn-build           1    1  283.1 s
  pharn-regress         1    1  4778 ms
  pharn-verify          1    1  7584 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE from the entry gates (no worktree, no install, 0 base gate processes; 2 results from this run's entry check)
  pharn-verify iter 1 run 1: gates 4 run, 1 reused, 0 nothing-to-run, of 5
```

## Entry gates (background)

The **entry check** runs the project's gates in a background process while the spec, plan and grill stages work.
Its **lifetime** runs from `--start` to the record of the process that ended it: wall clock across processes,
placement only, not CPU or gate time. A **segment** is one runner or takeover process, timed on its own monotonic
clock. A **wait call** is the foreground time one `--wait` line took, and a takeover runs inside it and is never
added to it. Totals are interval unions, never sums. `INCOMPLETE` means no end was recorded before the run-stop
marker, and it is never a zero.

```text
entry gates — the background check, observed apart from the stage rows (never added to them)
  invocation 23cf122a: start started (call 267 ms); lifetime 4855 ms (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 166cc7: 4550 ms monotonic, 4 gate(s), ended done
    execution union: 4551 ms
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 1 (27 ms green); union 27 ms foreground
    abort: nothing running
```

## Files

Changed since `8cc31571e0fa196543f8452deaa8e1eb3b116939`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — under Unreleased → Added: exclusions from `coverage.exclude`, `--exclude` and the Action's `exclude` input, merged; the optional `diffCoverage.excludedFiles` report field and the "Excluded" summary in the comment
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — `exclude` row in the Action inputs table; `[--exclude <glob>]...` in the CLI usage plus a bullet; `coverage.exclude` in the config example; a short "Excluding files" note: the three sources merge (union, never override), the glob subset (`*`, `**`, `?`; anchored, whole path, case-sensitive; no braces, negation or classes), a pattern starting with `*` must be quoted in YAML, excluded files are listed in the report, and protect `.pharn/ci.yml` with CODEOWNERS because a PR can exclude its own files; one "What it proves" bullet saying exclusions come from the PR
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — declare the optional `exclude` input
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — §1: replace "There is no exclude list yet" with what exclusions do (changed files only, removed from every count and the table, listed in `excludedFiles` and the comment; deleted files never listed; the inventory and `COVERAGE_FILE_EMPTY` unaffected; every changed file excluded is the `NO_COVERABLE_CHANGES` pass) and the glob subset and what it does not support (braces, negation, classes, case-insensitivity, unanchored gitignore-style patterns; rejected rather than matched literally); §5: exclusions come from the PR, so the gate is only as honest as the config the PR carries; recommend CODEOWNERS
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — row A1: add the `coverage.exclude` list reader and the glob matcher (rejects unsupported syntax, matches hostile paths as given without throwing, linear on long paths and long lists) citing their AC tests; row B1: excluded paths are rendered through the same code spans, citing the AC-16 test; §3: a new named residual — exclusions come from the PR, a PR can exclude its own files (ultimately every file, which passes as `NO_COVERABLE_CHANGES`), and the gate is as honest as the config the PR carries, as with the coverage file; statuses unchanged
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build` (core is bundled into it)
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — `exclude` input split on commas and newlines, blanks dropped; early validation; union with `coverage.exclude`
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — repeatable `--exclude <glob>` flag and help line; early validation; union with `coverage.exclude`
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — `CheckInput.exclude`; validate, de-duplicate and compile patterns first; pass the predicate to `computeDiffCoverage`
  ```

- `packages/core/src/config.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/config.ts` — `parseExcludePattern` export; `coverage.exclude` in `PharnConfig`; block list read for `coverage.exclude` only; validation of its items
  ```

- `packages/core/src/diffCoverage.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/diffCoverage.ts` — optional `isExcluded` predicate; excluded changed files skipped and collected into `excludedFiles`; shared `byPath` sort
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — re-export `compileGlob`, `matchGlob` and `parseExcludePattern`
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — the `<details>` "Excluded: N files" block in the Diff coverage section
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — optional `ReportDiffCoverage.excludedFiles`, copied by `buildReport` only when non-empty
  ```

- `schema/report.v1.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v1.json` — optional `diffCoverage.excludedFiles` (array of non-empty strings), documented; not required
  ```

- `fixtures/golden-exclusions/ci.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/ci.yml` — the fixture's patterns and threshold (AC-17)
  ```

- `fixtures/golden-exclusions/coverage.info`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/coverage.info` — the fixture lcov (AC-17)
  ```

- `fixtures/golden-exclusions/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/files.txt` — the fixture tracked-files list (AC-17)
  ```

- `fixtures/golden-exclusions/pr.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/pr.diff` — the fixture diff (AC-17)
  ```

- `fixtures/golden-exclusions/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.json` — golden JSON, written by `pnpm vitest run -u` on the AC-17 test file only, reviewed
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — golden markdown, written the same way, reviewed
  ```

- `packages/action/test/exclude.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/exclude.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/glob.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/glob.ts` — new: hand-written, regex-free, linear glob matcher (`compileGlob`, `matchGlob`); no validation
  ```

- `packages/core/test/config-exclude.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/exclusions-check.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/exclusions-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/exclusions-report.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/glob.test.ts` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/cost.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-exclusions/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- verify: `PASS`

  failing_gates, quoted as DATA:

  ```text
  (none)
  ```

- acceptance criteria: `PASS` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  unit  passed  delivered  packages/core/test/glob.test.ts::matchGlob › AC-1: matches the glob subset anchored at the root, case-sensitively, and everything else literally
  AC-2  unit  passed  delivered  packages/core/test/glob.test.ts::matchGlob › AC-2: accepts ./src/** as src/** and rejects unsupported patterns with a ConfigError naming them
  AC-3  unit  passed  delivered  packages/core/test/glob.test.ts::matchGlob › AC-3: matches paths a pull request can name as given, without normalizing or throwing
  AC-4  unit  passed  delivered  packages/core/test/glob.test.ts::matchGlob › AC-4: matches 100,000-character paths in linear time
  AC-5  unit  passed  delivered  packages/core/test/config-exclude.test.ts::parseConfig: coverage.exclude › AC-5: reads coverage.exclude as a block list of quoted and plain strings, in order
  AC-6  unit  passed  delivered  packages/core/test/config-exclude.test.ts::parseConfig: coverage.exclude › AC-6: rejects coverage.exclude values that are not a list of valid glob strings
  AC-7  unit  passed  delivered  packages/core/test/config-exclude.test.ts::parseConfig: coverage.exclude › AC-7: parses 100,000 items and a 100,000-character pattern in linear time
  AC-8  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-8: leaves excluded changed files out of every diff coverage count and lists them sorted
  AC-9  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-9: lists unknown and renamed-into files, never deleted or renamed-out-of files
  AC-10  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-10: passes with NO_COVERABLE_CHANGES when every changed file with coverable lines is excluded
  AC-11  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-11: has no excludedFiles property when no changed file is excluded
  AC-12  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-12: never changes the agent setup inventory, even when ** excludes every changed file
  AC-13  unit  passed  delivered  packages/core/test/exclusions-check.test.ts::check(): exclusions › AC-13: throws a ConfigError naming a pattern the validation rejects
  AC-14  unit  passed  delivered  packages/core/test/exclusions-report.test.ts::report schema: diffCoverage.excludedFiles › AC-14: accepts an optional array of non-empty path strings
  AC-15  unit  passed  delivered  packages/core/test/exclusions-report.test.ts::renderMarkdown: excluded files › AC-15: summarizes excluded files in a <details> block inside the Diff coverage section
  AC-16  unit  passed  delivered  packages/core/test/exclusions-report.test.ts::renderMarkdown: excluded files › AC-16: keeps hostile excluded paths from adding lines, headings or raw HTML
  AC-17  unit  passed  delivered  packages/core/test/exclusions-golden.test.ts::golden: fixture diff + lcov + exclusions -> Report v1 › AC-17: excludes the fixture's generated files and matches the golden JSON and markdown
  AC-18  integration  passed  delivered  packages/cli/test/exclude.test.ts::pharn-ci check --exclude › AC-18: lists --exclude <glob> in the help | packages/cli/test/exclude.test.ts::pharn-ci check --exclude › AC-18: merges --exclude flags with coverage.exclude and recomputes coverage and the exit code
  AC-19  integration  passed  delivered  packages/cli/test/exclude.test.ts::pharn-ci check --exclude › AC-19: exits 2 naming a rejected pattern from --exclude or from coverage.exclude
  AC-20  integration  passed  delivered  packages/action/test/exclude.test.ts::action input exclude › AC-20: merges the exclude input with coverage.exclude, ignoring blank entries
  AC-21  integration  passed  delivered  packages/action/test/exclude.test.ts::action input exclude › AC-21: fails the step naming a rejected pattern in the exclude input
  note  an AC is delivered = a locked, once-red test titled AC-<n>:, in a file mapped to AC-<n>, passed on this head run. PHARN does not judge whether that test fully captures the AC's intent.
  ```

- regress: `no-regressions`

  regressions, quoted as DATA:

  ```text
  (none)
  ```

## Briefing

_n/a — no BRIEFING.md beside this report — not every command renders one, and a run that stops before its post-verify gate never does_

## What the run ran into

Quoted verbatim from `LOOP.md`'s `## Handoff`, as untrusted DATA. Each block is fenced with a
delimiter longer than any back-tick run inside it, so a heading in the quoted text stays text.
**The Handoff is a run's own account of itself — it is not verified by anything**, and nothing here
checks that it is accurate, complete, or useful.

### investigated

```text
The SPEC stage found that the existing config YAML subset rejects lists and any plain value starting with `*`, so
the SPEC allows a block list only as the value of `coverage.exclude` and requires patterns beginning with `*` to be
quoted. The existing test that rejects a list under `coverage` was kept unchanged. No prior LOOP.md existed for this
intent.
```

### learned

```text
Choices the model made where the description was silent (SPEC Assumptions, untrusted DATA): patterns are anchored at
the repo root; unsupported syntax (braces, brackets, leading `!`, absolute paths, backslashes, `..`, `//`, trailing
`/`) is rejected with a ConfigError rather than matched literally; a leading `./` is stripped; `excludedFiles` is
written only when non-empty, so `fixtures/golden/` output is unchanged; an all-excluded diff reuses the existing
`NO_COVERABLE_CHANGES` pass. The plan also caps the rendered Excluded list at `maxRows` (50), which the SPEC did not
ask for. The build's `pnpm vitest run -u` with a file filter ran the whole suite with `-u`; it wrote only the two new
golden files.
```

### next_steps

```text
A person reviews branch pharn-loop/coverage-exclusions, in particular the model-made SPEC assumptions listed above
and the `maxRows` cap on the Excluded list, then decides whether to open a PR.
```
