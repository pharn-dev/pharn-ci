# RUN REPORT — coverage-auto-discovery-2

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
base             dd2a03b41299c2cdb4da03bc790da6c96e526804
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
window start       2026-10-18T20:45:48.660Z
window end         2026-10-18T21:13:54.653Z
selected session   ce164c99-cf0f-4120-ace6-7c10000efe45
run context        main
run contexts       agent:a0c254375f7dc091e, agent:a514edf69b7aa70f6, agent:a83d87ae9dc2ea9fc, agent:ab459d8ef815ce0fd, main
excluded requests  105
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
(unattributed)  -     claude-opus-5-5       8     16               0            6031     1726758    3365              489
pharn-build     1     claude-opus-5-5       2      4               0            2225      431864     749               56
pharn-build     1     claude-sonnet-5-5    44     88          203369               0     6793089   23478             1864
pharn-grill     -     claude-opus-5-5       1      2               0            1133      210393     873                0
pharn-plan      -     claude-opus-5-5      48     96          191263            2847     8065306   21698             3285
pharn-spec      -     claude-opus-5-5      36     72          146091            3401     4188187    8211              234
pharn-test      -     claude-opus-5-5      50    100          157483            2372     7343390   28277             2038
TOTAL           -     -                   189    378          698206           18009    28758987   86651             7966
unattributed    -     -                     8     16               0            6031     1726758    3365              489
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
  pharn-spec            -    1  248.7 s
  pharn-plan            -    1  560.1 s
  pharn-grill           -    1  8852 ms
  pharn-test            -    1  508.4 s
  pharn-build           1    1  280.4 s
  pharn-regress         1    1  17.7 s
  pharn-verify          1    1  10.0 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 724 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation daac97d5: start started (call 396 ms); lifetime 22.5 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 0d0b18: 22.1 s monotonic, 4 gate(s), ended done
    execution union: 22.1 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 14.7 s
    wait calls: 1 (20 ms green); union 20 ms foreground
    abort: nothing running
```

## Files

Changed since `dd2a03b41299c2cdb4da03bc790da6c96e526804`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

20 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased line for coverage auto-discovery
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — Quick start and CLI section mention auto-discovery and `examples/workflows/`
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — `coverage-file` description says the path is auto-discovered when unset
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — new row A3: coverage auto-discovery as disk probing of untrusted files, with its covering test
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt with `pnpm build`
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — discovery when no coverage path is set; `listDir` doc text
  ```

- `packages/action/test/run.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/run.test.ts` — replace the obsolete empty `coverage-file` failure row with a test of the new not-found report (step 9)
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — discovery when no coverage path is set; HELP and `listDir` doc text
  ```

- `packages/cli/test/main.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/main.test.ts` — replace the obsolete `["check"]` exit-2 row with a test of the new not-found report (step 9)
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — `CheckInput.coverage` accepts the not-found discovery value; early `COVERAGE_FILE_MISSING` return
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export the discovery API, and `walkGlob`, `WalkLimitError`, `WalkBudget`
  ```

- `packages/core/src/inputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/inputs.ts` — opt-in `discoverCoverage` option; `coverageFile` may resolve to `{ discover: true }`
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — `coverage-not-discovered` missing reason mapped to `COVERAGE_FILE_MISSING` with the candidates text
  ```

- `packages/node-io/src/coverage.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/src/coverage.ts` — opt-in `literal` option on `readCoverageFiles`
  ```

- `packages/node-io/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/src/index.ts` — export the discovery helpers
  ```

- `.agents/skills/source-command-pharn-build/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-grill/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-loop-close/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-loop-quick/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-loop/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-memory-promote/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-plan/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-regress/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-review/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-ship-close/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-ship-quick/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-ship/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-spec/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-test/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.agents/skills/source-command-pharn-verify/SKILL.md` — _dirty-before-run; not named in PLAN ## Files_
- `.codex/hooks.json` — _dirty-before-run; not named in PLAN ## Files_
- `.codex/hooks/enforce-writes-scope.cjs` — _dirty-before-run; not named in PLAN ## Files_
- `.codex/hooks/protect-trusted-paths.cjs` — _dirty-before-run; not named in PLAN ## Files_
- `.codex/hooks/require-loop-record.cjs` — _dirty-before-run; not named in PLAN ## Files_
- `.codex/hooks/set-writes-scope.cjs` — _dirty-before-run; not named in PLAN ## Files_
- `examples/workflows/cargo.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `examples/workflows/cargo.yml` — new example workflow
  ```

- `examples/workflows/dotnet.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `examples/workflows/dotnet.yml` — new example workflow
  ```

- `examples/workflows/jest.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `examples/workflows/jest.yml` — new example workflow
  ```

- `examples/workflows/pytest.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `examples/workflows/pytest.yml` — new example workflow
  ```

- `examples/workflows/vitest.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `examples/workflows/vitest.yml` — new example workflow
  ```

- `fixtures/coverage-discovery/cobertura-coverage/coverage/cobertura-coverage.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/cobertura-coverage/coverage/cobertura-coverage.xml` — AC-6 case: only `coverage/cobertura-coverage.xml`
  ```

