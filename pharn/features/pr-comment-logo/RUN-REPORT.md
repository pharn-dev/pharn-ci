# RUN REPORT — pr-comment-logo

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
base             884187b28b6173ae01eb7cce6f26971a6d4561a0
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
window start       2026-10-18T19:23:12.690Z
window end         2026-10-18T19:31:45.910Z
selected session   232d75b9-3f74-4ac4-9dad-a3c4ddb3cf29
run context        main
run contexts       agent:a7de617e28ad79ad0, agent:a8defbff1d675fdd4, main
excluded requests  443
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
(unattributed)  -     claude-opus-5-5     6     12               0            4462     1704386    2514              323
pharn-grill     -     claude-opus-5-5     1      2               0             869      281482     635                0
pharn-plan      -     claude-opus-5-5    38     76          125794            2511     4984983    6908               33
pharn-spec      -     claude-opus-5-5    22     44          120938            4593     2485687    6354              446
TOTAL           -     -                  67    134          246732           12435     9456538   16411              802
unattributed    -     -                   6     12               0            4462     1704386    2514              323
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
  pharn-spec            -    1  147.6 s
  pharn-plan            -    1  328.1 s
  pharn-grill           -    1  6948 ms

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
  invocation 4b815af7: start started (call 252 ms); lifetime 18.4 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner a52a9f: 18.1 s monotonic, 4 gate(s), ended done
    execution union: 18.1 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 18.1 s
    wait calls: 1 (32 ms red); union 32 ms foreground
    abort: nothing running
```

## Files

Changed since `884187b28b6173ae01eb7cce6f26971a6d4561a0`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

20 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

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
Ran `pnpm exec biome check --reporter=summary` after the stop: the only violation is
`docs/assets/pharn-logo.svg` (rule `lint/a11y/noSvgWithoutTitle`, 1 error). That file was committed by hand just
before this run (884187b) with the user's SVG as given, which has no `<title>` element.
```

### learned

```text
Biome lints SVG files in `docs/assets/`, so a committed SVG needs a `<title>`. The SPEC and PLAN of this run were
GREEN through the grill: the logo is a fixed 48x48 `<img>` with the raw `main` URL on its own first line, and 16
existing test files need correcting.
```

### next_steps

```text
Add `<title>pharn</title>` as the first child of the SVG in `docs/assets/pharn-logo.svg`, commit it, confirm
`pnpm lint` is green, and re-run `/pharn-loop` for the logo (it will run as `pr-comment-logo-2`).
```
