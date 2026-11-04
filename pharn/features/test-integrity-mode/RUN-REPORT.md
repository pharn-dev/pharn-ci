# RUN REPORT — test-integrity-mode

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
base             e39cda3780c7df9c14c84018d187c2c9adfc7f9a
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
window start       2026-10-25T00:14:22.301Z
window end         2026-10-25T00:28:56.245Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       main
excluded requests  229
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
(unattributed)  -     claude-sonnet-5-5    13     26               0           24968     4126776    4752              737
pharn-build     1     claude-sonnet-5-5    39     78               0           69070    13072479   29415             4503
pharn-grill     -     claude-sonnet-5-5     3      6               0           11781      784420    1310                0
pharn-plan      -     claude-sonnet-5-5    17     34               0           80156     3705999   22615             9659
pharn-spec      -     claude-sonnet-5-5    13     26               0           26966     2111430    8692              901
pharn-test      -     claude-sonnet-5-5    10     20               0           31252     2845995   16449             5099
TOTAL           -     -                    95    190               0          244193    26647099   83233            20899
unattributed    -     -                    13     26               0           24968     4126776    4752              737
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
  pharn-spec            -    1  82.2 s
  pharn-plan            -    1  199.5 s
  pharn-grill           -    1  18.1 s
  pharn-test            -    1  128.9 s
  pharn-build           1    1  349.9 s
  pharn-regress         1    1  22.2 s
  pharn-verify          1    1  12.4 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 776 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 7f2d9c98: start started (call 251 ms); lifetime 20.1 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner f5a0af: 19.8 s monotonic, 4 gate(s), ended done
    execution union: 19.8 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 15.6 s
    wait calls: 1 (61 ms green); union 61 ms foreground
    abort: nothing running
```

## Files

Changed since `e39cda3780c7df9c14c84018d187c2c9adfc7f9a`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased entry
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — input, flag and config documentation
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — the `test-integrity` input
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — PR-carried mode can only tighten
  ```

- `fixtures/coverage-paths/package-relative/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.md` — regenerated golden markdown
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — regenerated golden markdown
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — regenerated golden markdown
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated golden markdown
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated golden markdown
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — `test-integrity` input
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — `--test-integrity` flag
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — `testIntegrityMode` input threaded to `buildReport`
  ```

- `packages/core/src/config.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/config.ts` — `test_integrity.mode` key
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export the new module
  ```

- `packages/core/src/inputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/inputs.ts` — raw input, error label, resolved `testIntegrityMode`
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — hints and the "🔍 Test integrity" section
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — message codes, `buildReport` fills `testIntegrity` and the two messages
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated markdown snapshot
  ```

- `packages/core/test/ac-comment-bold-sections.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-sections.test.ts` — the expected section list gains the new heading
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — fold the new section out; hash constants unchanged
  ```

- `packages/core/test/ac-header-logo-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-header-logo-golden.test.ts` — fold the new section out; hash constant unchanged
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — fold the new section out; hash constants unchanged
  ```

- `packages/core/test/ac-verdict-callout-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-verdict-callout-golden.test.ts` — fold the new section out; hash constants unchanged
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — known-codes documentation
  ```