- `fixtures/coverage-discovery/cobertura-coverage/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/cobertura-coverage/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/coverage-lcov/coverage/lcov.info`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/coverage-lcov/coverage/lcov.info` — AC-6 case: only `coverage/lcov.info`
  ```

- `fixtures/coverage-discovery/coverage-lcov/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/coverage-lcov/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/coverage-xml/coverage.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/coverage-xml/coverage.xml` — AC-6 case: only `coverage.xml`
  ```

- `fixtures/coverage-discovery/coverage-xml/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/coverage-xml/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/dotnet-many/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-many/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/a1/coverage.cobertura.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/a1/coverage.cobertura.xml` — AC-6 case: several coverlet files (1 of 3)
  ```

- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/b2/coverage.cobertura.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/b2/coverage.cobertura.xml` — AC-6 case: several coverlet files (2 of 3)
  ```

- `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/c3/coverage.cobertura.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-many/tests/App.Tests/TestResults/c3/coverage.cobertura.xml` — AC-6 case: several coverlet files (3 of 3)
  ```

- `fixtures/coverage-discovery/dotnet-one/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-one/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/dotnet-one/tests/App.Tests/TestResults/abc/coverage.cobertura.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/dotnet-one/tests/App.Tests/TestResults/abc/coverage.cobertura.xml` — AC-6 case: one coverlet file
  ```

- `fixtures/coverage-discovery/lcov-root/lcov.info`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/lcov-root/lcov.info` — AC-6 case: only `lcov.info`
  ```

- `fixtures/coverage-discovery/lcov-root/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/lcov-root/src/a.ts` — unrelated file for that case
  ```

- `fixtures/coverage-discovery/none/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/none/src/a.ts` — AC-6 not-found case: only an unrelated file
  ```

- `fixtures/coverage-discovery/two-kinds/coverage/lcov.info`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/two-kinds/coverage/lcov.info` — AC-6 ambiguous case (1 of 2)
  ```

- `fixtures/coverage-discovery/two-kinds/lcov.info`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/two-kinds/lcov.info` — AC-6 ambiguous case (2 of 2)
  ```

- `fixtures/coverage-discovery/two-kinds/src/a.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-discovery/two-kinds/src/a.ts` — unrelated file for that case
  ```

- `packages/action/test/ac-discovery-action-ambiguous.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-discovery-action-found.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-discovery-action-none.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-discovery-cli-ambiguous.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-discovery-cli-explicit.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-discovery-cli-found.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-discovery-cli-none.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/coverageDiscovery.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/coverageDiscovery.ts` — new: candidate list, pure choice rule, log, error and message text builders
  ```

