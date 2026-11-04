# RUN REPORT — pr-comment-bold-look

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
base             caab309707e049317bb5d46aa7d6c6f334848c1c
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
window start       2026-10-18T18:31:25.311Z
window end         2026-10-18T18:55:14.534Z
selected session   232d75b9-3f74-4ac4-9dad-a3c4ddb3cf29
run context        main
run contexts       agent:a248ff034353826ff, agent:a43fbb1924d553f24, agent:a52fd47882721cc18, agent:a544e38178639df76, main
excluded requests  249
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
(unattributed)  -     claude-opus-5-5       7     14               0            5309     1719002    2799              198
pharn-build     1     claude-opus-5-5       2      4               0            2176      486260     602               70
pharn-build     1     claude-sonnet-5-5    46     92          185612               0     6595657    6224              154
pharn-grill     -     claude-opus-5-5       1      2               0            1237      237585     634                0
pharn-plan      -     claude-opus-5-5      48     96          183250            3015     7639333   14879              551
pharn-spec      -     claude-opus-5-5      27     54          130849            5186     2991872    7752              801
pharn-test      -     claude-opus-5-5      51    102          149871            3298     7602613   20741             1556
TOTAL           -     -                   182    364          649582           20221    27272322   53631             3330
unattributed    -     -                     7     14               0            5309     1719002    2799              198
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
  pharn-spec            -    1  205.6 s
  pharn-plan            -    1  404.0 s
  pharn-grill           -    1  6765 ms
  pharn-test            -    1  455.7 s
  pharn-build           1    1  292.9 s
  pharn-regress         1    1  17.6 s
  pharn-verify          1    1  11.5 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 837 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 3ac0cb63: start started (call 238 ms); lifetime 12.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner e6e5f6: 12.5 s monotonic, 4 gate(s), ended done
    execution union: 12.5 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 12.4 s
    wait calls: 2 (37 ms green; 32 ms green); union 69 ms foreground
    abort: nothing running
```

## Files

Changed since `caab309707e049317bb5d46aa7d6c6f334848c1c`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

20 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — the Unreleased › Changed comment-look line replaced with one describing the new look
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — "Example PR comment" replaced with the new golden render, quoted
  ```

- `fixtures/coverage-paths/package-relative/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.md` — regenerated: new look
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — regenerated: new look, footer names cobertura
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — regenerated: new look
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated: new look
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated: new look
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (core changed)
  ```

- `packages/action/test/ac-comment-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-comment-fit.test.ts` — verdict substring corrected to the full new heading
  ```

- `packages/action/test/ac-comment-look-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-comment-look-fit.test.ts` — heading constant and section anchors corrected
  ```

- `packages/action/test/ac-summary-fit.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-summary-fit.test.ts` — verdict substring corrected to the full new heading
  ```

- `packages/action/test/run.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/run.test.ts` — body and summary heading assertions corrected to the new heading
  ```

- `packages/cli/test/main.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/main.test.ts` — the exit-0 test's heading corrected to the new heading
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — branded heading, overview sentence, capitalized verdict cell, counted emoji section headings, both file tables always in `<details>` (diff open on `DIFF_COVERAGE_BELOW_THRESHOLD`), `---` footer with coverage format
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots in the new look
  ```

- `packages/core/test/ac-comment-look-collapse.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-collapse.test.ts` — collapse at 25 too, `<details open>` recognized, new headings
  ```

- `packages/core/test/ac-comment-look-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-data.test.ts` — section anchor corrected
  ```

- `packages/core/test/ac-comment-look-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-footer.test.ts` — heading regex, section anchor, overview line above the table
  ```

- `packages/core/test/ac-comment-look-header.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-header.test.ts` — heading, section anchor and `Fail` corrected
  ```

- `packages/core/test/ac-comment-look-hostile.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-hostile.test.ts` — section anchors corrected
  ```

- `packages/core/test/ac-comment-look-summary.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-summary.test.ts` — heading regex and section anchor corrected
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — AC-13 render equality corrected to all lines but the footer, with both footers asserted; `GOLDEN_MD_SHA256` recomputed with a reason
  ```

- `packages/core/test/ac-markdown-order-cap.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-markdown-order-cap.test.ts` — Messages and Agent setup found by their new headings
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256` recomputed with a reason; JSON hashes and assertions unchanged
  ```

