# RUN REPORT — ti14-ti11-ci-config-signals

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
base             54804ba8c6e67f6bb757a97a04c1691431cd2c90
command          /pharn-loop
skills_version   6.72.2
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
window start       2026-10-25T01:00:15.806Z
window end         2026-10-25T01:16:54.750Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       main
excluded requests  480
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
(unattributed)  -     claude-sonnet-5-5    10     20               0           23673     3791803    4421              701
pharn-build     1     claude-sonnet-5-5    33     66               0           78068    13487682   46853            13482
pharn-grill     -     claude-sonnet-5-5     3      6               0           10992      869627    1301                0
pharn-plan      -     claude-sonnet-5-5    13     26               0           44228     3447385   18138             7497
pharn-spec      -     claude-sonnet-5-5     9     18               0           31543     2060887   11212              813
pharn-test      -     claude-sonnet-5-5    21     42               0           62345     7077068   44263            13170
TOTAL           -     -                    89    178               0          250849    30734452  126188            35663
unattributed    -     -                    10     20               0           23673     3791803    4421              701
```

**Always-loaded instruction set — an ESTIMATE, not a measurement.**

~1491 tokens (5963 bytes over 2 file(s)), taken once at the run's start by `pharn/floor/check-instruction-files.mjs --report`. The figure is bytes / 4 (`LIMITS.md §1c`) over that checker's
model of what Claude Code loads into every context (`LIMITS.md §3e`) — a model, not a measurement of the loader.
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
  pharn-spec            -    1  89.9 s
  pharn-plan            -    1  137.5 s
  pharn-grill           -    1  12.5 s
  pharn-test            -    1  286.9 s
  pharn-build           1    1  363.2 s
  pharn-regress         1    1  28.6 s
  pharn-verify          1    1  23.8 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 842 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 842b31f7: start started (call 721 ms); lifetime 80.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 59315a: 79.8 s monotonic, 4 gate(s), ended done
    execution union: 79.8 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 73.3 s
    wait calls: 1 (18 ms green); union 18 ms foreground
    abort: nothing running
```

## Files

Changed since `54804ba8c6e67f6bb757a97a04c1691431cd2c90`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased entry
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — names TI14 and TI11 and their message codes
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — what TI14 and TI11 miss, and the kept-text paragraph
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — the diff reader keeps text of the config and workflow files
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — passes the config input and workspace to the reader
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — passes the config path and repo root to the reader
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — selector on the text path, the three detectors, sorting
  ```

- `packages/core/src/chunkInputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/chunkInputs.ts` — `readDiffChunks` options and selector
  ```

- `packages/core/src/gateInputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/gateInputs.ts` — `configRepoPath`, shared with the selector
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — exports
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — hints for the new codes and ids
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — message codes and the per-id messages
  ```

- `packages/core/test/ac-stream-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-stream-check.test.ts` — existing test: its parsed-diff helper keeps the same text (reason in BUILD.md)
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — the message-code description names the two new codes
  ```

- `fixtures/test-integrity/TI11/block-test-step-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/block-test-step-removed.diff` — a `pnpm test:coverage` step removed
  ```

- `fixtures/test-integrity/TI11/block-trigger-flow.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/block-trigger-flow.diff` — `on: [push, pull_request]` to `on: [push]`
  ```

- `fixtures/test-integrity/TI11/block-trigger-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/block-trigger-removed.diff` — the `pull_request:` key removed
  ```

- `fixtures/test-integrity/TI11/block-workflow-deleted.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/block-workflow-deleted.diff` — a workflow with a test step deleted
  ```

- `fixtures/test-integrity/TI11/pass-action-bump.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-action-bump.diff` — an action version bump
  ```

- `fixtures/test-integrity/TI11/pass-comment-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-comment-removed.diff` — a commented-out test line removed
  ```

- `fixtures/test-integrity/TI11/pass-continue-expression.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-continue-expression.diff` — `continue-on-error` set to an expression
  ```

- `fixtures/test-integrity/TI11/pass-if-always.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-if-always.diff` — `if: always()` added
  ```

- `fixtures/test-integrity/TI11/pass-matrix-grown.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-matrix-grown.diff` — a matrix grown
  ```

- `fixtures/test-integrity/TI11/pass-non-workflow.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-non-workflow.diff` — a non-workflow YAML file with firing lines
  ```

- `fixtures/test-integrity/TI11/pass-pure-rename.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-pure-rename.diff` — a workflow renamed with no edit
  ```

- `fixtures/test-integrity/TI11/pass-step-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-step-moved.diff` — a test step moved to another workflow
  ```

