# RUN REPORT — accept-label-human-signoff-2

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
decision         INCONCLUSIVE
iterations       1
blocked          needs-clarification
base             a1089fdeaddbf166996856eb59b632adc2d93827
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
window start       2026-10-25T05:52:54.121Z
window end         2026-10-25T06:03:30.741Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:adf4422320d81d2fc, main
excluded requests  1084
```

Copied from `cost.json`'s stored views, never recomputed here — `check-cost-ledger.mjs` already
holds those views to a recompute from `requests[]`, so this is one number with one owner.

**TOKENS ONLY.** There is no price table here or in `cost.json`; money is the reader's own
multiplication against their own list, and `output_thinking` is a SUBSET of `output`, not a seventh
class. `unattributed` is an honest STAGE bucket — run requests before the first stage marker — never
folded into a neighbouring stage.

```text
stage           iter  model            reqs  input  cache_write_5m  cache_write_1h  cache_read  output  output_thinking
--------------  ----  ---------------  ----  -----  --------------  --------------  ----------  ------  ---------------
(unattributed)  -     claude-opus-5-5     3      6               0            4135      733804    2094              236
pharn-spec      -     claude-opus-5-5    29     58          128148            6123     3284339   20752             4292
TOTAL           -     -                  32     64          128148           10258     4018143   22846             4528
unattributed    -     -                   3      6               0            4135      733804    2094              236
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
  pharn-spec            -    1  609.8 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  (no /pharn-regress or /pharn-verify execution recorded one in this run)
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
  invocation 35417ad1: start started (call 303 ms); lifetime 29.9 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner e07bd3: 29.6 s monotonic, 4 gate(s), ended done
    execution union: 29.6 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 29.5 s
    wait calls: none recorded
    abort: nothing running
```

## Files

No PLAN.md was readable, so no planned purpose is shown.

_n/a — nothing changed since `a1089fdeaddbf166996856eb59b632adc2d93827` and nothing is untracked_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- verify: _n/a — no verify-report.json — the run stopped before a verify, or it was blocked_
- regress: _n/a — no regression-report.json — the run stopped before a regress, or it was blocked_

## Briefing

_n/a — no BRIEFING.md beside this report — not every command renders one, and a run that stops before its post-verify gate never does_

## What the run ran into

Quoted verbatim from `LOOP.md`'s `## Handoff`, as untrusted DATA. Each block is fenced with a
delimiter longer than any back-tick run inside it, so a heading in the quoted text stays text.
**The Handoff is a run's own account of itself — it is not verified by anything**, and nothing here
checks that it is accurate, complete, or useful.

### investigated

```text
The spec stage searched the suite for exact-equality assertions on Action reports before writing the SPEC and found the
second one. This run's grep of `golden/report.json` across `packages/*/test` confirms the two Action-report comparisons
(`packages/action/test/ac-stream-action.test.ts:166`, `packages/cli/test/ac-stream-adapters.test.ts:321`).
```

### learned

```text
Writing a new field on every Action report touches every test that compares a whole Action report with the shared
golden file. Two options remove the conflict: list both assertions as superseded, or write `acceptLabel` only on reports
where the label matters (or only when it differs from the default), so a default run's report stays byte-equal to the
golden and no existing assertion changes. The plan-stage design notes in the first run's record still apply.
```

### next_steps

```text
A person answers the marker. Option A: add `packages/cli/test/ac-stream-adapters.test.ts:321` to item 9 with the same
replacement as the AC-8 one. Option B: drop "written on every Action report" from item 6 so `testIntegrity.acceptLabel`
is written only when the `accept-label` input is set to a non-default name (hints fall back to `pharn/accepted`), which
leaves both golden assertions unchanged and drops item 9(b). Then re-run `/pharn-loop`; the new run takes slug
`accept-label-human-signoff-3`.
```