- `packages/core/test/ac-setup-expect-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-setup-expect-render.test.ts` — agent setup section found by its new heading
  ```

- `packages/core/test/ac-setup-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-setup-render.test.ts` — AC-11 section and between-lines corrected; AC-13 corrected to collapse at every size
  ```

- `packages/core/test/exclusions-report.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/exclusions-report.test.ts` — section anchors corrected and asserted found
  ```

- `packages/core/test/markdown.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/markdown.test.ts` — the heading and agent setup section line corrected to the new layout
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
- `packages/action/test/ac-comment-bold-fit.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-comment-bold-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-data.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-details.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-footer.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-header.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-hostile.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-overview.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-comment-bold-sections.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-comment-bold-header.test.ts::renderMarkdown(): the branded header block › AC-1: opens with the brand and verdict heading, the overview sentence and the summary table, above Diff coverage
  AC-2  unit  passed  delivered  packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: a passing report has the Pass heading | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: a warning report has the Warn heading | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: diff coverage not computed starts the sentence with 'Diff coverage was not computed;' | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: no agent setup files ends the sentence with '; no agent setup files found.' | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: no coverable changed lines starts the sentence with 'This change adds no coverable lines;' | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: no threshold puts ', with no threshold set;' in the sentence | packages/core/test/ac-comment-bold-overview.test.ts::renderMarkdown(): the heading and the overview sentence › AC-2: one agent setup file ends the sentence with '; 1 agent setup file found.'
  AC-3  unit  passed  delivered  packages/core/test/ac-comment-bold-sections.test.ts::renderMarkdown(): emoji section headings with counts › AC-3: the sections are Diff coverage, Messages (N) and Agent setup (N files), in that order, with no other heading
  AC-4  unit  passed  delivered  packages/core/test/ac-comment-bold-details.test.ts::renderMarkdown(): per-file detail collapsed in <details> blocks › AC-4: the file tables sit in <details> blocks, the diff one open below the threshold, and the summary lines and messages stay visible
  AC-5  unit  passed  delivered  packages/core/test/ac-comment-bold-footer.test.ts::renderMarkdown(): the footer › AC-5: ends with a thematic break and a footer naming the version, the schema and the coverage format, and carries no image or URL
  AC-6  unit  passed  delivered  packages/core/test/ac-comment-bold-hostile.test.ts::renderMarkdown(): the new header, summaries and footer with hostile paths and message text › AC-6: no image, no broken table row, no input text in the fixed lines, and inert message lines
  AC-7  unit  passed  delivered  packages/core/test/ac-comment-bold-data.test.ts::check() and renderMarkdown(): report data and message text unchanged › AC-7: the golden report equals the committed report.json, and the Messages section carries the committed message and hint lines
  AC-8  integration  passed  delivered  packages/action/test/ac-comment-bold-fit.test.ts::run(): the new header block in a sticky comment that has to be shortened › AC-8: a report too long for one comment keeps the heading, the overview sentence, the summary row and every message
  AC-9  integration  passed  delivered  packages/cli/test/ac-comment-bold-cli.test.ts::pharn-ci check: markdown output › AC-9: a passing check exits 0 and prints the branded Pass heading and the Diff coverage section
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
Built on HEAD caab309 (the summary table and empty logo slot from `pr-comment-redesign-2`, committed by hand on branch
`pharn-loop/pr-comment-redesign-2`). The Action finds its sticky comment by `COMMENT_MARKER` and the scope line, not
by the heading, so the heading could change. Report v1 has no ref or commit fields, so the footer cannot show a
last-reviewed commit the way Greptile's does.
```

### learned

```text
The new layout: `## 🛡️ pharn-ci · <icon> <Label>`, a fixed-template overview sentence, the summary table, emoji
section headings with counts, both file tables always in `<details>` (the changed-files block opens only on
`DIFF_COVERAGE_BELOW_THRESHOLD`), and a `---` plus `<sub>` footer naming the coverage format. Earlier features' AC
tests that pinned the old headings were corrected in place.
```

### next_steps

```text
Add the pharn logo the user supplied mid-run: commit the SVG under `docs/assets/`, return a fixed `<img>` from
`logoMarkup()` pointing at a stable URL of that file, and correct the tests that assert no `<img` or URL in the
header and that the heading is the first line.
```
