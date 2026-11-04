# RUN REPORT — ti10-ti13-script-and-coverage-ignore-signals

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
base             73ed546bc52c926fdf86c6d3ce12f5de86e4d82c
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
window start       2026-10-25T02:05:47.147Z
window end         2026-10-25T02:36:11.903Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a04dbfa81c658926c, agent:a226f03601c4b3dc9, agent:a9297308640d0da03, agent:ad512da0cfc129515, main
excluded requests  797
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
(unattributed)  -     claude-sonnet-5-5    16     32             219           32683     3129495    8056             2048
pharn-build     1     claude-opus-5-5       1      2             230               0      207240    2153                0
pharn-build     1     claude-sonnet-5-5    44     88          206826            4603     7093840   42056            13679
pharn-grill     -     claude-opus-5-5       1      2             233               0      183434    1587                0
pharn-grill     -     claude-sonnet-5-5     3      6               0           11837      560415    1138                0
pharn-plan      -     claude-opus-5-5      28     56          146916               0     3609222   33978            15951
pharn-plan      -     claude-sonnet-5-5     3      6               0            3640      528334     905              149
pharn-regress   1     claude-sonnet-5-5     2      4               0            2979      405841     446               22
pharn-spec      -     claude-opus-5-5      26     52          155055               0     2822783   22759            10459
pharn-spec      -     claude-sonnet-5-5     3      6               0            4459      518071    2553              110
pharn-test      -     claude-opus-5-5      48     96          170489               0     7247057   58623            15541
pharn-test      -     claude-sonnet-5-5     3      6               0            1544      585727     767                0
TOTAL           -     -                   178    356          679968           61745    26891459  175021            57959
unattributed    -     -                    16     32             219           32683     3129495    8056             2048
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
  pharn-spec            -    1  253.3 s
  pharn-plan            -    1  352.2 s
  pharn-grill           -    1  11.9 s
  pharn-test            -    1  551.1 s
  pharn-build           1    1  466.2 s
  pharn-regress         1    1  76.8 s
  pharn-verify          1    1  29.1 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 1409 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 604f15e1: start started (call 460 ms); lifetime 44.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner dd2d57: 44.2 s monotonic, 4 gate(s), ended done
    execution union: 44.2 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 19.2 s
    wait calls: 1 (18 ms green); union 17 ms foreground
    abort: nothing running
```

## Files

Changed since `73ed546bc52c926fdf86c6d3ce12f5de86e4d82c`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased entries for TI10 and TI13
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — the `test-integrity` input row and the message-code table name TI10 and TI13
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — "What TI10 misses", "What TI13 misses", and the section 8 kept-text sentence
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — item 16: source and `package.json` text kept; fixed-sentence details
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — adds the two detectors to the signal list
  ```

- `packages/core/src/chunkInputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/chunkInputs.ts` — doc comment of `readDiffChunks` names the newly kept files
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — exports
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — message and signal hints for TI10 and TI13
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — the two message codes and their per-id messages
  ```

- `packages/core/src/signals/signalFiles.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/signalFiles.ts` — selector keeps `package.json` and JS/TS/Python source text; two path helpers
  ```

- `packages/core/test/ac-ti1411-selector.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti1411-selector.test.ts` — existing test: `src/app.ts` no longer asserted text-free (reason in BUILD.md)
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — the message-code description names the two new codes
  ```

- `fixtures/test-integrity/TI10/block-echo-in-place.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-echo-in-place.diff` — `"test"` value replaced by `echo skipped`
  ```

- `fixtures/test-integrity/TI10/block-name-filter.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-name-filter.diff` — `vitest run -t adds`
  ```

- `fixtures/test-integrity/TI10/block-nested-exit-zero.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-nested-exit-zero.diff` — `"test:unit"` in `packages/api/package.json` gains `; exit 0`
  ```

- `fixtures/test-integrity/TI10/block-or-true.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-or-true.diff` — `"test": "vitest run"` to `"vitest run || true"`
  ```

- `fixtures/test-integrity/TI10/block-pass-with-no-tests.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-pass-with-no-tests.diff` — `--passWithNoTests` added (PRECISION §1 case)
  ```

- `fixtures/test-integrity/TI10/block-path-filter.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-path-filter.diff` — `jest --testPathPattern=src/a`
  ```

- `fixtures/test-integrity/TI10/block-pretest-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/block-pretest-removed.diff` — a `pretest` script removed
  ```

