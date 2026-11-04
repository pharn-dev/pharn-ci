# RUN REPORT — skylos-nine-vitest

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
base             feb9cae77215c8a1cf34415addd972d9017427d8
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
window start       2026-10-25T06:59:30.447Z
window end         2026-10-25T07:13:44.402Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a2fba7520e40a25ab, agent:a390cf32c88c5c84c, agent:ade93eb3422330ee5, agent:af0951a9f8fbedc37, main
excluded requests  1469
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
(unattributed)  -     claude-opus-5-5       1      2             209               0      121834     636                0
(unattributed)  -     claude-sonnet-5-5    15     30             220           22235     2943106    5923              544
pharn-build     1     claude-opus-5-5       1      2             210               0      129707    1302                0
pharn-build     1     claude-sonnet-5-5    20     40          109871            3710     2166128    8554              358
pharn-grill     -     claude-sonnet-5-5     2      4               0            3279      387755     840                0
pharn-plan      -     claude-opus-5-5      23     46           85294               0     2195242   15665             4142
pharn-plan      -     claude-sonnet-5-5     3      6               0            3257      568219     840              124
pharn-regress   1     claude-sonnet-5-5     1      2               0            2100      202446     229                0
pharn-spec      -     claude-opus-5-5      19     38          118772               0     1749282   10892             3821
pharn-spec      -     claude-sonnet-5-5     3      6               0            3984      557519    3136              296
pharn-test      -     claude-opus-5-5      26     52           92956               0     2644743   23665             6882
pharn-test      -     claude-sonnet-5-5     3      6               0            1434      591135     728                0
pharn-verify    1     claude-sonnet-5-5     1      2               0             406      204975     190                0
TOTAL           -     -                   118    236          407532           40405    14462091   72600            16167
unattributed    -     -                    16     32             429           22235     3064940    6559              544
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
  pharn-spec            -    1  157.0 s
  pharn-plan            -    1  159.4 s
  pharn-grill           -    1  9191 ms
  pharn-test            -    1  244.2 s
  pharn-build           1    1  145.4 s
  pharn-regress         1    1  40.2 s
  pharn-verify          1    1  39.4 s

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
  invocation 79ffd121: start started (call 409 ms); lifetime 53.5 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 2757fc: 53.0 s monotonic, 4 gate(s), ended done
    execution union: 53.0 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 49.5 s
    wait calls: 1 (17 ms green); union 17 ms foreground
    abort: nothing running
