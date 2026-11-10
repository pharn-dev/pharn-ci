# RUN REPORT — ti17-always-true-matcher-2

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
base             12036e8c485a656eeb9a4a9beb869e51e37b7d80
command          /pharn-loop
skills_version   7.3.0
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
window start       2026-11-10T05:10:23.179Z
window end         2026-11-10T06:33:14.582Z
selected session   1a57ed19-2566-430f-bc96-23dbbdd34a84
run context        main
run contexts       agent:a434939217429db9d, agent:a5354e5edd7d760c0, agent:a7bfa26a3a310ec83, agent:af2e2782c430eae54, main
excluded requests  685
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
(unattributed)  -     claude-opus-5-5      11     22               0            6586     5047286    4076              129
pharn-build     1     claude-opus-5-5       8     18             188            4595     3476931    2943              452
pharn-build     1     claude-sonnet-5-5   103    206          445324               0    32125016  108016            10740
pharn-grill     -     claude-opus-5-5       2      4             189             986      638749    2113                0
pharn-plan      -     claude-fable-5-2      1      2             206               0      188315    1404                0
pharn-plan      -     claude-opus-5-5      32     64          148434            3242     4870301   34646             4767
pharn-regress   1     claude-opus-5-5       2      4               0            3181      929765     449               46
pharn-regress   1     claude-sonnet-5-5     1      2             230               0      445324    1497                0
pharn-spec      -     claude-fable-5-2     36     72          188315               0     4830551   32470             8346
pharn-spec      -     claude-opus-5-5       2      4               0            6546      885716    6055                0
pharn-test      -     claude-opus-5-5      51    102          211079             989     9684226   58876             3629
pharn-verify    1     claude-opus-5-5       1      2               0             279      466874     176                0
TOTAL           -     -                   250    502          993965           26404    63589054  252721            28109
unattributed    -     -                    11     22               0            6586     5047286    4076              129
```

**Always-loaded instruction set — an ESTIMATE, not a measurement.**

~2039 tokens (8153 bytes over 2 file(s)), taken once at the run's start by `pharn/floor/check-instruction-files.mjs --report`. The figure is bytes / 4 (`pharn/LIMITS.md §1c`) over that checker's
model of what Claude Code loads into every context (`pharn/LIMITS.md §3e`) — a model, not a measurement of the loader.
By that model those files ride in the prefix of the run's requests, so they would already sit inside the input
and cache counts above — never add this figure to them.

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
  pharn-spec            -    1  368.2 s
  pharn-plan            -    1  372.0 s
  pharn-grill           -    1  12.0 s
  pharn-test            -    1  647.5 s
  pharn-build           1    1  2950.6 s
  pharn-regress         1    1  326.1 s
  pharn-verify          1    1  208.9 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 801 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 38d1ad4d: start started (call 1169 ms); lifetime 548.0 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner dd3afb: 546.7 s monotonic, 4 gate(s), ended done
    execution union: 546.7 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 534.3 s
    wait calls: 1 (36 ms green); union 35 ms foreground
    abort: nothing running
```

## Files

Changed since `12036e8c485a656eeb9a4a9beb869e51e37b7d80`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased Added and Changed lines
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — TI17 row, signal list, never-block list, Skylos paragraph, message-code row, Roadmap line
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — caught/missed lists, `### What TI17 misses`, Python parity row
  ```

- `docs/PRECISION.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/PRECISION.md` — §3 always-true-matcher row and totals
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — a residual for the TI17 scan of added test-file lines and its bounds
  ```

- `fixtures/policy/invalid/unknown-ti.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/policy/invalid/unknown-ti.json` — the unknown signal key moves from TI17 to TI18
  ```

- `fixtures/policy/invalid/unknown-ti.paths`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/policy/invalid/unknown-ti.paths` — the recorded error path moves from TI17 to TI18
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/action/test/ac-accept-signoff-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-accept-signoff-regression.test.ts` — re-pin: `ADDED_AFTER_BASE` gains every TI17 fixture; count and digest unchanged
  ```