- `fixtures/test-integrity/TI10/pass-and-echo.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-and-echo.diff` — `"test": "vitest run && echo done"` added
  ```

- `fixtures/test-integrity/TI10/pass-build-echo.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-build-echo.diff` — `"build": "tsc && echo built"` added
  ```

- `fixtures/test-integrity/TI10/pass-new-package.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-new-package.diff` — a new `package.json` holding `vitest run || true`
  ```

- `fixtures/test-integrity/TI10/pass-no-test-files.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-no-test-files.diff` — `--passWithNoTests` added in a repository with no test files
  ```

- `fixtures/test-integrity/TI10/pass-no-test-files.files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-no-test-files.files.txt` — the tracked files for that fixture, no test file among them
  ```

- `fixtures/test-integrity/TI10/pass-pre-existing-or-true.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-pre-existing-or-true.diff` — `vitest run || true` to `vitest run --reporter=dot || true`
  ```

- `fixtures/test-integrity/TI10/pass-stricter.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-stricter.diff` — `vitest run` to `vitest run --coverage`
  ```

- `fixtures/test-integrity/TI10/pass-unrelated-script.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI10/pass-unrelated-script.diff` — the `lint` script edited to `eslint -t x`
  ```

- `fixtures/test-integrity/TI13/block-c8-line.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-c8-line.diff` — the c8 line-comment hint added to `lib/e.js`
  ```

- `fixtures/test-integrity/TI13/block-istanbul-inline.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-istanbul-inline.diff` — the istanbul hint inline before `function f() {}`
  ```

- `fixtures/test-integrity/TI13/block-istanbul-next.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-istanbul-next.diff` — the istanbul next hint added to `src/a.ts`
  ```

- `fixtures/test-integrity/TI13/block-new-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-new-file.diff` — a new `src/new.ts` holding the istanbul hint
  ```

- `fixtures/test-integrity/TI13/block-pragma-no-cover.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-pragma-no-cover.diff` — `# pragma: no cover` added to `tools/run.py`
  ```

- `fixtures/test-integrity/TI13/block-v8-next.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/block-v8-next.diff` — the v8 next hint added to `src/b.mts`
  ```

- `fixtures/test-integrity/TI13/pass-markdown.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-markdown.diff` — the istanbul hint added to `README.md`
  ```

- `fixtures/test-integrity/TI13/pass-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-moved.diff` — the istanbul hint moved within `src/a.ts`, other indentation
  ```

- `fixtures/test-integrity/TI13/pass-pragma-no-branch.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-pragma-no-branch.diff` — `# pragma: no branch` added to `tools/run.py`
  ```

- `fixtures/test-integrity/TI13/pass-py-istanbul.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-py-istanbul.diff` — the istanbul hint added to `tools/run.py`
  ```

- `fixtures/test-integrity/TI13/pass-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-removed.diff` — a c8 hint removed
  ```

- `fixtures/test-integrity/TI13/pass-string.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-string.diff` — `const s = "istanbul ignore next";` added to `src/a.ts`
  ```

- `fixtures/test-integrity/TI13/pass-test-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-test-file.diff` — the istanbul hint added to `src/a.test.ts`
  ```

- `fixtures/test-integrity/TI13/pass-v8-ignored-word.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI13/pass-v8-ignored-word.diff` — `// v8 ignored on purpose` added
  ```

- `packages/cli/test/ac-ti1013-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/signals/ti10.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti10.ts` — the TI10 detector and its script-line and kind scans (new)
  ```