```

## Files

Changed since `feb9cae77215c8a1cf34415addd972d9017427d8`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `fixtures/skylos-nine/added-skip/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/added-skip/change.diff` — `it(` → `it.skip(` with the same name, no condition
  ```

- `fixtures/skylos-nine/added-skip/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/added-skip/files.txt` — head file list with the test file and its source
  ```

- `fixtures/skylos-nine/always-true-matcher/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/always-true-matcher/change.diff` — adds an `expect.extend(` matcher that always passes
  ```

- `fixtures/skylos-nine/always-true-matcher/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/always-true-matcher/files.txt` — head file list
  ```

- `fixtures/skylos-nine/deleted-test/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/deleted-test/change.diff` — deletes the vitest test file `src/__tests__/cart.test.ts`; its source stays
  ```

- `fixtures/skylos-nine/deleted-test/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/deleted-test/files.txt` — head file list: the source file, not the deleted test
  ```

- `fixtures/skylos-nine/deselect-setting/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/deselect-setting/change.diff` — narrows `include` / adds `exclude` in `vitest.config.ts` only
  ```

- `fixtures/skylos-nine/deselect-setting/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/deselect-setting/files.txt` — head file list
  ```

- `fixtures/skylos-nine/edited-expected-value/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/edited-expected-value/change.diff` — `toBe(5)` → `toBe(6)`, same matcher
  ```

- `fixtures/skylos-nine/edited-expected-value/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/edited-expected-value/files.txt` — head file list
  ```

- `fixtures/skylos-nine/emptied-assertion/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/emptied-assertion/change.diff` — removes an `expect(` line, adds none
  ```

- `fixtures/skylos-nine/emptied-assertion/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/emptied-assertion/files.txt` — head file list
  ```

- `fixtures/skylos-nine/hard-coded-answer/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/hard-coded-answer/change.diff` — adds an `if` special case in the non-test `src/cart.ts`
  ```

- `fixtures/skylos-nine/hard-coded-answer/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/hard-coded-answer/files.txt` — head file list
  ```

- `fixtures/skylos-nine/loosened-assertion/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/loosened-assertion/change.diff` — `toBe(5)` → `toBeTruthy()`
  ```

- `fixtures/skylos-nine/loosened-assertion/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/loosened-assertion/files.txt` — head file list
  ```

- `fixtures/skylos-nine/replaced-test/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/replaced-test/change.diff` — swaps one `it(` opening line for one with a different name
  ```

- `fixtures/skylos-nine/replaced-test/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/skylos-nine/replaced-test/files.txt` — head file list that still holds the modified test file
  ```

- `packages/core/test/ac-skylos-nine-added-skip.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-skylos-nine-deleted-test.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-skylos-nine-diffs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-skylos-nine-fixtures.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-skylos-nine-misses.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-skylos-nine-table.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-skylos-nine-deleted-test.test.ts::Skylos nine: the deleted-test case is caught by TI01 › AC-1: deleting a vitest test file while its source stays gives one TI01 block signal, a fail verdict and a rendered **TI01** line with the path
  AC-2  unit  passed  delivered  packages/core/test/ac-skylos-nine-added-skip.test.ts::Skylos nine: the added-skip case is caught by TI03 › AC-2: turning an existing it( into it.skip( with the same name gives one TI03 block signal, a fail verdict and a rendered **TI03** line with path:line
  AC-3  unit  passed  delivered  packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: always-true-matcher — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: deselect-setting — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: edited-expected-value — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: emptied-assertion — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: hard-coded-answer — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: loosened-assertion — check() and the renderer do not throw, the report is valid and has no test-integrity signal | packages/core/test/ac-skylos-nine-misses.test.ts::Skylos nine: the seven expected misses run cleanly and give no signal › AC-3: replaced-test — check() and the renderer do not throw, the report is valid and has no test-integrity signal
  AC-4  unit  passed  delivered  packages/core/test/ac-skylos-nine-table.test.ts::Skylos nine: the case table and the headline › AC-4: exactly deleted-test and added-skip give a signal, each only its table id, and the other seven give none | packages/core/test/ac-skylos-nine-table.test.ts::Skylos nine: the case table and the headline › AC-4: the headline — nine cases, 2 caught, 7 expected misses | packages/core/test/ac-skylos-nine-table.test.ts::Skylos nine: the case table and the headline › AC-4: the table maps the nine cases to TI01, TI03, TI05, TI09, TI15, none, TI02, TI06 and TI07, one entry per fixture directory
  AC-5  unit  passed  delivered  packages/core/test/ac-skylos-nine-fixtures.test.ts::Skylos nine: the fixture directory › AC-5: every change.diff is a non-empty unified diff with no context lines that touches only .ts, .tsx, .js or .mjs paths | packages/core/test/ac-skylos-nine-fixtures.test.ts::Skylos nine: the fixture directory › AC-5: every files.txt is non-empty with one repository-relative path per line | packages/core/test/ac-skylos-nine-fixtures.test.ts::Skylos nine: the fixture directory › AC-5: fixtures/skylos-nine holds exactly the nine case directories, each with exactly change.diff and files.txt | packages/core/test/ac-skylos-nine-fixtures.test.ts::Skylos nine: the fixture directory › AC-5: no change.diff or files.txt holds pytest or a .py path
  AC-6  unit  passed  delivered  packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: always-true-matcher adds an expect.extend( line | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: deselect-setting touches only vitest.config.ts and changes an include or exclude line | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: edited-expected-value removes and adds a line with the same matcher and a different expected literal | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: emptied-assertion removes an expect( line from a test file and adds none | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: hard-coded-answer touches only files that are not test files and adds an if | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: loosened-assertion removes a toBe( or toEqual( line and adds a toBeTruthy() line | packages/core/test/ac-skylos-nine-diffs.test.ts::Skylos nine: each miss case's diff shows its cheat › AC-6: replaced-test modifies one test file still at head, swapping one test opening line for one with another name
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
`product/DELIVERY-PLAN.md` "Skylos nine cases (E1)", the TI01 and TI03 fixtures under `fixtures/test-integrity/`, and
how the existing TI AC tests drive `check()` with a diff, a file list and `testIntegrityMode`.
```

### learned

```text
The seven misses are only honest while no shipped signal fires on them, so each case's diff was shaped to avoid TI01,
TI03, TI04, TI10, TI11, TI13 and TI14 (the deselect case edits `vitest.config.ts` only; the replaced-test case swaps
a test inside one file). When TI02, TI05, TI06, TI07, TI09 or TI15 ships, that case's miss assertion in
`ac-skylos-nine-misses.test.ts` and the table in `ac-skylos-nine-table.test.ts` must be turned into a catch assertion.
```

### next_steps

```text
Backlog item 9: LIMITS + README + CHANGELOG for v0.2.0 ("What test integrity does not catch" must name the
always-true matcher as an expected miss with no signal planned, TI17 candidate), the post-release smoke job and the
fork-PR step in RELEASING.md, then the release.
```