- `packages/action/test/ac-pyparity2-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-pyparity2-unchanged.test.ts` — re-pin: the walker's sha256, TI17 codes, schema helper, 8 of 9, unknown-ti allowance
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — run `detectTI17` beside `detectTI16`
  ```

- `packages/core/src/fix/table.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/fix/table.ts` — TI17 fix entry (`restore-assertion`) and its message mapping
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export `detectTI17`
  ```

- `packages/core/src/policy/limits.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/limits.ts` — `TI17` in `POLICY_SIGNAL_IDS`
  ```

- `packages/core/src/policy/types.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/types.ts` — `TI17` in `PolicySignalId`
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — TI17 hint and hint id
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — `TEST_INTEGRITY_TI17` code, its signal message, TI17 in the id comments
  ```

- `packages/core/src/signals/signalFiles.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/signalFiles.ts` — doc comment names TI17
  ```

- `packages/core/test/ac-fix-hints-mapping.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-fix-hints-mapping.test.ts` — re-pin: the kind tables gain TI17 and TEST_INTEGRITY_TI17
  ```

- `packages/core/test/ac-fix-hints-pins.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-fix-hints-pins.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-name-only-suite.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-name-only-suite.test.ts` — re-pin: the working-tree "8 of 9" and "8/9" reads
  ```

- `packages/core/test/ac-p07-schema-hints.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p07-schema-hints.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-p07-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p07-unchanged.test.ts` — re-pin: accept the new TI17 fixtures and the unknown-ti move
  ```

- `packages/core/test/ac-p11-schema-hints.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-schema-hints.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-p11-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-unchanged.test.ts` — re-pin: accept the new TI17 fixtures and the unknown-ti move
  ```

- `packages/core/test/ac-polrules-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-docs.test.ts` — re-pin only if its pinned policy-schema text moves: read through the policy helper
  ```

- `packages/core/test/ac-precision-v030-readme.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-precision-v030-readme.test.ts` — re-pin: the never-block sentence names TI17
  ```

- `packages/core/test/ac-precision-v030-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-precision-v030-schema.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-py-index-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-py-index-docs.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-pyparity2-limits.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-pyparity2-limits.test.ts` — re-pin: the parity rows are TI01 to TI17
  ```

- `packages/core/test/ac-release030-readme-signals.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-release030-readme-signals.test.ts` — re-pin: seventeen ids, the TI17 row, the never-block list, the parity rows
  ```

- `packages/core/test/ac-report-v2-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-report-v2-schema.test.ts` — re-pin: the rejected signal id is TI18
  ```

- `packages/core/test/ac-secrets-repin.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-secrets-repin.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-signal-precision-ti06-weakening.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-signal-precision-ti06-weakening.test.ts` — re-pin: eight caught
  ```

- `packages/core/test/ac-skylos-nine-misses.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-nine-misses.test.ts` — re-pin: its miss assertion becomes a catch assertion
  ```

- `packages/core/test/ac-skylos-nine-table.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-nine-table.test.ts` — re-pin: always-true-matcher caught by TI17, 8/9
  ```

- `packages/core/test/ac-skylos-pytest-limits.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-pytest-limits.test.ts` — re-pin: the LIMITS text it quotes
  ```

- `packages/core/test/ac-skylos-pytest-notes.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-pytest-notes.test.ts` — re-pin: the PRECISION notes (mock.ANY caught by TI17)
  ```

- `packages/core/test/ac-skylos-pytest-readme-changelog.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-pytest-readme-changelog.test.ts` — re-pin: the README paragraph
  ```

- `packages/core/test/ac-skylos-pytest-ti17.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-skylos-pytest-ti17.test.ts` — re-pin: the proposal becomes "What TI17 misses"
  ```

- `packages/core/test/ac-test-sources-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-test-sources-docs.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-ti0205-skylos.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti0205-skylos.test.ts` — re-pin: the Skylos count
  ```

- `packages/core/test/ac-ti06-ti12-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti06-ti12-docs.test.ts` — re-pin: the Skylos count in the docs
  ```

- `packages/core/test/ac-ti06-ti12-skylos.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti06-ti12-skylos.test.ts` — re-pin: the Skylos count
  ```