- `packages/action/test/ac-test-integrity-mode-action.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-test-integrity-mode-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/testIntegrityMode.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/testIntegrityMode.ts` — new: mode type, validation and the pure precedence function
  ```

- `packages/core/test/ac-test-integrity-mode-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-test-integrity-mode-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-test-integrity-mode-resolve.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-test-integrity-mode-validate.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-resolve.test.ts::test-integrity mode precedence through check() › AC-1: with no input and no config the mode is warn from the default and no mode message is added
  AC-2  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-resolve.test.ts::test-integrity mode precedence through check() › AC-2: the input wins over the default and over a looser config, and a loosening config is reported
  AC-3  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-resolve.test.ts::test-integrity mode precedence through check() › AC-3: a stricter config raises the default and a warn input to block, with source config
  AC-4  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-resolve.test.ts::test-integrity mode precedence through check() › AC-4: a config looser than the base is ignored with exactly one message; an equal one adds none
  AC-5  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-resolve.test.ts::test-integrity mode precedence through check() › AC-5: an effective mode of off adds one info message and leaves the verdict of the block at pass
  AC-6  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-validate.test.ts::test-integrity setting validation › AC-6: a bad test_integrity.mode or an unknown key under test_integrity is a ConfigError | packages/core/test/ac-test-integrity-mode-validate.test.ts::test-integrity setting validation › AC-6: an input other than block, warn or off is an error naming the allowed values | packages/core/test/ac-test-integrity-mode-validate.test.ts::test-integrity setting validation › AC-6: surrounding whitespace is trimmed and an empty or whitespace-only input counts as not given | packages/core/test/ac-test-integrity-mode-validate.test.ts::test-integrity setting validation › AC-6: test_integrity.mode in the config is read and handed to resolveInputs as the config value
  AC-7  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-render.test.ts::renderMarkdown: the Test integrity section › AC-7: sits after Diff coverage and before Messages and Agent setup, with one fixed line per mode
  AC-8  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-render.test.ts::renderMarkdown: the Test integrity section › AC-8: with no testIntegrityMode the report JSON is the golden one and the markdown differs by only the section
  AC-9  integration  passed  delivered  packages/action/test/ac-test-integrity-mode-action.test.ts::action input test-integrity › AC-9: an input value outside block, warn and off fails the step naming the allowed values | packages/action/test/ac-test-integrity-mode-action.test.ts::action input test-integrity › AC-9: the input beats a looser .pharn/ci.yml, shows in report.json and the comment, and does not fail the step
  AC-10  integration  passed  delivered  packages/cli/test/ac-test-integrity-mode-cli.test.ts::pharn-ci check --test-integrity › AC-10: --test-integrity block gives mode block from the input, in a report that passes the v2 schema | packages/cli/test/ac-test-integrity-mode-cli.test.ts::pharn-ci check --test-integrity › AC-10: --test-integrity maybe exits 2 with nothing on stdout and the allowed values on stderr
  AC-11  unit  passed  delivered  packages/core/test/ac-test-integrity-mode-docs.test.ts::test-integrity mode: docs and schema › AC-11: action.yml declares the test-integrity input and says what it takes and that the config can only tighten | packages/core/test/ac-test-integrity-mode-docs.test.ts::test-integrity mode: docs and schema › AC-11: report.v2.json lists both new codes and report.v1.json is byte-identical to the base commit's | packages/core/test/ac-test-integrity-mode-docs.test.ts::test-integrity mode: docs and schema › AC-11: the changelog, README and threat model name the input, the config key and the tighten-only rule
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
The code paths for a new setting: `parseConfig`, `resolveInputs`, `check()`, `buildReport`, the markdown renderer, the
CLI flag table and the Action input read. Pinned-hash tests of the golden markdown were found by running the whole
suite once after the renderer change, since the plan could only estimate them.
```

### learned

```text
`ResolvedInputs.testIntegrityMode` is optional and absent when no mode is named, which keeps exact-equality tests of
`resolveInputs` untouched. Adding a section to the rendered markdown breaks every test that pins the golden markdown by
hash or lists the section headings; four of them fold the section out locally and one lists the new heading. The
`-u` regeneration needs the whole suite to run, so run it once, then check `git status` for the golden files.
One source file (`report.ts`) was patched through a Bash script instead of the Edit tool; `BUILD.md` records it.
```

### next_steps

```text
Backlog item 3: test-file detection as one function used by every signal, `TEST_FILES_DELETED` re-implemented on it as
TI01, and the unified diff parser keeping the text of added and removed lines. The new "🔍 Test integrity" section
renders a count line when `testIntegrity.signals` is non-empty; item 3 should replace that with the real finding list.
```
