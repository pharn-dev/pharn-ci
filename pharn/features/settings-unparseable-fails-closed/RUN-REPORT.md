# RUN REPORT — settings-unparseable-fails-closed

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
base             2e89ec909a520ba51a6fa7c27680515bc8a8f309
command          /pharn-loop
skills_version   7.1.4
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
window start       2026-11-02T09:37:31.695Z
window end         2026-11-02T09:51:47.550Z
selected session   9f9a3153-4c9a-422e-b29b-b74f72ec1da6
run context        main
run contexts       agent:a1a3fd98551b6b5e5, agent:a5de01b10dbe9e28a, main
excluded requests  33
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
(unattributed)  -     claude-opus-5-5    13     26               0           26780     2618673    5929             1366
pharn-grill     -     claude-opus-5-5     4     10             450           13245      760318    2659               39
pharn-plan      -     claude-opus-5-5    56    112          146331            2990     7426120   30124             9673
pharn-spec      -     claude-opus-5-5    38     76          129686            4317     4091507   19161             4879
TOTAL           -     -                 111    224          276467           47332    14896618   57873            15957
unattributed    -     -                  13     26               0           26780     2618673    5929             1366
```

**Always-loaded instruction set — an ESTIMATE, not a measurement.**

~1591 tokens (6361 bytes over 2 file(s)), taken once at the run's start by `pharn/floor/check-instruction-files.mjs --report`. The figure is bytes / 4 (`pharn/LIMITS.md §1c`) over that checker's
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
  pharn-spec            -    1  288.2 s
  pharn-plan            -    1  429.0 s
  pharn-grill           -    1  21.0 s

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
  invocation 658bf073: start started (call 1242 ms); lifetime 570.8 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner b077df: 569.5 s monotonic, 4 gate(s), ended done
    execution union: 569.5 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 546.8 s
    wait calls: 1 (167 ms red); union 167 ms foreground
    abort: nothing running
```

## Files

Changed since `2e89ec909a520ba51a6fa7c27680515bc8a8f309`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

5 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `fixtures/golden-cobertura/report.md` — _dirty-before-run; not named in PLAN ## Files_
- `fixtures/golden-exclusions/report.md` — _dirty-before-run; not named in PLAN ## Files_
- `fixtures/golden-multi/report.md` — _dirty-before-run; not named in PLAN ## Files_
- `fixtures/golden/report.md` — _dirty-before-run; not named in PLAN ## Files_
- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`, AGENTS.md rule 7)
  ```

- `packages/core/src/render/markdown.ts` — _dirty-before-run; not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- isolation: HOST (host execution accepted by operator)

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
The 11 tests that failed in both the `base:test` and `test` entry gates, read from the gates' vitest result files
(quoted as DATA): `ac-accept-signoff-regression` AC-14 and `ac-name-only-dist` AC-11 (the committed action dist is not
a fresh bundle), `ac-pyparity2-unchanged` AC-20 (a base fixture is modified), `ac-format-golden` AC-14,
`ac-header-logo-golden` AC-2, `ac-paths-partial` AC-5, `ac-test-integrity-mode-render` AC-8 and
`ac-verdict-callout-golden` AC-1 (golden markdown differs), `ac-p07-unchanged` AC-23, `ac-p11-unchanged` AC-25 and
`ac-polset-pins` AC-31 (a golden fixture changed). None touches this feature's files: the tree the run started from
already held staged, uncommitted changes from before the run (`packages/core/src/render/markdown.ts`, a coverage bar,
and the four `fixtures/golden*/report.md` files), listed in the pre-run snapshot.
```

### learned

```text
The red is caused entirely by that staged pre-run work, not by this increment. Running the loop with
`--allow-red-entry` would not help: those 11 pin tests would stay red every iteration and the run would end at
STOP_CAP. The entry `build` gate rebuilt `packages/action/dist/index.js` from the staged `markdown.ts`, so that file is
now modified (unstaged) in the working tree. The PLAN and AC-TESTS written this run are usable as a starting point
once the tree is clean.
```

### next_steps

```text
A person commits or stashes the staged coverage-bar change (and restores `packages/action/dist/index.js` to HEAD or
keeps it with that change), so the tree the loop starts from is green, then re-runs `/pharn-loop` for this intent; the
retry lands in `settings-unparseable-fails-closed-2`, and this run's AC-TESTS.md claims its test file names, so
either remove this feature directory first or let the new plan pick new names.
```