- `packages/core/test/ac-ti06-ti12-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti06-ti12-unchanged.test.ts` — re-pin: the Skylos count literals, file digests and renamed titles
  ```

- `packages/core/test/ac-ti07-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti07-schema.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-ti07-skylos.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti07-skylos.test.ts` — re-pin: eight caught, one missed
  ```

- `packages/core/test/ac-ti081516-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti081516-docs.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-ti09y-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti09y-regression.test.ts` — re-pin: the walker's sha256 and the count-test literals
  ```

- `packages/core/test/ac-ti09y-skylos.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti09y-skylos.test.ts` — re-pin: the Skylos count
  ```

- `packages/core/test/ac-upload-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-upload-schema.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/core/test/ac-v020-limits.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-v020-limits.test.ts` — re-pin: the missed pair is only hard-coded-answer
  ```

- `packages/core/test/ac-v020-readme.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-v020-readme.test.ts` — re-pin: "8 of 9"
  ```

- `packages/core/test/ac-v020-skylos-count.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-v020-skylos-count.test.ts` — re-pin: the Skylos count
  ```

- `packages/core/test/docs-schema-levels.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/docs-schema-levels.test.ts` — re-pin: schema read through the TI17 helper first
  ```

- `packages/node-io/test/ac-skylos-pytest-misses.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/test/ac-skylos-pytest-misses.test.ts` — re-pin: always-true-matcher-any is caught by TI17
  ```

- `packages/node-io/test/ac-skylos-pytest-table.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/test/ac-skylos-pytest-table.test.ts` — re-pin: the expected row, two ids per cell, vitest 8 of 9
  ```

- `packages/node-io/test/ac-skylos-pytest-warn.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/test/ac-skylos-pytest-warn.test.ts` — re-pin: always-true-matcher gives TI06 and TI17
  ```

- `schema/policy.v1.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/policy.v1.json` — `TI17` severity key; descriptions name TI01-TI17 and TI18 as the error example
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — signal id pattern accepts TI17; known codes name `TEST_INTEGRITY_TI17`
  ```

- `fixtures/test-integrity/TI17/pass-helper-compares.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-compares.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-helper-in-condition.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-in-condition.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-helper-mixed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-mixed.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-helper-source-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-source-file.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-helper-undefined.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-undefined.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-helper-unused.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-helper-unused.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-compares.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-compares.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-mixed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-mixed.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-not-called.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-not-called.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-removed-only.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-removed-only.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-source-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-source-file.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-undefined.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-undefined.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-matcher-variable.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-matcher-variable.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-called-with.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-called-with.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-go-test.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-go-test.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-nested.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-nested.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-new-test.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-new-test.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-python-called-once-with.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-python-called-once-with.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-python-called-with.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-python-called-with.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-python-nested.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-python-nested.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-python-new-test.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-python-new-test.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-python-reindented.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-python-reindented.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/pass-wildcard-reindented.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/pass-wildcard-reindented.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-helper-pytest.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-helper-pytest.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-helper-unittest.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-helper-unittest.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-matcher-arrow.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-matcher-arrow.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-matcher-method-js.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-matcher-method-js.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-matcher-method-ts.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-matcher-method-ts.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-assertequal.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-assertequal.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-mock-any.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-mock-any.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-python-any.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-python-any.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-tobe.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-tobe.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-toequal.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-toequal.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-tostrictequal.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-tostrictequal.diff` — new fixture
  ```

- `fixtures/test-integrity/TI17/warn-wildcard-unittest-mock-any.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI17/warn-wildcard-unittest-mock-any.diff` — new fixture
  ```

- `packages/core/src/signals/alwaysTrue.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/alwaysTrue.ts` — new: always-true matcher (JS/TS) and helper (Python) definition and use scanners
  ```

- `packages/core/src/signals/ti17.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti17.ts` — new: `detectTI17`, one warn signal per JS/TS or Python test file
  ```

