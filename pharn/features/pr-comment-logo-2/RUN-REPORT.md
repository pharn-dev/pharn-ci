# RUN REPORT — pr-comment-logo-2

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
base             69721ddfc02501561e7e0e9c74e471db5fe376b1
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
window start       2026-10-18T19:32:00.609Z
window end         2026-10-18T19:46:33.113Z
selected session   232d75b9-3f74-4ac4-9dad-a3c4ddb3cf29
run context        main
run contexts       agent:a112b3099204f05f6, agent:a3b7dabafdbd6324c, agent:aa161c1007dfa9aec, agent:ac15f100d7ba4aa60, main
excluded requests  513
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
(unattributed)  -     claude-opus-5-5       5     10               0            3702     1502651    2152               42
pharn-build     1     claude-opus-5-5       2      4               0            2334      597821     637               84
pharn-build     1     claude-sonnet-5-5    39     78          158402               0     4833208    8390              244
pharn-grill     -     claude-opus-5-5       1      2               0             715      294085     690               28
pharn-plan      -     claude-opus-5-5      26     52          118286            2411     3479982   10520              102
pharn-spec      -     claude-opus-5-5      17     34           72259            3473     1959232    6329              223
pharn-test      -     claude-opus-5-5      37     74          133254            3065     5442937   10683              205
TOTAL           -     -                   127    254          482201           15700    18109916   39401              928
unattributed    -     -                     5     10               0            3702     1502651    2152               42
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
  pharn-spec            -    1  90.6 s
  pharn-plan            -    1  207.6 s
  pharn-grill           -    1  7609 ms
  pharn-test            -    1  291.1 s
  pharn-build           1    1  220.9 s
  pharn-regress         1    1  17.5 s
  pharn-verify          1    1  9330 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 831 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 9c369382: start started (call 367 ms); lifetime 24.5 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 2bdc23: 24.0 s monotonic, 4 gate(s), ended done
    execution union: 24.0 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 24.0 s
    wait calls: 1 (44 ms green); union 44 ms foreground
    abort: nothing running
```

## Files

Changed since `69721ddfc02501561e7e0e9c74e471db5fe376b1`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

20 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased › Changed line for the header logo
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — "Example PR comment" gains the logo as its first quoted line
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — B1 note on the fixed first-party header image and its residual
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
  - `fixtures/golden-exclusions/report.md` — regenerated: as above
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated: as above
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated: logo line and an empty line above the heading
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (core changed)
  ```

- `packages/action/test/ac-comment-bold-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-comment-bold-fit.test.ts` — logo block skipped before heading and overview
  ```

- `packages/action/test/ac-comment-look-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-comment-look-fit.test.ts` — logo line and empty line expected between scope line and heading
  ```

- `packages/action/test/run.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/run.test.ts` — comment body prefix includes the logo block before the heading; titles unchanged
  ```

- `packages/core/src/render/logo.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/logo.ts` — `logoMarkup()` returns the fixed `<img …>` line (module constant); doc comment rewritten
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots gain the logo block
  ```

- `packages/core/test/ac-comment-bold-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-footer.test.ts` — banned image and URL strings checked without the logo line
  ```

- `packages/core/test/ac-comment-bold-header.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-header.test.ts` — first non-empty line is the logo, then heading, overview, table header
  ```

- `packages/core/test/ac-comment-bold-hostile.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-hostile.test.ts` — no `<img` outside code, except the asserted logo line 0
  ```

- `packages/core/test/ac-comment-bold-overview.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-overview.test.ts` — heading and overview read after the logo block
  ```

- `packages/core/test/ac-comment-look-collapse.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-collapse.test.ts` — heading located after the logo block
  ```

- `packages/core/test/ac-comment-look-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-footer.test.ts` — `logoMarkup()` expected to be the fixed line; image and URL checks without line 0
  ```

- `packages/core/test/ac-comment-look-header.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-header.test.ts` — heading located after the logo block
  ```

- `packages/core/test/ac-comment-look-hostile.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-hostile.test.ts` — `<img` check without the logo line
  ```

- `packages/core/test/ac-comment-look-summary.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-summary.test.ts` — heading located after the logo block
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — `GOLDEN_MD_SHA256` recomputed with the reason
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256` recomputed with the reason; JSON hashes unchanged
  ```

- `packages/core/test/exclusions-report.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/exclusions-report.test.ts` — AC-16 heading index and `<img` check allow only the logo line; title unchanged
  ```

- `packages/core/test/markdown.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/markdown.test.ts` — hostile-injection test allows only the logo as line 0; title unchanged
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
- `packages/action/test/ac-header-logo-fit.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-header-logo-run.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-header-logo-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-header-logo-asset.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-header-logo-data.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-header-logo-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-header-logo-markup.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-header-logo-reports.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-header-logo-markup.test.ts::logoMarkup(): the fixed pharn logo line › AC-1: returns exactly the fixed <img> line for the pharn logo on the raw main URL
  AC-2  unit  passed  delivered  packages/core/test/ac-header-logo-golden.test.ts::renderMarkdown(): the golden report opens with the logo line › AC-2: the golden rendering is the logo line, an empty line, then the committed report.md unchanged
  AC-3  unit  passed  delivered  packages/core/test/ac-header-logo-reports.test.ts::renderMarkdown(): the logo line opens every rendering, and is the only image or URL › AC-3: every rendering starts with the logo line, an empty line and the heading; nothing else carries an image or URL
  AC-4  unit  passed  delivered  packages/core/test/ac-header-logo-asset.test.ts::logoMarkup(): the logo URL names a committed SVG › AC-4: the path after the raw main URL is a file in the repository whose content starts with <svg
  AC-5  unit  passed  delivered  packages/core/test/ac-header-logo-data.test.ts::check(): report data unchanged by the header logo › AC-5: the golden report equals the committed report.json and validates against the schema
  AC-6  integration  passed  delivered  packages/action/test/ac-header-logo-fit.test.ts::action: the fitted sticky comment keeps the logo and heading › AC-6: an oversized comment fits the limit and still opens with marker, scope line, logo line, empty line and heading
  AC-7  integration  passed  delivered  packages/action/test/ac-header-logo-run.test.ts::action: the posted PR comment opens with the logo › AC-7: a failing PR posts a comment that starts with marker, scope line, logo line, empty line and the Fail heading
  AC-8  integration  passed  delivered  packages/cli/test/ac-header-logo-cli.test.ts::pharn-ci check: markdown output opens with the logo › AC-8: a passing check exits 0 and prints the logo line first, then the Pass heading and the Diff coverage section
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
The previous run `pr-comment-logo` stopped at S14 on a lint error in `docs/assets/pharn-logo.svg` (no `<title>`);
commit 69721dd added one before this run. The logo SVG itself was committed by hand before both runs (884187b).
```

### learned

```text
`logoMarkup()` now returns the fixed 48x48 `<img>` pointing at the raw `main` URL of `docs/assets/pharn-logo.svg`;
`renderMarkdown()` already placed a non-empty logo plus a blank line above the heading, so no other source changed.
Earlier features' tests were corrected to allow exactly that one line; `docs/THREAT-MODEL.md` notes that the image
follows `main`.
```

### next_steps

```text
Push the branch and open a PR; the raw URL only resolves after the merge to `main`, so the PR's own comment shows the
alt text until then. The PR description must explain each corrected earlier-feature test (AGENTS.md rule 4).
```
