# RUN REPORT — pr-comment-verdict-callout

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
blocked          stage-refused
base             2639d66c3059d8eb750838ab319b02bd82948267
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
window start       2026-10-18T20:09:14.933Z
window end         2026-10-18T20:27:26.898Z
selected session   232d75b9-3f74-4ac4-9dad-a3c4ddb3cf29
run context        main
run contexts       agent:a292422d4f0e5ee51, agent:a3f330948149293f4, agent:ac5f993dc492c4e60, agent:afe1defe0ac8671e5, main
excluded requests  669
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
(unattributed)  -     claude-opus-5-5      12     24               0           11210     4413861    5695             1974
pharn-build     1     claude-opus-5-5       2      4               0            2192      721421     587                0
pharn-build     1     claude-sonnet-5-5    31     62          150950               0     3774674   11759              358
pharn-grill     -     claude-opus-5-5       1      2               0             729      356500     687                0
pharn-plan      -     claude-opus-5-5      43     86          146448            2954     6392495    7514              364
pharn-spec      -     claude-opus-5-5      24     48          119453            3947     2817695    6531              298
pharn-test      -     claude-opus-5-5      45     90          128904            3240     6462061   14327             1658
TOTAL           -     -                   158    316          545755           24272    24938707   47100             4652
unattributed    -     -                    12     24               0           11210     4413861    5695             1974
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
  pharn-spec            -    1  144.0 s
  pharn-plan            -    1  380.7 s
  pharn-grill           -    1  6754 ms
  pharn-test            -    1  324.1 s
  pharn-build           1    1  165.2 s
  pharn-regress         1    1  595 ms

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
  invocation 02f83193: start started (call 255 ms); lifetime 20.9 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 6bb9d3: 20.6 s monotonic, 4 gate(s), ended done
    execution union: 20.6 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 20.6 s
    wait calls: 1 (19 ms green); union 19 ms foreground
```

## Files

Changed since `2639d66c3059d8eb750838ab319b02bd82948267`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

20 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased › Changed line for the verdict callout
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — "Example PR comment" shows the callout lines
  ```

- `fixtures/coverage-paths/package-relative/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.md` — regenerated: as above
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — regenerated: as above
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — regenerated: as above (`[!TIP]`)
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated: as above
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated: callout replaces the bare overview line
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (core changed)
  ```

- `packages/action/test/ac-comment-bold-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-comment-bold-fit.test.ts` — callout marker and content line expected in the full rendering and each body
  ```

- `packages/action/test/ac-header-logo-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-header-logo-fit.test.ts` — `keptLines()` takes the callout content line; marker required too
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — `VERDICT_ALERT` constant; overview line becomes the two-line alert callout; `overviewLine()` doc comment
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots show the callout
  ```

- `packages/core/test/ac-comment-bold-header.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-header.test.ts` — expects logo, heading, callout lines, then the table header
  ```

- `packages/core/test/ac-comment-bold-hostile.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-hostile.test.ts` — callout lines are fixed lines; exactly two lines start with `>`
  ```

- `packages/core/test/ac-comment-bold-overview.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-overview.test.ts` — `header()` reads marker and content line; sentence assertions kept
  ```

- `packages/core/test/ac-comment-look-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-footer.test.ts` — marker and content line before the summary table
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — callout folded back before hashing; constants and reason comment
  ```

- `packages/core/test/ac-header-logo-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-header-logo-golden.test.ts` — callout folded back before hashing; callout lines asserted
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — callout folded back before hashing; constants and reason comment
  ```

- `packages/core/test/helpers.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/helpers.ts` — exported `foldCallout()` used by the hash-pinned tests
  ```

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
- `packages/action/test/ac-verdict-callout-fit.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-verdict-callout-run.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-verdict-callout-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-verdict-callout-data.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-verdict-callout-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-verdict-callout-hostile.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-verdict-callout-no-coverable.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-verdict-callout-verdicts.test.ts` — _not named in PLAN ## Files_

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
The 20 escaped paths were unchanged since 2026-10-13 and were in this run's own pre-run snapshot. The snapshot record in
the git dir now belongs to a second `/pharn-loop` (`coverage-auto-discovery`, session ce164c99, opened 20:24:59Z) that
started in this same checkout during this run's build, and the checkout's branch was switched to
`feat/coverage-auto-discovery` (HEAD still 2639d66). The snapshot is one per worktree, so regress read it as
`other-run`.
```

### learned

```text
Two `/pharn-loop` runs must not share one checkout: the pre-run snapshot, the writes-scope file and the working tree are
per worktree. The build itself was green (672 tests, lint and build). Its changes are uncommitted in the shared tree,
and a copy is saved outside the repo in this session's scratchpad (`verdict-callout-tracked.patch`,
`verdict-callout-new-tests.tgz`).
```

### next_steps

```text
Once the other run has finished, or in a separate worktree, re-run this intent from a clean base, either by applying
the saved patch and tests or by running `/pharn-loop` again. Then open the PR.
```