- `packages/core/src/signals/wildcardExpected.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/wildcardExpected.ts` — new: wildcard expected-value scanner with per-hunk pairing
  ```

- `packages/core/test/ac-ti17-benchmark-vitest.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-changelog-threat.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-fix-hints.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-fixtures.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-growth.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-helper-pass.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-helper-warn.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-limits-readme.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-matcher-method.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-matcher-pass.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-modes.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-not-test-files.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-one-per-file.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-policy-key.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-policy-severity.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-schemas.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-signoff-pins.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-wildcard-js-pass.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-wildcard-js-warn.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-wildcard-py-pass.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti17-wildcard-py-warn.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ti17-schema.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ti17-schema.ts` — new test helper: takes the TI17 schema edits out for byte-compare pins
  ```

- `packages/node-io/test/ac-ti17-benchmark-pytest-any.test.ts` — _not named in PLAN ## Files_
- `packages/node-io/test/ac-ti17-benchmark-pytest-helper.test.ts` — _not named in PLAN ## Files_
- `packages/node-io/test/ac-ti17-skylos-count.test.ts` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/cost.json` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/ti17-always-true-matcher-2/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- isolation: HOST (host execution accepted by operator)

- verify: `PASS`

  failing_gates, quoted as DATA:

  ```text
  (none)
  ```

- acceptance criteria: `PASS` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  integration  passed  delivered  packages/core/test/ac-ti17-benchmark-vitest.test.ts::TI17 on the vitest Skylos case always-true-matcher › AC-1: the unchanged benchmark diff in mode block gives a schema-valid report with exactly one TI17 warn signal at src/cart.test.ts:9 and one TEST_INTEGRITY_TI17 warn message
  AC-2  integration  passed  delivered  packages/node-io/test/ac-ti17-benchmark-pytest-any.test.ts::TI17 on the pytest Skylos variant always-true-matcher-any › AC-2: with the real Python index and from the diff alone, the report holds exactly one test-integrity signal, TI17 warn at tests/test_cart.py:10
  AC-3  integration  passed  delivered  packages/node-io/test/ac-ti17-benchmark-pytest-helper.test.ts::TI17 on the pytest Skylos case always-true-matcher › AC-3: with the real Python index the report holds the TI06 warn signal of the base commit, unchanged, and one more signal, TI17 warn at tests/test_cart.py:13
  AC-4  integration  passed  delivered  packages/core/test/ac-ti17-matcher-method.test.ts::TI17: an always-true matcher written as a method › AC-4: a jest .test.js and a vitest .test.ts that each add a multi-line method matcher whose only pass is true, and a call to it, give one TI17 warn signal per file at the line of the added assertion
  AC-5  integration  passed  delivered  packages/core/test/ac-ti17-matcher-pass.test.ts::TI17: matchers that are not always true, or not used › AC-5: a compared pass, a mixed pass, an uncalled matcher, a call to an undefined matcher and a pass read from a variable give no TI17 signal and no TEST_INTEGRITY_TI17 message
  AC-6  integration  passed  delivered  packages/core/test/ac-ti17-helper-warn.test.ts::TI17: a Python helper that always returns True, asserted on › AC-6: a pytest assert and a unittest assertTrue on a helper whose every return is True give one TI17 warn signal per file at the line of the first such added assertion, from the diff alone
  AC-7  integration  passed  delivered  packages/core/test/ac-ti17-helper-pass.test.ts::TI17: Python helpers that are not always True, or not the whole assertion › AC-7: a compared return, a mixed return, an unused helper, an assert on an undefined helper and a helper inside a larger condition give no TI17 signal
  AC-8  integration  passed  delivered  packages/core/test/ac-ti17-wildcard-js-warn.test.ts::TI17: a wildcard in place of a concrete expected value (JS/TS) › AC-8: toBe(5) replaced by toBe(expect.anything()) in the same hunk gives one TI17 warn signal at the added line, from the diff alone | packages/core/test/ac-ti17-wildcard-js-warn.test.ts::TI17: a wildcard in place of a concrete expected value (JS/TS) › AC-8: toEqual(5) replaced by toEqual(expect.anything()) in the same hunk gives one TI17 warn signal at the added line, from the diff alone | packages/core/test/ac-ti17-wildcard-js-warn.test.ts::TI17: a wildcard in place of a concrete expected value (JS/TS) › AC-8: toStrictEqual(5) replaced by toStrictEqual(expect.anything()) in the same hunk gives one TI17 warn signal at the added line, from the diff alone
  AC-9  integration  passed  delivered  packages/core/test/ac-ti17-wildcard-js-pass.test.ts::TI17: wildcards that replace no concrete expected value (JS/TS) › AC-9: a wildcard argument of a call matcher, a nested wildcard, a wildcard in a new test and a re-indented wildcard line give no TI17 signal
  AC-10  integration  passed  delivered  packages/core/test/ac-ti17-wildcard-py-warn.test.ts::TI17: a wildcard in place of a concrete expected value (Python) › AC-10: == ANY in place of 5, in the same hunk, gives one TI17 warn signal at the added line, from the diff alone | packages/core/test/ac-ti17-wildcard-py-warn.test.ts::TI17: a wildcard in place of a concrete expected value (Python) › AC-10: == mock.ANY in place of 5, in the same hunk, gives one TI17 warn signal at the added line, from the diff alone | packages/core/test/ac-ti17-wildcard-py-warn.test.ts::TI17: a wildcard in place of a concrete expected value (Python) › AC-10: == unittest.mock.ANY in place of 5, in the same hunk, gives one TI17 warn signal at the added line, from the diff alone | packages/core/test/ac-ti17-wildcard-py-warn.test.ts::TI17: a wildcard in place of a concrete expected value (Python) › AC-10: assertEqual(..., ANY) in a unittest.TestCase method in place of 5, in the same hunk, gives one TI17 warn signal at the added line, from the diff alone
  AC-11  integration  passed  delivered  packages/core/test/ac-ti17-wildcard-py-pass.test.ts::TI17: wildcards that replace no concrete expected value (Python) › AC-11: ANY in a call assertion's arguments, a nested ANY, == ANY in a new test and a re-indented == ANY line give no TI17 signal
  AC-12  integration  passed  delivered  packages/core/test/ac-ti17-not-test-files.test.ts::TI17: lines outside JS/TS and Python test files, and removed lines › AC-12: the always-true lines in non-test files, the wildcard lines in a Go test file and a diff that only removes an always-true matcher give no TI17 signal
  AC-13  integration  passed  delivered  packages/core/test/ac-ti17-one-per-file.test.ts::TI17: one finding per test file › AC-13: four always-true assertions in one test file and one in another give exactly one TI17 signal per file, at the lowest such line, ordered by path, with a short fixed detail that counts them and holds no text of the diff; the one TEST_INTEGRITY_TI17 message names both paths
  AC-14  integration  passed  delivered  packages/core/test/ac-ti17-modes.test.ts::TI17 in the test-integrity modes › AC-14: in modes block and warn the TI17 signal and its message are warn and the verdict is warn; in mode off there is no TI17 signal, no TEST_INTEGRITY_TI17 message and the verdict is pass
  AC-15  integration  passed  delivered  packages/core/test/ac-ti17-policy-severity.test.ts::TI17 severity from an org policy › AC-15: an app policy TI17 block fails the check and off drops the finding; a policy file's info is ignored with POLICY_OVERRIDE_IGNORED naming test_integrity.signals.TI17; mode warn caps an app block at warn
  AC-16  unit  passed  delivered  packages/core/test/ac-ti17-policy-key.test.ts::the TI17 key of an org policy › AC-16: a policy with test_integrity.signals.TI17 is valid for core and the schema, one with TI18 is invalid with an error at its path that repeats no value, and the unknown-ti fixture names TI18
  AC-17  unit  passed  delivered  packages/core/test/ac-ti17-schemas.test.ts::schema/report.v2.json and schema/policy.v1.json accept TI17 and change nothing else › AC-17: a TI17 signal is valid and TI18 is not, the known codes name TEST_INTEGRITY_TI17, the policy has a TI17 severity key and no longer calls TI17 an error, and with those edits out both files equal the base commit byte for byte
  AC-18  unit  passed  delivered  packages/core/test/ac-ti17-fix-hints.test.ts::fix hints for TI17 › AC-18: the TI17 signal and the TEST_INTEGRITY_TI17 message each carry a restore-assertion fix with one fixed sentence of at most 200 characters, the signal's target is its path:line, and the fix kinds are the same eight
  AC-19  unit  passed  delivered  packages/core/test/ac-ti17-render.test.ts::renderMarkdown(): TI17 in the Test integrity section › AC-19: the comment lists TI17 with src/cart.test.ts:9 and its detail and a hint to restore the assertion that can fail or say in the PR why the test checks less now, and a TI17 line follows a TI16 line of the same severity
  AC-20  unit  passed  delivered  packages/core/test/ac-ti17-growth.test.ts::TI17: a bounded scan of hostile test-file lines › AC-20: 5000 hostile lines of 400 characters in a .test.ts and in a test_*.py file give a schema-valid report in under 5 seconds, with at most one TI17 signal per file
  AC-21  integration  passed  delivered  packages/node-io/test/ac-ti17-skylos-count.test.ts::Skylos nine with TI17: vitest 8 of 9 and pytest 8 of 9, and the documents say so › AC-21: the nine vitest and nine pytest cases (with the -any and -aliased variants) through check() catch 8 of 9 each, the only miss of each is hard-coded-answer, and README, PRECISION and LIMITS state exactly those results
  AC-22  unit  passed  delivered  packages/core/test/ac-ti17-limits-readme.test.ts::docs/LIMITS.md and README.md describe TI17 › AC-22: LIMITS has a What TI17 misses subsection in place of the proposal that says TI17 warns and never blocks by default and names each miss; the parity and signal tables have a TI17 row; the message-code table has TEST_INTEGRITY_TI17; the Roadmap links #test-integrity and no longer names the always-passing matcher
  AC-23  unit  passed  delivered  packages/core/test/ac-ti17-changelog-threat.test.ts::CHANGELOG.md and docs/THREAT-MODEL.md record TI17 › AC-23: Unreleased names TI17 and TEST_INTEGRITY_TI17 under Added and, under Changed, the pass to warn move and the new schema id and policy key, with no new version heading; the threat model names TI17's scan of added test-file lines with linear time and the kept-text caps
  AC-24  integration  passed  delivered  packages/core/test/ac-ti17-fixtures.test.ts::the TI17 fixtures, and the benchmark left as it was › AC-24: every file under the Skylos benchmark is byte-identical to the base commit, there are no always-true-matcher sources, and fixtures/test-integrity/TI17/ holds a warn and a pass case per detection, each giving a TI17 signal for warn cases only
  AC-25  unit  passed  delivered  packages/core/test/ac-ti17-signoff-pins.test.ts::the fixture walker accepts the TI17 fixtures and keeps every earlier pin › AC-25: the walker's ADDED_AFTER_BASE holds every TI17 fixture and every base entry, BEFORE_COUNT (216) and BEFORE_DIGEST keep their base literals, and both sha256 pins of the walker equal its sha256 at HEAD
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
Run 1 stopped because `packages/action/test/ac-accept-signoff-regression.test.ts`, which walks every
`fixtures/test-integrity/` directory, was outside its plan's `## Files`. This run's plan declared it; the TI17
fixtures were added to its `ADDED_AFTER_BASE` set with `BEFORE_COUNT` and `BEFORE_DIGEST` unchanged, and its sha256
was refreshed in `ac-ti09y-regression.test.ts` and `ac-pyparity2-unchanged.test.ts` (AC-25).
```

### learned

```text
A sweep for tests that pin today's behaviour has to include tests that enumerate a whole fixture directory, not only
tests that name an id or a count. The build agent reported host load averages of 80 to 108 from other processes,
which made vitest's 5 s timeouts fire until the load dropped.
```

### next_steps

```text
A person reviews branch `pharn-loop/ti17-always-true-matcher-2`, then pushes it and opens the pull request; its body
lists every re-pinned test with its reason (BUILD.md) and the line "pharn-starter must vendor schema/ and deploy
before this is released". Run 1's stash can be dropped once this merges.
```
