# RUN REPORT — accept-label-human-signoff-3

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
blocked          gates-red-at-entry
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
window start       2026-10-25T06:04:41.199Z
window end         2026-10-25T06:19:03.932Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a0cc211ba0f909163, agent:a1cbac1f8918647e1, main
excluded requests  1121
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
(unattributed)  -     claude-opus-5-5    11     22               0           11316     3172280    5172             1171
pharn-grill     -     claude-opus-5-5     1      2               0            1115      285920     962                0
pharn-plan      -     claude-opus-5-5    51    102          178945            1201     8289478   41572            18442
pharn-spec      -     claude-opus-5-5    44     88          161089            4294     5836447   27500             7261
TOTAL           -     -                 107    214          340034           17926    17584125   75206            26874
unattributed    -     -                  11     22               0           11316     3172280    5172             1171
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
  pharn-spec            -    1  314.3 s
  pharn-plan            -    1  469.0 s
  pharn-grill           -    1  8889 ms

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
  invocation a351be9e: start started (call 1221 ms); lifetime 92.5 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 79d325: 91.1 s monotonic, 4 gate(s), ended done
    execution union: 91.1 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 91.0 s
    wait calls: 2 (18 ms red; 23 ms red); union 41 ms foreground
    abort: nothing running
```

## Files

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
The spec stage confirmed no other existing assertion breaks with `acceptLabel` written only for a non-default label.
The plan stage confirmed the issue-events endpoint's token permission: Issues (read) or Pull requests (read), so the
quick start's `pull-requests: write` covers it. Both are recorded in SPEC.md and PLAN.md.
```

### learned

```text
The entry gates run `base:test` and `test` at the same time, so the suite's wall-clock bounds (1000 ms in
`config-exclude.test.ts`) see twice the load they see in CI. That test has now flaked twice in this repository's loop
runs.
```

### next_steps

```text
Red ids at entry (DATA): test. Either re-run `/pharn-loop --allow-red-entry` with the same description (the red is a
known timing flake unrelated to the feature, and regress compares against the base run anyway), or first make the
`config-exclude.test.ts` timing assertions robust to a loaded machine without weakening what they prove, then re-run.
The plan and mapping of this run are a good starting point; a new run takes slug `accept-label-human-signoff-4`.
```
