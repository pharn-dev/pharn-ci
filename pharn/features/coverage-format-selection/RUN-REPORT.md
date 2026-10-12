# RUN REPORT — coverage-format-selection

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
base             fb152902b9156bb94a830de2102a29e5901dcc06
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
window start       2026-10-12T19:05:56.146Z
window end         2026-10-12T19:31:03.343Z
selected session   cc1d5017-6a5e-4e64-a6d2-cdb06aaf4640
run context        agent:add15f557eb96eec6
run contexts       agent:a4b9d4e102c3fdae4, agent:a8ba9698e62b656e6, agent:ad5cc3ca19b08e768, agent:ad8d5c536669d3fec, agent:add15f557eb96eec6
excluded requests  987
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
(unattributed)  -     claude-opus-5-5      22     44           44139               0     2781629    1748               97
pharn-build     1     claude-opus-5-5       2      4            2369               0      240154      20                0
pharn-build     1     claude-sonnet-5-5    48     96          140156               0     6717150   20805              428
pharn-grill     -     claude-opus-5-5       6     12           11467               0      676399     711                0
pharn-plan      -     claude-opus-5-5      43     86          247561               0     5931118   12977             1447
pharn-spec      -     claude-opus-5-5      27     54          113953               0     2883165     364                0
pharn-test      -     claude-opus-5-5      49     98          229457               0     6600061   20656             3563
TOTAL           -     -                   197    394          789102               0    25829676   57281             5535
unattributed    -     -                    22     44           44139               0     2781629    1748               97
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
  pharn-spec            -    1  229.2 s
  pharn-plan            -    1  450.1 s
  pharn-grill           -    1  21.0 s
  pharn-test            -    1  439.0 s
  pharn-build           1    1  279.6 s
  pharn-regress         1    1  8397 ms
  pharn-verify          1    1  4512 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 787 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 4733775a: start started (call 427 ms); lifetime 5205 ms (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 7debf0: 4737 ms monotonic, 4 gate(s), ended done
    execution union: 4737 ms
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 1 (87 ms green); union 87 ms foreground
    abort: nothing running
```

## Files

Changed since `fb152902b9156bb94a830de2102a29e5901dcc06`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — under Unreleased: rewrite the Cobertura line (the Action now accepts it too); add lines for format selection (`coverage-format` input, `--coverage-format`, `coverage.format`), the `auto` default, `COVERAGE_FORMAT_UNSUPPORTED`, and the optional `diffCoverage.format` report field
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — "What pharn-ci is" names lcov and Cobertura XML (Clover, JaCoCo native XML not supported); Action reference `coverage-format` row (`lcov`, `cobertura`, `auto`; default `auto`); CLI usage block and a `--coverage-format` bullet; config example `format: auto` with a comment naming the three values; `COVERAGE_FORMAT_UNSUPPORTED` row in the codes table; the architecture diagram's "lcov file" label and the "lcov-producing test run" sentence widened to Cobertura; roadmap line "Cobertura (and more coverage formats)" becomes "More coverage formats (Clover, JaCoCo native XML)"; quick start unchanged
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — `coverage-format` description: `lcov`, `cobertura` or `auto`, default `auto` (no `default:` key)
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — §3 only: the first bullet becomes lcov and Cobertura everywhere, selectable as `lcov`/`cobertura`/`auto` (default `auto`); a new bullet with the detection rule (first 1 KiB after a BOM, skipped prolog, `<coverage` root, `TN:`/`SF:`, the Clover rule, a root start tag that does not end within 1 KiB is unknown) and what unknown means (`COVERAGE_FORMAT_UNSUPPORTED`; explicit `cobertura` on Clover or JaCoCo native is `COVERAGE_FILE_EMPTY`); the "Action still rejects cobertura" text removed
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — row A1: auto-detection reads only the first 1 KiB of the untrusted file, reuses the regex-free scanner, never throws and is linear on hostile text, citing the AC-6 and AC-4/AC-5 tests; row E1: an unrecognized format is `COVERAGE_FORMAT_UNSUPPORTED`, error with a threshold, citing the AC-7 test; statuses unchanged
  ```

- `fixtures/golden/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.json` — regenerated: gains only `"format": "lcov"` in `diffCoverage`
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build`
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — accept `lcov`/`cobertura`/`auto`, `auto` default, one info format line, new rejection message
  ```

- `packages/action/test/run.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/run.test.ts` — replace the `cobertura`-is-rejected row with a `clover`-is-rejected row
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — `--coverage-format` flag, `auto` default, one stderr format line, help text
  ```

- `packages/cli/test/main.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/main.test.ts` — two expectations updated to the new output (stderr format line; `format` in the end-to-end `diffCoverage`)
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — format selection, auto-detection, `coverage-format-unsupported`, passes `coverageFormat` to the report
  ```

- `packages/core/src/config.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/config.ts` — `coverage.format` accepts `lcov`, `cobertura`, `auto`; add `isCoverageFormatSelection`; error names all three
  ```

- `packages/core/src/coverage/types.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/coverage/types.ts` — add `CoverageFormatSelection` and `COVERAGE_FORMAT_SELECTIONS`
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export the new functions, types and constants
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — `COVERAGE_FORMAT_UNSUPPORTED` code and message, optional `diffCoverage.format` (first key), new missing reason
  ```

- `schema/report.v1.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v1.json` — optional `diffCoverage.format` enum `lcov`/`cobertura`; document `COVERAGE_FORMAT_UNSUPPORTED`
  ```

- `fixtures/cobertura/clover.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/clover.xml` — new: Clover look-alike fixture
  ```

- `fixtures/cobertura/jacoco-native.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/jacoco-native.xml` — new: JaCoCo native XML fixture
  ```

- `fixtures/golden-cobertura/coverage.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/coverage.xml` — new: Cobertura translation of the golden lcov file
  ```

- `fixtures/golden-cobertura/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/files.txt` — new: copy of the golden files list
  ```

- `fixtures/golden-cobertura/pr.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/pr.diff` — new: copy of the golden diff
  ```

- `fixtures/golden-cobertura/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.json` — new: generated golden report (AC-13 snapshot)
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — new: generated golden markdown (AC-13 snapshot)
  ```

- `packages/action/test/ac-coverage-format.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-coverage-format.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/coverage/detect.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/coverage/detect.ts` — new: `detectCoverageFormat`, `chooseCoverageFormat`, `coverageChoiceLine` over the first 1 KiB, reusing `scanXml`
  ```

- `packages/core/test/ac-format-check.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-format-config.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-format-detect.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-format-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-format-schema.test.ts` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/cost.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/coverage-format-selection/verify-report.json` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: recognized reports › AC-1: detects every Cobertura fixture as cobertura
  AC-2  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: recognized reports › AC-2: detects every lcov fixture and the golden coverage.info as lcov
  AC-3  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: recognized reports › AC-3: detects both formats through a byte-order mark, leading whitespace, CRLF and an XML prolog
  AC-4  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: look-alikes and unknown text › AC-4: does not take Clover look-alikes for Cobertura or lcov
  AC-5  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: look-alikes and unknown text › AC-5: does not take JaCoCo native XML, garbage, <coverageReport> or a root past 1 KiB for a known format
  AC-6  unit  passed  delivered  packages/core/test/ac-format-detect.test.ts::detectCoverageFormat: look-alikes and unknown text › AC-6: returns quickly, without throwing, on several megabytes of hostile text
  AC-7  integration  passed  delivered  packages/core/test/ac-format-check.test.ts::check(): coverage format selection › AC-7: reports Clover and JaCoCo native XML under auto as COVERAGE_FORMAT_UNSUPPORTED
  AC-8  integration  passed  delivered  packages/core/test/ac-format-check.test.ts::check(): coverage format selection › AC-8: reports empty text, a BOM with whitespace and <coverage/> under auto as COVERAGE_FILE_EMPTY
  AC-9  integration  passed  delivered  packages/core/test/ac-format-check.test.ts::check(): coverage format selection › AC-9: gives the same report for the golden lcov inputs under auto and lcov, with diffCoverage.format lcov
  AC-10  integration  passed  delivered  packages/core/test/ac-format-check.test.ts::check(): coverage format selection › AC-10: gives the same report for a Cobertura fixture under auto and cobertura, with diffCoverage.format cobertura
  AC-11  integration  passed  delivered  packages/core/test/ac-format-check.test.ts::check(): coverage format selection › AC-11: an explicit format skips detection, so it never yields COVERAGE_FORMAT_UNSUPPORTED
  AC-12  unit  passed  delivered  packages/core/test/ac-format-schema.test.ts::schema/report.v1.json: diffCoverage.format and COVERAGE_FORMAT_UNSUPPORTED › AC-12: accepts the lcov, cobertura and absent formats and the new code, and rejects clover
  AC-13  integration  passed  delivered  packages/core/test/ac-format-golden.test.ts::golden reports and the coverage format › AC-13: the golden Cobertura inputs give the expected report and markdown
  AC-14  integration  passed  delivered  packages/core/test/ac-format-golden.test.ts::golden reports and the coverage format › AC-14: the lcov golden markdown is unchanged and its JSON gains only diffCoverage.format lcov
  AC-15  unit  passed  delivered  packages/core/test/ac-format-config.test.ts::parseConfig: coverage.format › AC-15: accepts lcov, cobertura and auto, and rejects clover naming the three accepted values
  AC-16  integration  passed  delivered  packages/cli/test/ac-coverage-format.test.ts::pharn-ci check --coverage-format › AC-16: auto-detects the golden Cobertura file and logs one format line on stderr
  AC-17  integration  passed  delivered  packages/cli/test/ac-coverage-format.test.ts::pharn-ci check --coverage-format › AC-17: an explicit format from the flag or the config is logged as configured, the flag winning
  AC-18  integration  passed  delivered  packages/cli/test/ac-coverage-format.test.ts::pharn-ci check --coverage-format › AC-18: stdout carries only the JSON report, and an unknown --coverage-format exits 2 naming the value
  AC-19  integration  passed  delivered  packages/action/test/ac-coverage-format.test.ts::action: coverage-format input › AC-19: reads a Cobertura file with coverage-format cobertura and with no format at all
  AC-20  integration  passed  delivered  packages/action/test/ac-coverage-format.test.ts::action: coverage-format input › AC-20: fails on coverage-format clover, and fails the verdict on a Clover file under auto
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
The build reused the existing regex-free `scanXml` for detection instead of adding a second XML reader. The
Action's `coverage-format` input was left without a `default:` key in `action.yml` so that `coverage.format` in the
config file can still take effect; the `auto` default is stated in the description and applied in code.
```

### learned

```text
The old Action test row asserting that `cobertura` is rejected tested behaviour this change removes on purpose; it was
replaced by a row asserting that an unknown value (`clover`) is rejected, and AC-19 covers Cobertura acceptance. The
golden `fixtures/golden/report.json` changed by exactly one line (`"format": "lcov"`); `report.md` is unchanged. The
build stage reported (DATA) that it first edited `docs/THREAT-MODEL.md` through a Bash script, then reverted and redid
the edit with the Edit tool; verify's `reconcile` gate exited 0.
```

### next_steps

```text
A person reviews the branch `pharn-loop/coverage-format-selection` against the base `fb15290`, including the
`action.yml` no-`default:` choice and the replaced Action test row, before opening a PR.
```
