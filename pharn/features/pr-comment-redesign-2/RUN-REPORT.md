# RUN REPORT — pr-comment-redesign-2

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
base             438461ea337756be4b2eb7260851365547c53702
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
window start       2026-10-18T18:13:36.843Z
window end         2026-10-18T18:29:29.629Z
selected session   232d75b9-3f74-4ac4-9dad-a3c4ddb3cf29
run context        main
run contexts       agent:a282eeef224f43b36, agent:a856f27715bdd92e8, agent:ac30f12d168a8a4cc, agent:ae261fc3b177ca23a, main
excluded requests  97
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
(unattributed)  -     claude-opus-5-5      12     24               0            7589     2300517    3940              295
pharn-build     1     claude-opus-5-5       2      4               0            2322      382360     398                0
pharn-build     1     claude-sonnet-5-5    26     52          130905               0     2828061    7411              116
pharn-grill     -     claude-opus-5-5       1      2               0            1768      184532     561                0
pharn-plan      -     claude-opus-5-5      37     74          134475            2583     4834818   12046             1462
pharn-spec      -     claude-opus-5-5      23     46          123981            3712     2444504    5853              245
pharn-test      -     claude-opus-5-5      38     76          115907            2661     4789863   13357              129
TOTAL           -     -                   139    278          505268           20635    17764655   43566             2247
unattributed    -     -                    12     24               0            7589     2300517    3940              295
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
  pharn-spec            -    1  159.8 s
  pharn-plan            -    1  265.4 s
  pharn-grill           -    1  6140 ms
  pharn-test            -    1  288.4 s
  pharn-build           1    1  149.0 s
  pharn-regress         1    1  21.2 s
  pharn-verify          1    1  11.3 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 1083 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 2e50f635: start started (call 227 ms); lifetime 16.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 3580f1: 16.4 s monotonic, 4 gate(s), ended done
    execution union: 16.4 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 12.6 s
    wait calls: 1 (28 ms green); union 28 ms foreground
    abort: nothing running
```

## Files

Changed since `438461ea337756be4b2eb7260851365547c53702`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

21 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — one line under Unreleased › Changed
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — "Example PR comment" replaced with the new golden render, quoted
  ```

- `biome.json` — _dirty-before-run; not named in PLAN ## Files_
- `fixtures/coverage-paths/package-relative/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.md` — regenerated: gains the summary table
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — regenerated: gains the summary table
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — regenerated: gains the summary table
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated: gains the summary table
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated: gains the summary table
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (core changed)
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — logo slot above the verdict heading; summary table between the heading and `### Diff coverage`; diff coverage table collapsed in `<details>` above 25 files
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots gain the summary table
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — `GOLDEN_MD_SHA256` recomputed for the intentional render change, with a one-sentence reason; no assertion changed
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256` and `EXCLUSIONS_MD_SHA256` recomputed, with a one-sentence reason; JSON hashes and assertions unchanged
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
- `packages/action/test/ac-comment-look-fit.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/render/logo.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/logo.ts` — new: `logoMarkup(): string`, the one place the header's logo markup comes from; returns `""` in this increment
  ```

- `packages/core/test/ac-comment-look-collapse.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-look-data.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-look-footer.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-look-header.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-look-hostile.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-look-summary.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-comment-look-header.test.ts::PR comment look: verdict header and summary block (pr-comment-redesign-2) › AC-1: opens with the verdict header and a summary block before the diff coverage section
  AC-2  unit  passed  delivered  packages/core/test/ac-comment-look-summary.test.ts::PR comment look: summary block edge states (pr-comment-redesign-2) › AC-2: shows not computed, no coverable lines, no threshold, none and 1 file
  AC-3  unit  passed  delivered  packages/core/test/ac-comment-look-collapse.test.ts::PR comment look: section order and collapsed long tables (pr-comment-redesign-2) › AC-3: keeps the section order, collapses 30-file tables, never collapses messages, and leaves 25 open
  AC-4  unit  passed  delivered  packages/core/test/ac-comment-look-footer.test.ts::PR comment look: compact footer and no image (pr-comment-redesign-2) › AC-4: ends with the <sub> footer and carries no image or URL, with an empty logo slot
  AC-5  unit  passed  delivered  packages/core/test/ac-comment-look-hostile.test.ts::PR comment look: hostile paths and message text stay inert (pr-comment-redesign-2) › AC-5: keeps the summary block fixed, tables aligned, no live <img and inert message lines
  AC-6  integration  passed  delivered  packages/action/test/ac-comment-look-fit.test.ts::action: redesigned PR comment fitted under the size limit (pr-comment-redesign-2) › AC-6: keeps the marker, scope line, verdict header, summary block and every message line
  AC-7  unit  passed  delivered  packages/core/test/ac-comment-look-data.test.ts::PR comment look: report data unchanged (pr-comment-redesign-2) › AC-7: check() on the golden inputs deep-equals the committed report.json, and the new look shows its values
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
The first run of this intent (`pharn/features/pr-comment-redesign/`) stopped at S14 because lint (untracked
`.codex/hooks/*.cjs`) and build/test (a missing workspace install) were red at entry. Before this run, `pnpm install`
was run and `.codex` and `.agents` were excluded in `biome.json` (a pre-run change, outside this feature's plan and
commit). Competitor layouts (CodeRabbit walkthrough, Greptile summary) came from public-doc search snippets, unverified.
```

### learned

```text
`ac-format-golden.test.ts` and `ac-paths-partial.test.ts` pin sha256 hashes of the markdown goldens, so any render
change must recompute those constants with a stated reason. `pnpm vitest run -u <files>` did not narrow to the given
files in this repo (BUILD.md). The logo slot is `packages/core/src/render/logo.ts` (`logoMarkup()` returns `""`); the
summary table and the `<details>` wrap of a diff-coverage table over 25 files live in `markdown.ts`.
```

### next_steps

```text
When the user supplies the pharn logo, return its fixed markup from `logoMarkup()`, host the image somewhere the
comment can load it, update the tests that expect the verdict heading as the first line, regenerate the goldens and
recompute the hash constants. Commit the `biome.json` exclusion separately from this branch.
```