- `packages/core/src/signals/ti13.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti13.ts` — the TI13 detector and its marker scans (new)
  ```

- `packages/core/test/ac-ti10-details.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti10-no-signal.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti10-no-tests-exemption.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti10-weakened.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1013-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1013-modes.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1013-regression.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti1013-selector.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti13-added.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti13-details.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti13-no-signal.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-ti1013-selector.test.ts::the diff reader keeps the text of package.json and source files › AC-1: package.json files, JS/TS and Python sources keep their line text within the existing bounds; lockfile, Markdown and dependabot keep none
  AC-2  integration  passed  delivered  packages/core/test/ac-ti10-weakened.test.ts::TI10: a test script in package.json weakened › AC-2: each weakening of a test* script, and each removed pretest or posttest, gives one TI10 signal at its line with the mode's severity
  AC-3  integration  passed  delivered  packages/core/test/ac-ti10-no-signal.test.ts::TI10: script edits that do not weaken a test script › AC-3: pre-existing weakenings, unrelated scripts, stricter scripts, an edited pretest, added and deleted package.json files and a non-package.json give no TI10
  AC-4  integration  passed  delivered  packages/core/test/ac-ti10-no-tests-exemption.test.ts::TI10: --passWithNoTests in a repository with no test files › AC-4: it fires with test files, not without them, again when the diff deletes a test file, and when the tracked-file list is empty
  AC-5  integration  passed  delivered  packages/core/test/ac-ti10-details.test.ts::TI10: one signal per kind, the cap, and the fixed details › AC-5: two kinds on one line give two signals, 21 weakened scripts give 20, and each of the seven kinds has its own fixed sentence with no line text
  AC-6  integration  passed  delivered  packages/core/test/ac-ti13-added.test.ts::TI13: a coverage-ignore comment added to source › AC-6: each added istanbul, v8, c8 or pragma: no cover comment gives one TI13 signal at its line with the mode's severity
  AC-7  integration  passed  delivered  packages/core/test/ac-ti13-no-signal.test.ts::TI13: comments and edits that add no coverage-ignore marker to source › AC-7: moved and removed markers, markers in test files, markdown or the other language, and look-alikes give no TI13
  AC-8  integration  passed  delivered  packages/core/test/ac-ti13-details.test.ts::TI13: one-to-one matching, the cap, and the fixed details › AC-8: one removed and two added markers give one signal at the higher line, 21 give 20, and each of the four families has its own fixed sentence with no comment text
  AC-9  integration  passed  delivered  packages/core/test/ac-ti1013-modes.test.ts::TI10 and TI13 in the three modes › AC-9: block sorts and fails with error messages, warn shows every signal as warn, off computes nothing
  AC-10  integration  passed  delivered  packages/cli/test/ac-ti1013-render.test.ts::TI10 and TI13 in the PR comment, the streaming reader and the CLI › AC-10: the section lists each signal with a hint, both message hints exist, streamed equals whole text, the CLI JSON holds TI10
  AC-11  integration  passed  delivered  packages/core/test/ac-ti1013-regression.test.ts::TI10 and TI13 leave the earlier signals and fixtures alone › AC-11: the TI01, TI03, TI04, TI11 and TI14 fixtures give the same signals and messages as before, and the golden diff stays quiet
  AC-12  unit  passed  delivered  packages/core/test/ac-ti1013-docs.test.ts::TI10 and TI13: docs, schema and fixtures › AC-12: at least five must-trigger and five must-not-trigger diffs per id, the named cases among them, and they behave | packages/core/test/ac-ti1013-docs.test.ts::TI10 and TI13: docs, schema and fixtures › AC-12: the changelog, README, limits and threat model name TI10 and TI13 | packages/core/test/ac-ti1013-docs.test.ts::TI10 and TI13: docs, schema and fixtures › AC-12: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's
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
The existing TI03, TI04, TI11 and TI14 detectors, `signalFiles.ts` (which files keep line text), `testFiles.ts`, and
`docs/PRECISION.md` for the must-not-block cases of TI10. With `--unified=0` the diff shows no context, so a
`package.json` script is read only from one-line `"key": "value"` diff lines, and a ignore marker only from its own line.
```

### learned

```text
TI10 treats a weakening already on a removed line of the same script key as not added, and exempts
`--passWithNoTests` only when no tracked file is a test file and the diff deletes none. TI13 matches removed markers
against added ones one-to-one in line order. The diff reader now keeps text for `package.json` and for JS/TS/Python
source files, so the existing selector test had to stop asserting that `src/app.ts` keeps none. `ti13.ts` builds its
patterns from parts so the file holds no literal marker and does not trip TI13 on pharn-ci's own PR.
```

### next_steps

```text
Backlog item 7: the accept label (`test_integrity.accept_label`, else the `accept-label` input, else `pharn/accepted`,
honoured only when applied by a non-author user). The TI03, TI10 and TI13 hints say the accept label "will record that
sign-off once it ships" and should be updated to name the label when it lands.
```
