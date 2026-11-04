# RUN REPORT — accept-label-human-signoff

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
blocked          unlisted-ask
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
window start       2026-10-25T05:34:58.521Z
window end         2026-10-25T05:51:22.755Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a3107f631285d40fe, agent:aed19f205ce026d85, main
excluded requests  997
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
(unattributed)  -     claude-sonnet-5-5     8     16               0           20444     1572744    3397              160
pharn-plan      -     claude-opus-5-5      27     54          165345               0     3917767   26303            18015
pharn-plan      -     claude-sonnet-5-5     3      6               0            6160      548121    1060              237
pharn-spec      -     claude-opus-5-5      40     80          176625               0     5136627   33145            18240
pharn-spec      -     claude-sonnet-5-5     3      6               0            2958      539982    2424               30
TOTAL           -     -                    81    162          341970           29562    11715241   66329            36682
unattributed    -     -                     8     16               0           20444     1572744    3397              160
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
  pharn-spec            -    1  387.6 s
  pharn-plan            -    1  563.1 s

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
  invocation d25062d3: start started (call 297 ms); lifetime 25.1 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 10b277: 24.7 s monotonic, 4 gate(s), ended done
    execution union: 24.7 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 22.0 s
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
The spec stage read `product/BACKLOG.md` item 7, `DECISIONS.md` (2026-10-24), `REPORT-V2.md`, `API-SPEC.md`,
`schema/report.v2.json`, `report.ts`, `testIntegrityMode.ts`, the config parser and the action harness. The plan stage
read the SPEC and the code, and found the contradiction above before writing anything.
```

### learned

```text
Design notes from the plan stage, as DATA: a new pure `packages/core/src/acceptLabel.ts` (default label, validation of at
most 50 code points with no control characters and an error that does not echo the value, the login pattern, a decision
from author, labels and event list, and an apply step that turns block signals into warn, rebuilds the TI messages and
recomputes both verdicts); `SIGNAL_MESSAGES` loop in `report.ts` moved into an exported helper; the TI03, TI10 and TI13
hints become functions of `report.testIntegrity.acceptLabel`; `config.ts` rejects `accept_label` naming the
`accept-label` input; two new action API methods (`getPullRequestSignoff`, `listIssueEvents` with the next-page flag from
the Link header) so `getPullRequest` keeps the shape that `api.test.ts` and `ac-pr-number-api.test.ts` assert; new
`packages/action/src/accept-label.ts` wired in `run.ts` after `check()`. Still to confirm: the token permission that
`GET /repos/{owner}/{repo}/issues/{number}/events` needs. Risk to name: `@login` in a comment that is updated may notify
the reviewer again.
```

### next_steps

```text
A person amends the SPEC through `/pharn-spec` and re-runs. Recommended: add the AC-8 golden-equality assertion of
`packages/action/test/ac-stream-action.test.ts` to AC-13's list of superseded assertions, replacing it with a check that
`testIntegrity.acceptLabel` is `"pharn/accepted"` and that the rest of the report equals the golden. Alternative: write
`acceptLabel` only when the input is set or the label matters, and change AC-1's empty-input case to match. Re-run
`/pharn-loop` with the amended description afterwards; the new run takes the slug `accept-label-human-signoff-2` and
needs `pharn/features/accept-label-human-signoff/` removed or left, since it holds no AC-TESTS.
```
