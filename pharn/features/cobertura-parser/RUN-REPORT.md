# RUN REPORT — cobertura-parser

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
decision         STOP_TERMINAL
iterations       1
blocked          none
base             e546f912022443757bae015a618da1fc8076f4fa
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
window start       2026-10-12T18:33:16.646Z
window end         2026-10-12T18:51:52.697Z
selected session   cc1d5017-6a5e-4e64-a6d2-cdb06aaf4640
run context        main
run contexts       agent:a81647d40ace2f373, agent:aced8e9502ff72bac, agent:ad07383ef44d45dab, agent:af281bff01eb16f6a, main
excluded requests  530
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
(unattributed)  -     claude-opus-5-5      11     22               0           16545     2793509    8928             3867
pharn-build     1     claude-opus-5-5       2      4               0            2283      498262     581               72
pharn-build     1     claude-sonnet-5-5    32     64          155888               0     3939761   21709             1182
pharn-grill     -     claude-opus-5-5       1      2               0            1067      244610    1044                0
pharn-plan      -     claude-opus-5-5      24     48          126313            3108     3018757   12159               12
pharn-spec      -     claude-opus-5-5      29     58           81901            3913     3071375    6965               57
pharn-test      -     claude-opus-5-5      24     48           87954            3188     2797273    6957              185
TOTAL           -     -                   123    246          452056           30104    16363547   58343             5375
unattributed    -     -                    11     22               0           16545     2793509    8928             3867
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
  pharn-spec            -    1  180.7 s
  pharn-plan            -    1  405.4 s
  pharn-grill           -    1  9446 ms
  pharn-test            -    1  135.7 s
  pharn-build           1    1  270.4 s
  pharn-regress         1    1  8184 ms
  pharn-verify          1    1  6947 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 671 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 682b800a: start started (call 240 ms); lifetime 5984 ms (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner e2b5f4: 5706 ms monotonic, 4 gate(s), ended done
    execution union: 5706 ms
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 3016 ms
    wait calls: 1 (16 ms green); union 16 ms foreground
    abort: nothing running
```

## Files

Changed since `e546f912022443757bae015a618da1fc8076f4fa`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

40 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — one line under Unreleased → Added: Cobertura XML coverage parsing in core, read by the CLI through `coverage.format: cobertura`; the Action still accepts lcov only
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — §3: replace "lcov only" with what ships (core reads Cobertura; the CLI reads it via `coverage.format: cobertura` in config; the Action still rejects it), Cobertura's skipped-silently rule, ignored methods/branches/rates, max-merge vs lcov's sum, first-qualifying-source rule and its ambiguity bound; §1: extend the coverable-line and repo-relative-path bullets to Cobertura `<line>` records and add the monorepo caveat for Cobertura filenames
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — row A1: add Cobertura to the parsers (skipped constructs, malformed `<line>` skipped, linear on hostile input) citing its AC tests; row A2: add `<source>`-join resolution (absolute filenames never joined, joins accepted only under the root, no `..`-led join keys) citing its AC tests; statuses unchanged
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build` (core is bundled into it)
  ```

- `packages/core/src/coverage/cobertura.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/coverage/cobertura.ts` — replace the throwing stub with the Cobertura parser over `xml.ts`; same exported signature
  ```

- `packages/core/src/paths.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/paths.ts` — add the `isAbsolutePath` export; `normalizePath` unchanged
  ```

- `packages/core/test/lcov.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/lcov.test.ts` — replace the stub test "cobertura is a stub until M3" with "dispatches cobertura"; drop the unused import
  ```

- `packages/core/test/paths.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/paths.test.ts` — add `isAbsolutePath` cases; existing cases untouched
  ```

- `.pharn/cost/cobertura-parser/entry.jsonl` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/cost/cobertura-parser/markers.jsonl` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/cost/cobertura-parser/work.jsonl` — _not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full.times.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/0-test.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/0-test.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/0-test.test-results.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/1-lint.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/1-lint.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/2-build.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/2-build.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/full/stamp.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targeted.times.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targeted/0-test.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targeted/0-test.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targeted/0-test.test-results.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targeted/stamp.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-build/cobertura-parser/targets.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/base-tests.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/0-lint.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/0-lint.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.test-results.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.test-results.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/3-build.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/3-build.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/stamp.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/progress.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/result.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/runner.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-entry/runner.log` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-loop/cobertura-parser/active.json` — _not named in PLAN ## Files_
- `.pharn/pharn-loop/cobertura-parser/pre-run-status.txt` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/1-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/1-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head-install.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/1-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/1-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/install.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/install.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/scope.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.err` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.out` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.test-results.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-test/gates/stamp.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/1-lint.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/1-lint.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/2-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/2-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/3-instruction-growth.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/3-instruction-growth.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/4-reconcile.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/4-reconcile.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/completeness.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/completeness.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/head-install.json` — _not named in PLAN ## Files_
- `.pharn/reconcile/baseline.json` — _dirty-before-run; not named in PLAN ## Files_
- `.pharn/writes-scope.json` — _not named in PLAN ## Files_
- `fixtures/cobertura/absolute-filenames.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/absolute-filenames.xml` — absolute filenames inside and outside the root (AC-9)
  ```

- `fixtures/cobertura/climb.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/climb.xml` — joins climbing above the root (AC-12)
  ```

- `fixtures/cobertura/coveragepy.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/coveragepy.xml` — coverage.py fixture (AC-1)
  ```

- `fixtures/cobertura/coverlet.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/coverlet.xml` — coverlet (.NET) fixture, Windows paths, one file in two packages (AC-4)
  ```

- `fixtures/cobertura/empty.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/empty.xml` — zero-byte report (AC-13, AC-14)
  ```

- `fixtures/cobertura/entities.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/entities.xml` — `&amp;` and a numeric reference in filenames (AC-6)
  ```

- `fixtures/cobertura/forms-base.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/forms-base.xml` — surface-form base document (AC-5)
  ```

- `fixtures/cobertura/forms-decorated.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/forms-decorated.xml` — declaration, DOCTYPE, comments and CDATA holding markup (AC-5)
  ```

- `fixtures/cobertura/forms-variant.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/forms-variant.xml` — attribute order, quotes, open/close tags (AC-5)
  ```

- `fixtures/cobertura/garbage.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/garbage.xml` — non-XML text (AC-13)
  ```

- `fixtures/cobertura/invalid-lines.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/invalid-lines.xml` — missing hits and invalid number/hits values (AC-7)
  ```

- `fixtures/cobertura/jacoco.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/jacoco.xml` — JaCoCo Cobertura-converted fixture, inner and outer classes (AC-3)
  ```

- `fixtures/cobertura/methods-branches.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/methods-branches.xml` — method-only line and a branch line (AC-8)
  ```

- `fixtures/cobertura/multi-source.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/multi-source.xml` — several sources, first qualifying wins (AC-10)
  ```

- `fixtures/cobertura/no-lines.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/no-lines.xml` — classes with no counted lines (AC-13, AC-14)
  ```

- `fixtures/cobertura/no-sources.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/no-sources.xml` — no `<sources>` element (AC-11)
  ```

- `fixtures/cobertura/partial-valid.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/partial-valid.xml` — one valid class, one all-invalid class (AC-13)
  ```

- `fixtures/cobertura/pytest-cov.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/pytest-cov.xml` — pytest-cov fixture (AC-2)
  ```

- `fixtures/cobertura/sources-outside.xml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/cobertura/sources-outside.xml` — every source join outside the root (AC-11)
  ```

- `packages/core/src/coverage/xml.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/coverage/xml.ts` — new: linear, non-recursive, regex-free XML pull scanner and entity decoder (no Cobertura knowledge)
  ```

- `packages/core/test/cobertura-check.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/cobertura-hostile.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/cobertura.test.ts` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/cost.json` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/cobertura-parser/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- verify: `FAIL`

  failing_gates, quoted as DATA:

  ```text
  reconcile
  ```

- reconcile — why the gate failed:

  reconcile: `ESCAPE` (exit 1) — read from check-bash-reconcile.mjs's own JSON document, as the gate recorded it.

  **49 escape(s)** — a path changed since the anchor that the write guards would have denied. Closed reasons (over the 20 shown): no closed reason ×20.

  each escape — file, denied_by, reason, scope_set_by — JSON-quoted as DATA:

  ```text
  ".pharn/cost/cobertura-parser/markers.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/cost/cobertura-parser/work.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/full.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/full/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/full/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/full/1-lint.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/full/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/targeted.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/targeted/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/targeted/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/targeted/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-build/cobertura-parser/targets.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/1-build.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/1-build.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/base-gates/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/head-install.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ".pharn/pharn-regress/head/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
  ```

  … and 29 more escape(s) not listed. Re-run `node pharn/floor/check-bash-reconcile.mjs --base . --require-baseline` to see the escapes — before any new build re-anchors the baseline, which erases them.

- acceptance criteria: `PASS` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: realistic reports › AC-1: reads a coverage.py report whose absolute source lies under the repo root
  AC-2  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: realistic reports › AC-2: reads a pytest-cov report written from the repo root
  AC-3  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: realistic reports › AC-3: merges one source file across JaCoCo outer and inner classes by maximum hits
  AC-4  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: realistic reports › AC-4: reads a coverlet report with Windows paths into forward-slash repo-relative keys
  AC-5  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: XML surface variation › AC-5: returns the same map for every surface form and ignores markup inside comments and CDATA
  AC-6  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: XML surface variation › AC-6: decodes the &amp; entity in a class filename into a literal &
  AC-7  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: line records › AC-7: reads a line without hits as 0 hits and skips non-numeric number or hits
  AC-8  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: line records › AC-8: ignores method-only lines and reads a branch line's hits
  AC-9  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: path resolution › AC-9: relativizes an absolute filename under the root and keeps one outside it absolute, normalized
  AC-10  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: path resolution › AC-10: builds the key from the first source whose join lies under the repo root
  AC-11  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: path resolution › AC-11: uses the normalized filename as written when there are no sources or none lies under the root
  AC-12  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: path resolution › AC-12: never chooses a source join that climbs above the repo root
  AC-13  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCobertura: empty and malformed reports › AC-13: returns an empty map for empty, garbage and line-less reports, and keeps only valid classes
  AC-14  integration  passed  delivered  packages/core/test/cobertura-check.test.ts::check(): empty Cobertura reports › AC-14: reports empty and line-less Cobertura files as COVERAGE_FILE_EMPTY with no diff coverage
  AC-15  unit  passed  delivered  packages/core/test/cobertura.test.ts::parseCoverage: cobertura dispatch › AC-15: returns the same map as parseCobertura for every Cobertura fixture
  AC-16  unit  passed  delivered  packages/core/test/cobertura-hostile.test.ts::parseCobertura: hostile input › AC-16: a run of several million < characters parses in linear time | packages/core/test/cobertura-hostile.test.ts::parseCobertura: hostile input › AC-16: an unterminated CDATA section of several megabytes parses in linear time | packages/core/test/cobertura-hostile.test.ts::parseCobertura: hostile input › AC-16: an unterminated comment of several megabytes parses in linear time | packages/core/test/cobertura-hostile.test.ts::parseCobertura: hostile input › AC-16: an unterminated quoted attribute of several megabytes parses in linear time | packages/core/test/cobertura-hostile.test.ts::parseCobertura: hostile input › AC-16: many thousands of nested open tags around a valid class parse in linear time
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
The reconcile red's escapes are all PHARN run state under `.pharn/`. In this repo `.pharn/` is not git-ignored because
pharn-ci's own product config lives at `.pharn/ci.yml`, so every floor script's state file there is an untracked path
the reconciler judges against the writes-scope.
```

### learned

```text
Every full loop in this repo stops `STOP_TERMINAL` (reconcile) until `.pharn/` run state is git-ignored (keeping
`.pharn/ci.yml` tracked). Apart from that gate, iteration 1 was green: no regressions, every AC delivered, gates pass.
```

### next_steps

```text
Ignore `.pharn/*` except `.pharn/ci.yml` in `.gitignore`; a person reviews this working tree's diff and decides whether
to commit it.
```