- `packages/core/test/ac-discovery-check-missing.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-choose-ambiguous.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-choose-dotnet.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-choose-none.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-choose-single.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-examples-runs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-discovery-examples-shape.test.ts` — _not named in PLAN ## Files_
- `packages/node-io/src/discovery.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/src/discovery.ts` — new: `discoverCoverage` and `readDiscoveredCoverage`, shared by the CLI and the Action
  ```

- `packages/node-io/test/ac-discovery-fixtures.test.ts` — _not named in PLAN ## Files_
- `packages/node-io/test/ac-discovery-walk-rules.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-discovery-choose-single.test.ts::chooseDiscoveredCoverage: exactly one candidate › AC-1: one candidate of each kind among unrelated paths is found, and is the only file | packages/core/test/ac-discovery-choose-single.test.ts::chooseDiscoveredCoverage: exactly one candidate › AC-1: the choice does not depend on where the candidate sits in the input
  AC-2  unit  passed  delivered  packages/core/test/ac-discovery-choose-dotnet.test.ts::chooseDiscoveredCoverage: several .NET coverlet files › AC-2: every coverage.cobertura.xml match is one candidate, found with all its files sorted
  AC-3  unit  passed  delivered  packages/core/test/ac-discovery-choose-ambiguous.test.ts::chooseDiscoveredCoverage: different candidates found › AC-3: two or more different candidates are ambiguous, list every found path and choose no file
  AC-4  unit  passed  delivered  packages/core/test/ac-discovery-choose-none.test.ts::chooseDiscoveredCoverage: no candidate › AC-4: an empty set and a set of only unrelated paths are not-found | packages/core/test/ac-discovery-choose-none.test.ts::chooseDiscoveredCoverage: no candidate › AC-4: the exported candidate list is exactly the five candidates, in order
  AC-5  unit  passed  delivered  packages/core/test/ac-discovery-check-missing.test.ts::check(): no coverage report discovered › AC-5: one COVERAGE_FILE_MISSING naming the candidates, warn without a threshold and fail with 80
  AC-6  integration  passed  delivered  packages/node-io/test/ac-discovery-fixtures.test.ts::discoverCoverage over fixtures/coverage-discovery/ › AC-6: each fixture directory gives the same result as core's choice, and the expected one
  AC-7  integration  passed  delivered  packages/node-io/test/ac-discovery-walk-rules.test.ts::discoverCoverage: node_modules, directories and symbolic links › AC-7: no file under node_modules, no directory and no symbolic link counts as a candidate
  AC-8  integration  passed  delivered  packages/cli/test/ac-discovery-cli-found.test.ts::pharn-ci check with no coverage path and coverage/lcov.info on disk › AC-8: discovers coverage/lcov.info from the repo root and from a subdirectory, and measures from it
  AC-9  integration  passed  delivered  packages/cli/test/ac-discovery-cli-ambiguous.test.ts::pharn-ci check with no coverage path and two different candidates on disk › AC-9: exits 2 with nothing on stdout, and stderr names both found files and --coverage
  AC-10  integration  passed  delivered  packages/cli/test/ac-discovery-cli-none.test.ts::pharn-ci check with no coverage path and no candidate on disk › AC-10: reports COVERAGE_FILE_MISSING naming the candidates, exit 0 without a threshold and 1 with 80
  AC-11  integration  passed  delivered  packages/cli/test/ac-discovery-cli-explicit.test.ts::pharn-ci check with an explicit coverage path while a candidate is on disk › AC-11: --coverage missing.info wins over the discoverable coverage/lcov.info | packages/cli/test/ac-discovery-cli-explicit.test.ts::pharn-ci check with an explicit coverage path while a candidate is on disk › AC-11: coverage.file: missing.info in .pharn/ci.yml wins over the discoverable coverage/lcov.info
  AC-12  integration  passed  delivered  packages/action/test/ac-discovery-action-found.test.ts::action: no coverage-file input and only coverage.xml in the workspace › AC-12: discovers coverage.xml, logs it, measures Cobertura from it and does not fail the step
  AC-13  integration  passed  delivered  packages/action/test/ac-discovery-action-ambiguous.test.ts::action: no coverage-file input and two different candidates in the workspace › AC-13: fails the step naming both found files and coverage-file, and posts no comment
  AC-14  integration  passed  delivered  packages/action/test/ac-discovery-action-none.test.ts::action: no coverage-file input and no candidate in the workspace › AC-14: coverage-file missing.info wins over a discoverable coverage/lcov.info, with no auto-discovered line | packages/action/test/ac-discovery-action-none.test.ts::action: no coverage-file input and no candidate in the workspace › AC-14: reports COVERAGE_FILE_MISSING naming the candidates, and fails the step only with threshold 80
  AC-15  unit  passed  delivered  packages/core/test/ac-discovery-examples-shape.test.ts::examples/workflows/: the shape of each example › AC-15: each example checks out with fetch-depth 0, has the permissions and concurrency, and runs pharn-ci with no with:
  AC-16  unit  passed  delivered  packages/core/test/ac-discovery-examples-runs.test.ts::examples/workflows/: each example's test command › AC-16: each example runs the command that writes its report to a discovery candidate
  AC-17  unit  passed  delivered  packages/core/test/ac-discovery-docs.test.ts::docs: coverage auto-discovery › AC-17: CHANGELOG.md has a line under Unreleased naming coverage auto-discovery | packages/core/test/ac-discovery-docs.test.ts::docs: coverage auto-discovery › AC-17: action.yml's coverage-file description says the path is auto-discovered when unset | packages/core/test/ac-discovery-docs.test.ts::docs: coverage auto-discovery › AC-17: docs/THREAT-MODEL.md names coverage auto-discovery and the test that covers it | packages/core/test/ac-discovery-docs.test.ts::docs: coverage auto-discovery › AC-17: the README Quick start and CLI sections mention auto-discovery and examples/workflows/
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
The prior run of this intent (`pharn/features/coverage-auto-discovery/`) stopped at the entry gates on a checkout that held another feature's uncommitted, already-merged files; this run started from the clean dd2a03b tree, where every entry gate was green. Its SPEC and PLAN were left untouched, and this run's AC tests use the `ac-discovery-*` names because the earlier AC-TESTS.md claims `ac-coverage-discovery-*`.
```

### learned

```text
The build replaced two existing test rows that asserted the old "no coverage file" stop (`packages/cli/test/main.test.ts`, `packages/action/test/run.test.ts`) with tests of the new not-found report. The build stage reports one Bash heredoc edit of `packages/core/src/index.ts` (inside the declared scope; the verify reconcile gate passed) and that it skipped the installed-skills catalogue and seam walk steps; both are noted in BUILD.md. The example workflows reference `pharn-dev/pharn-ci@v0.1.0`, which works only once a release containing this change is cut.
```

### next_steps

```text
A person reviews the `pharn-loop/coverage-auto-discovery-2` branch, then opens a PR whose description names the two replaced test rows and why (AGENTS.md rule 4), and deletes the abandoned `pharn/features/coverage-auto-discovery/` record if it is no longer wanted.
```
