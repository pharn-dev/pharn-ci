# RUN REPORT — coverage-auto-discovery

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
base             dd2a03b41299c2cdb4da03bc790da6c96e526804
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
window start       2026-10-18T20:25:02.276Z
window end         2026-10-18T20:42:02.912Z
selected session   ce164c99-cf0f-4120-ace6-7c10000efe45
run context        main
run contexts       agent:a32d8fe5c1deaad5e, agent:addd6f64409bc4cea, main
excluded requests  14
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
(unattributed)  -     claude-sonnet-5-5     9     18               0           27293     1438241    5015             1355
pharn-grill     -     claude-sonnet-5-5     4      8               0           12687      588778    1495               51
pharn-plan      -     claude-opus-5-5      41     82          170737               0     5966325   16655              793
pharn-plan      -     claude-sonnet-5-5     5     10               0            5543      686950    2955             1395
pharn-spec      -     claude-opus-5-5      23     46          123129               0     2610436   12199             5811
pharn-spec      -     claude-sonnet-5-5     3      6               0            6904      384392    3604             2046
TOTAL           -     -                    85    170          293866           52427    11675122   41923            11451
unattributed    -     -                     9     18               0           27293     1438241    5015             1355
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
  pharn-spec            -    1  305.9 s
  pharn-plan            -    1  591.7 s
  pharn-grill           -    1  40.3 s

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
  invocation 3cd1a0c6: start started (call 271 ms); lifetime 17.6 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 007e15: 17.3 s monotonic, 4 gate(s), ended done
    execution union: 17.3 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 12.1 s
    wait calls: 1 (74 ms red); union 75 ms foreground
    abort: nothing running
```

## Files

Changed since `dd2a03b41299c2cdb4da03bc790da6c96e526804`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

43 path(s) were already dirty before the run started; those are marked below.

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
The checkout this run started in was not clean: it held the uncommitted files of a feature that origin/main had meanwhile merged (dd2a03b, "verdict as a GitHub alert callout", #58), and local HEAD was 2639d66, one commit behind. Every tracked modification and every untracked `ac-verdict-callout-*` test was byte-identical to origin/main, so after `git fetch` the branch pointer was moved with `git reset origin/main` (mixed: working tree untouched, nothing lost). HEAD is now dd2a03b and `git status` shows only `.agents/` and `.codex/` untracked. The entry gates had been started before that move, on the dirty tree.
```

### learned

```text
`pnpm lint` (biome check plus the four typechecks) passes on the clean dd2a03b tree, run by hand after the stop. The `lint` red recorded by the entry gates was therefore measured on the earlier mixed tree, or was transient, not on the tree the next run will start from. The cause of that earlier red was not established. The SPEC (17 criteria) and PLAN of this run are sound as far as the floor checks go, but the SPEC is now Draft and its content hash is cleared, so the PLAN's carried hash no longer matches an Approved SPEC.
```

### next_steps

```text
Re-run the loop from the clean dd2a03b tree with the same description (auto-discovery of the coverage file, an error listing the files when several different candidates match, plus examples in examples/workflows/): the earlier SPEC and PLAN stay on disk in `pharn/features/coverage-auto-discovery/` and a new run will use `coverage-auto-discovery-2`. Alternatively a person approves the existing SPEC with `/pharn-spec`, then runs `/pharn-plan` again to re-pin the chain. The plan's own notes to carry over: two existing test rows (`packages/cli/test/main.test.ts` "no coverage file" and `packages/action/test/run.test.ts` `coverage-file: ""`) assert the old stop and must be replaced with tests of the new not-found report, explained in the PR under AGENTS.md rule 4; the build needs network access to look up commit SHAs for `actions/setup-python`, `actions/setup-dotnet` and `taiki-e/install-action`; README.md must not gain `uses:` lines (ac-release-docs.test.ts).
```