- `fixtures/test-integrity/TI11/pass-step-reflowed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-step-reflowed.diff` — a test command reflowed
  ```

- `fixtures/test-integrity/TI11/pass-timeout-fifteen.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-timeout-fifteen.diff` — `timeout-minutes: 15` added
  ```

- `fixtures/test-integrity/TI11/pass-trigger-kept.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/pass-trigger-kept.diff` — `push` added beside a kept `pull_request`
  ```

- `fixtures/test-integrity/TI11/warn-continue-on-error.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/warn-continue-on-error.diff` — `continue-on-error: true` added
  ```

- `fixtures/test-integrity/TI11/warn-if-event.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/warn-if-event.diff` — `if: github.event_name == 'push'` added
  ```

- `fixtures/test-integrity/TI11/warn-if-false.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/warn-if-false.diff` — `if: false` added
  ```

- `fixtures/test-integrity/TI11/warn-matrix-reduced.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/warn-matrix-reduced.diff` — `[18, 20, 22]` to `[20, 22]`
  ```

- `fixtures/test-integrity/TI11/warn-timeout-one.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI11/warn-timeout-one.diff` — `timeout-minutes: 1` added
  ```

- `fixtures/test-integrity/TI14/block-config-deleted.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-config-deleted.diff` — config file deleted
  ```

- `fixtures/test-integrity/TI14/block-exclude-appended.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-exclude-appended.diff` — an item appended to an existing list
  ```

- `fixtures/test-integrity/TI14/block-exclude-block.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-exclude-block.diff` — an `exclude:` key with block items added
  ```

- `fixtures/test-integrity/TI14/block-exclude-flow.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-exclude-flow.diff` — an `exclude: [..]` flow list added
  ```

- `fixtures/test-integrity/TI14/block-threshold-lowered.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-threshold-lowered.diff` — threshold 80 to 70
  ```

- `fixtures/test-integrity/TI14/block-threshold-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/block-threshold-removed.diff` — threshold line removed
  ```

- `fixtures/test-integrity/TI14/pass-exclude-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-exclude-moved.diff` — an exclusion item reordered
  ```

- `fixtures/test-integrity/TI14/pass-exclude-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-exclude-removed.diff` — an exclusion removed
  ```

- `fixtures/test-integrity/TI14/pass-file-item-added.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-file-item-added.diff` — an item added to `coverage.file`
  ```

- `fixtures/test-integrity/TI14/pass-threshold-added.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-threshold-added.diff` — threshold added where none was
  ```

- `fixtures/test-integrity/TI14/pass-threshold-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-threshold-moved.diff` — threshold line moved, same value
  ```

- `fixtures/test-integrity/TI14/pass-threshold-raised.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-threshold-raised.diff` — threshold 80 to 90
  ```

- `fixtures/test-integrity/TI14/pass-unrelated-setup.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI14/pass-unrelated-setup.diff` — `setup.require` changed
  ```

- `packages/cli/test/ac-ti1411-render.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-ti1411-stream.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/signals/signalFiles.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/signalFiles.ts` — the keep-text selector and the workflow-file test (new)
  ```

- `packages/core/src/signals/ti11.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti11.ts` — the TI11 detector (new)
  ```

- `packages/core/src/signals/ti14.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti14.ts` — the TI14 detector (new)
  ```

- `packages/core/src/signals/yamlLines.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/yamlLines.ts` — bounded one-line helpers (new)
  ```

- `packages/core/test/ac-ti11-continue-on-error.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti11-if-condition.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti11-matrix.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti11-test-step.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti11-timeout.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti11-trigger.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti14-config-path.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti14-exclusion.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti14-threshold.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1411-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1411-modes.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1411-regression.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1411-selector.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-ti1411-selector.test.ts::keepSignalFileText(): which files keep their line text › AC-1: the config in use, the workflow files and the test files keep text, nothing else does
  AC-2  integration  passed  delivered  packages/cli/test/ac-ti1411-stream.test.ts::TI14 and TI11 through the streaming diff reader › AC-2: the streamed and the whole-text diff give the same testIntegrity block and messages, given the config path
  AC-3  integration  passed  delivered  packages/core/test/ac-ti14-threshold.test.ts::TI14: the coverage threshold lowered › AC-3: a lowered, removed or deleted threshold is a block finding; raised, moved, added and quoted values are not
  AC-4  integration  passed  delivered  packages/core/test/ac-ti14-exclusion.test.ts::TI14: a coverage exclusion added › AC-4: a flow list, an exclude key with items, and an appended known pattern are block findings; the controls are not
  AC-5  integration  passed  delivered  packages/core/test/ac-ti14-config-path.test.ts::TI14: which file is the config › AC-5: the config named by the config path is read; a config path outside the repository gives nothing
  AC-6  integration  passed  delivered  packages/core/test/ac-ti11-test-step.test.ts::TI11: a test step removed from a workflow › AC-6: a removed test command or a deleted workflow with one is a block finding; a comment, a move, a reflow and a rename are not
  AC-7  integration  passed  delivered  packages/core/test/ac-ti11-trigger.test.ts::TI11: the pull request trigger removed › AC-7: a removed pull_request trigger is a block finding; a kept one is not
  AC-8  integration  passed  delivered  packages/core/test/ac-ti11-matrix.test.ts::TI11: the matrix reduced › AC-8: a reduced flow-list matrix is a warn finding in mode block; a grown one is not
  AC-9  integration  passed  delivered  packages/core/test/ac-ti11-continue-on-error.test.ts::TI11: continue-on-error added › AC-9: only a literal true added is a warn finding, at its new-file line
  AC-10  integration  passed  delivered  packages/core/test/ac-ti11-if-condition.test.ts::TI11: a step or job disabled by a condition › AC-10: a literal false or an event-name test that leaves pull requests out is a warn finding; other conditions are not
  AC-11  integration  passed  delivered  packages/core/test/ac-ti11-timeout.test.ts::TI11: a near-zero timeout, and the edits that fire nothing › AC-11: timeout-minutes 0 or 1 is a warn finding; 15, an expression, and edits that touch none of the rules are not
  AC-12  integration  passed  delivered  packages/core/test/ac-ti1411-modes.test.ts::TI14 and TI11 in the three modes › AC-12: block mode sorts the signals and raises the verdict, warn mode shows every signal as warn, off computes nothing
  AC-13  integration  passed  delivered  packages/cli/test/ac-ti1411-render.test.ts::TI14 and TI11 in the PR comment and the CLI › AC-13: the section lists each signal with path:line, a hint per id, the empty state stays, and the CLI JSON holds the signal
  AC-14  integration  passed  delivered  packages/core/test/ac-ti1411-regression.test.ts::TI14 and TI11 leave the earlier signals and fixtures alone › AC-14: the old config and workflow fixtures keep their messages, the TI01 fixtures keep their signals
  AC-15  unit  passed  delivered  packages/core/test/ac-ti1411-docs.test.ts::TI14 and TI11: docs, schema and fixtures › AC-15: at least five must-trigger and five must-not-trigger diffs exist for each id, and they behave | packages/core/test/ac-ti1411-docs.test.ts::TI14 and TI11: docs, schema and fixtures › AC-15: the changelog, README, limits and threat model name TI14 and TI11 | packages/core/test/ac-ti1411-docs.test.ts::TI14 and TI11: docs, schema and fixtures › AC-15: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's
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
The diff reader and its two callers (`check()` for a diff text, `readDiffChunks` for the CLI and Action stream), the
config parser's list rules, the report builder and the renderer. The local diff is `--unified=0`, so nothing outside the
added and removed lines is visible: a bare list item cannot be tied to its key (TI14 uses the check's exclusion patterns
for that) and a `continue-on-error`, `if:` or `timeout-minutes` line cannot be tied to a test step (those three TI11 rules
are `warn` by design). One existing test (`ac-stream-check.test.ts`) parsed a diff without kept text and so differed from
the text form; its helper now uses the same selector (recorded in `BUILD.md`).
```

### learned

```text
All 15 AC tests passed the red run on the first try because each test holds a positive case that fails before the build.
Running `biome check` on the AC test files before the lock avoided the re-lock that item 3 needed. The `on:` flow list is
not a matrix: without excluding the key `on`, a dropped `pull_request` would have fired the matrix rule too.
```

### next_steps

```text
Backlog item 5: TI03 and TI04 (skips added, `.only` added), by diff line regex on test files. The selector
`keepSignalFileText` already keeps line text for test files, so no reader change is needed. Added lines are in
`hunk.added`; a "pre-existing" skip is matched against `hunk.removed` plus, for tests that exist at base, the base tree is
not available, so use the removed lines of the same file. Each new id needs a `SIGNAL_HINTS` entry and a
`SIGNAL_MESSAGES` entry in `report.ts`.
```
