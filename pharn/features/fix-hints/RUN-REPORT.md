# RUN REPORT — fix-hints

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
base             7d88076280ec86435c3f84ad3c6102e272ab64d5
command          /pharn-loop
skills_version   7.3.0
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
window start       2026-11-08T08:48:21.940Z
window end         2026-11-08T10:58:45.248Z
selected session   f8256de8-74a0-4ccc-9354-a3b19cd37e88
run context        main
run contexts       agent:a6e461562a2f966c2, agent:a815bc096920b9d87, agent:aa5bba857e40d80b4, agent:acbf12db8ffde3212, main
excluded requests  2205
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
(unattributed)  -     claude-opus-5-5      36     74               0           45297     5817152   13777             3392
(unattributed)  -     claude-sonnet-5-5     3      6               0             908      521510     896              383
pharn-build     1     claude-opus-5-5       6     12             176            4731     1063859    3250                0
pharn-build     1     claude-sonnet-5-5   169    338          529124               0    55154399  154080            34277
pharn-grill     -     claude-opus-5-5       4     10             175           14225      691302    2999                0
pharn-plan      -     claude-fable-5-1      1     33             182               0      146033    1598                0
pharn-plan      -     claude-opus-5-5     115    230          285389           65593    20710561   78754            34510
pharn-plan      -     claude-sonnet-5-5     5     10               0            5553      884354    2047              538
pharn-regress   1     claude-opus-5-5       3      6               0            7442      502144    2775             2092
pharn-regress   1     claude-sonnet-5-5     1      2             583               0      529124    1321                0
pharn-spec      -     claude-fable-5-1     20    628          146033               0     2117642   23772             8436
pharn-spec      -     claude-sonnet-5-5     2      4               0            1362      346603     578                0
pharn-test      -     claude-opus-5-5      86    172          256816            1341    15178997   73315            18399
pharn-verify    1     claude-opus-5-5       1      2               0             616      175098     337                0
TOTAL           -     -                   452   1527         1218478          147068   103838778  359499           102027
unattributed    -     -                    39     80               0           46205     6338662   14673             3775
```

**Always-loaded instruction set — an ESTIMATE, not a measurement.**

~2019 tokens (8076 bytes over 2 file(s)), taken once at the run's start by `pharn/floor/check-instruction-files.mjs --report`. The figure is bytes / 4 (`pharn/LIMITS.md §1c`) over that checker's
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
  pharn-spec            -    1  457.7 s
  pharn-plan            -    1  2264.2 s
  pharn-grill           -    1  18.9 s
  pharn-test            -    1  832.7 s
  pharn-build           1    1  2089.7 s
  pharn-regress         1    1  278.2 s
  pharn-verify          1    1  168.1 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 743 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 5d518d3f: start started (call 911 ms); lifetime 312.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 20ce0a: 311.7 s monotonic, 4 gate(s), ended done
    execution union: 311.7 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 305.2 s
    wait calls: 2 (46 ms red; 100 ms red); union 145 ms foreground
  invocation 2c6fb236: start started (call 703 ms); lifetime 590.0 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner e42a51: 589.3 s monotonic, 4 gate(s), ended done
    execution union: 589.3 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 2 (569.8 s continue; 5243 ms red); union 575.1 s foreground
  invocation 0631d513: start started (call 1768 ms); lifetime 537.3 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 5e46e5: 535.5 s monotonic, 4 gate(s), ended done
    execution union: 535.5 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 1 (535.7 s green); union 535.7 s foreground
```

## Files

Changed since `7d88076280ec86435c3f84ad3c6102e272ab64d5`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

1 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased line for the `fix` object
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — `### Fix hints` subsection under Report v2
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — `## Fix hints` section
  ```

- `fixtures/coverage-paths/package-relative/report-warn.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report-warn.json` — regenerated: `fix` on each message
  ```

- `fixtures/coverage-paths/package-relative/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.json` — regenerated: `fix` on each message
  ```

- `fixtures/golden-cobertura/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.json` — regenerated: `fix` on each message
  ```

- `fixtures/golden-multi/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.json` — regenerated: `fix` on each message
  ```

- `fixtures/golden/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.json` — regenerated: `fix` on each message
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`)
  ```

- `packages/action/test/ac-accept-signoff-default-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-accept-signoff-default-golden.test.ts` — re-pin (digest/golden)
  ```

- `packages/action/test/ac-accept-signoff-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-accept-signoff-regression.test.ts` — re-pin (digest/golden)
  ```

- `packages/action/test/ac-policy3-outcomes.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-policy3-outcomes.test.ts` — re-pin (literal)
  ```

- `packages/action/test/ac-polset-action.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-polset-action.test.ts` — re-pin (literal)
  ```

- `packages/action/test/ac-pyparity2-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-pyparity2-unchanged.test.ts` — re-pin (schema, fixtures)
  ```

- `packages/action/test/ac-upload-url-failures.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/ac-upload-url-failures.test.ts` — re-pin (literal)
  ```

- `packages/action/test/setup-sizes.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/setup-sizes.test.ts` — re-pin (literal)
  ```

- `packages/action/test/stale-instructions-action.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/test/stale-instructions-action.test.ts` — re-pin (literal)
  ```

- `packages/cli/test/ac-inventory-empty.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/ac-inventory-empty.test.ts` — re-pin (literal)
  ```

- `packages/cli/test/ac-polset-cli.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/ac-polset-cli.test.ts` — re-pin (literal)
  ```

- `packages/cli/test/stale-instructions-cli.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/stale-instructions-cli.test.ts` — re-pin (literal)
  ```

- `packages/core/src/acceptLabel.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/acceptLabel.ts` — the messages it rebuilds or adds get `fix` through `withMessageFix`
  ```

- `packages/core/src/dependencies/types.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/types.ts` — `fix?` on `DependencySignal`
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export the fix table, types and helpers
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — `fix?` on the message and finding types; `buildReport` returns `withFixHints(...)`
  ```

- `packages/core/src/upload/outcome.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/upload/outcome.ts` — `UPLOAD_TOO_LARGE` gets `fix` through `withMessageFix`
  ```

- `packages/core/test/ac-comment-bold-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-data.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-globs-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-globs-check.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-header-logo-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-header-logo-data.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-name-only-suite.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-name-only-suite.test.ts` — re-pin (digest/golden, fixtures)
  ```

- `packages/core/test/ac-p07-schema-hints.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p07-schema-hints.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-p07-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p07-unchanged.test.ts` — re-pin (fixtures)
  ```

- `packages/core/test/ac-p11-agent-vs-human.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-agent-vs-human.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p11-diff-kinds.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-diff-kinds.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p11-diff-unavailable.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-diff-unavailable.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p11-incomplete.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-incomplete.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p11-policy-file-base.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-policy-file-base.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p11-schema-hints.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-schema-hints.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-p11-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p11-unchanged.test.ts` — re-pin (fixtures)
  ```

- `packages/core/test/ac-p14-caps.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p14-caps.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-p14-policy-file.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-p14-policy-file.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-policy3-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-policy3-unchanged.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-polrules-p01-expect.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p01-expect.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p01-require.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p01-require.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p08-forbidden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p08-forbidden.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p09-config.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p09-config.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p09-policy-file.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p09-policy-file.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p09-settings.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p09-settings.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p09-workflow.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p09-workflow.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-p10.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-p10.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polrules-report.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polrules-report.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-absent.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-absent.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-budget.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-budget.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-duplicate-deny.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-duplicate-deny.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-messages.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-messages.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p02-allow.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p02-allow.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p02-fixed.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p02-fixed.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p03.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p03.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p04.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p04.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p05.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p05.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p06.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p06.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-p09.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-p09.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-polset-pins.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-pins.test.ts` — re-pin (UNCHANGED list, golden fixtures)
  ```

- `packages/core/test/ac-polset-unavailable.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-polset-unavailable.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-precision-v030-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-precision-v030-schema.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-py-index-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-py-index-docs.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-pyparity2-ti09-headers.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-pyparity2-ti09-headers.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-report-v2-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-report-v2-check.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-secrets-repin.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-secrets-repin.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-test-integrity-mode-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-test-integrity-mode-render.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/ac-test-sources-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-test-sources-docs.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-ti01-unparsed.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti01-unparsed.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-ti0102-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti0102-regression.test.ts` — re-pin (digest)
  ```

- `packages/core/test/ac-ti0205-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti0205-regression.test.ts` — re-pin (digest)
  ```

- `packages/core/test/ac-ti0304-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti0304-regression.test.ts` — re-pin (digest)
  ```

- `packages/core/test/ac-ti06-ti12-unchanged.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti06-ti12-unchanged.test.ts` — re-pin (digest)
  ```

- `packages/core/test/ac-ti07-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti07-schema.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-ti081516-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti081516-docs.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-ti09-opaque-head.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti09-opaque-head.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-ti1013-regression.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti1013-regression.test.ts` — re-pin (digest)
  ```

- `packages/core/test/ac-unparseable-cases.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-unparseable-cases.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-unread-added.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-unread-added.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-upload-outcome.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-upload-outcome.test.ts` — re-pin (literal)
  ```

- `packages/core/test/ac-upload-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-upload-schema.test.ts` — re-pin (schema)
  ```

- `packages/core/test/ac-verdict-callout-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-verdict-callout-data.test.ts` — re-pin (digest/golden)
  ```

- `packages/core/test/dependencies-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/dependencies-check.test.ts` — re-pin (literal)
  ```

- `packages/core/test/dependencies-registry.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/dependencies-registry.test.ts` — re-pin (literal)
  ```

- `packages/core/test/docs-schema-levels.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/docs-schema-levels.test.ts` — re-pin (schema)
  ```

- `packages/core/test/golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/golden.test.ts` — re-pin (literal)
  ```

- `packages/core/test/injection-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/injection-check.test.ts` — re-pin (literal)
  ```

- `packages/core/test/injection-policy.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/injection-policy.test.ts` — re-pin (literal)
  ```

- `packages/core/test/injection-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/injection-schema.test.ts` — re-pin (schema)
  ```

- `packages/core/test/report-unsafe-chars.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/report-unsafe-chars.test.ts` — re-pin (literal)
  ```

- `packages/core/test/report.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/report.test.ts` — re-pin (literal)
  ```

- `packages/core/test/setup-sizes.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/setup-sizes.test.ts` — re-pin (literal)
  ```

- `packages/core/test/stale-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/stale-check.test.ts` — re-pin (literal)
  ```

- `packages/core/test/stale-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/stale-docs.test.ts` — re-pin (schema)
  ```

- `packages/core/test/threshold-semantics.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/threshold-semantics.test.ts` — re-pin (literal)
  ```

- `packages/node-io/test/ac-ti07-moved.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/node-io/test/ac-ti07-moved.test.ts` — re-pin (digest)
  ```

- `pharn.config.json` — _dirty-before-run; not named in PLAN ## Files_
- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — `$defs.fix` and six optional `fix` properties
  ```

- `packages/action/test/ac-fix-hints-action.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-fix-hints-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/fix/attach.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/fix/attach.ts` — new: `fixTarget`, `messageFix`, `withMessageFix`, `withFixHints`
  ```

- `packages/core/src/fix/table.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/fix/table.ts` — new: the eight kinds, the `FixKind`/`FixEntry`/`FixHint`/`FixSignalId` types, `SIGNAL_FIXES` and `MESSAGE_FIXES`
  ```

- `packages/core/test/ac-fix-hints-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-findings.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-kinds.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-mapping.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-messages.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-no-leak.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-pins.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-schema.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-table.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-upload.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-fix-hints-words.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/v090-codes.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/v090-codes.ts` — new shared re-pin helper: `withoutV090SchemaEdits`, `withoutFix`, `withoutFixJson`
  ```

- `pharn/features/fix-hints/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/cost.json` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/fix-hints/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- isolation: HOST (host execution accepted by operator)

- verify: `FAIL`

  failing_gates, quoted as DATA:

  ```text
  ac-delivery
  test
  ```

- acceptance criteria: `FAIL` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  unit  passed  delivered  packages/core/test/ac-fix-hints-kinds.test.ts::fix hints: the closed list of kinds › AC-1: the core's FIX_KINDS and the schema's fix.kind enum are exactly the eight kinds, in order
  AC-2  unit  passed  delivered  packages/core/test/ac-fix-hints-table.test.ts::fix hints: a table entry for every documented code and signal id › AC-2: every message code the schema documents has an entry with a closed kind and a non-empty hint of at most 200 characters | packages/core/test/ac-fix-hints-table.test.ts::fix hints: a table entry for every documented code and signal id › AC-2: every signal id the schema documents (TI01-TI16, the P ids core produces, SI01-SI04, PI01-PI05, D01-D05) has an entry with a closed kind and a non-empty hint of at most 200 characters
  AC-3  unit  passed  delivered  packages/core/test/ac-fix-hints-words.test.ts::fix hints: the words a hint may use › AC-3: no hint contains a placeholder: the path, line and id of a finding go only into target | packages/core/test/ac-fix-hints-words.test.ts::fix hints: the words a hint may use › AC-3: no hint contains exclude, excluding, exclusion, lower, skip, threshold, ignore, disable, exempt or exemption (case-insensitive, word boundaries)
  AC-4  unit  passed  delivered  packages/core/test/ac-fix-hints-mapping.test.ts::fix hints: the kind of every code and signal id › AC-4: every message code has the kind of the SPEC's Data mapping, each signal-family message the kind of its signal, and the table has no other code | packages/core/test/ac-fix-hints-mapping.test.ts::fix hints: the kind of every code and signal id › AC-4: every signal id has the kind of the SPEC's Data mapping, and the table has no other id | packages/core/test/ac-fix-hints-mapping.test.ts::fix hints: the kind of every code and signal id › AC-4: the named cases of the criterion
  AC-5  integration  passed  delivered  packages/core/test/ac-fix-hints-findings.test.ts::fix hints on every finding of a report › AC-5: dependency signals D04 and D05 carry the table's kind and hint and path:line as target | packages/core/test/ac-fix-hints-findings.test.ts::fix hints on every finding of a report › AC-5: prompt-injection signals carry the table's kind and hint and path:line as target | packages/core/test/ac-fix-hints-findings.test.ts::fix hints on every finding of a report › AC-5: stale-instruction findings carry the table's kind and hint and path:line as target | packages/core/test/ac-fix-hints-findings.test.ts::fix hints on every finding of a report › AC-5: test-integrity signals (TI01, TI05, TI14, TI11) carry the table's kind and hint and their path or path:line as target; the reports validate | packages/core/test/ac-fix-hints-findings.test.ts::fix hints on every finding of a report › AC-5: the P11 and P14 violations of an agent pull request carry the table's kind and hint, and their path or path:line as target
  AC-6  integration  passed  delivered  packages/core/test/ac-fix-hints-messages.test.ts::fix hints on every message of a report › AC-6: a message whose code has no honest action still carries a none fix with a non-empty hint | packages/core/test/ac-fix-hints-messages.test.ts::fix hints on every message of a report › AC-6: every message carries fix with the table's kind and hint for its code and no target | packages/core/test/ac-fix-hints-messages.test.ts::fix hints on every message of a report › AC-6: the TEST_INTEGRITY_<id> message of each signal id present carries fix with its signal's kind
  AC-7  integration  passed  delivered  packages/core/test/ac-fix-hints-no-leak.test.ts::fix hints never carry file text, diff text, test names or package names › AC-7: a test name and an added line holding a unique token and a secret-shaped string never reach fix.hint or fix.target; two TI03 findings differ in fix only by target | packages/core/test/ac-fix-hints-no-leak.test.ts::fix hints never carry file text, diff text, test names or package names › AC-7: the names of the packages a change adds never reach fix.hint or fix.target; three D05 findings differ in fix only by target
  AC-8  unit  passed  delivered  packages/core/test/ac-fix-hints-schema.test.ts::schema/report.v2.json: the optional fix object › AC-8: every required list is unchanged from the base commit, a report without fix still validates, and schema/report.v1.json is byte-identical to the base commit | packages/core/test/ac-fix-hints-schema.test.ts::schema/report.v2.json: the optional fix object › AC-8: the message definition and the five finding item schemas each carry an optional, closed fix object with required kind and hint, optional target, kind the closed enum and hint at most 200 characters, each described as never lowering a gate
  AC-9  integration  passed  delivered  packages/cli/test/ac-fix-hints-golden.test.ts::the goldens with fix hints › AC-9: pharn-ci check --format json on each golden fixture equals its regenerated report.json, every message carries fix, and every golden markdown is byte-identical to the base commit
  AC-10  unit  passed  delivered  packages/core/test/ac-fix-hints-upload.test.ts::the upload bundle keeps fix hints › AC-10: the bundle's report.json carries every fix unchanged in kind, target and hint, through redaction and the byte caps, and validates
  AC-11  integration  passed  delivered  packages/action/test/ac-fix-hints-action.test.ts::the Action and the CLI write fix hints › AC-11: the Action on a streamed local diff and lcov, and the CLI on the same inputs, both equal the regenerated golden report, carry fix on every message, and make no compare API call
  AC-12  integration  failed  ac-not-passed  packages/core/test/ac-fix-hints-pins.test.ts::existing tests are re-pinned through one shared helper, never weakened › AC-12: no existing test file is deleted, none gains a skip, focus or todo marker, every edited one names fix-hints (H6), the helper is shared, and every edited test passes in a child run | packages/core/test/ac-fix-hints-pins.test.ts::existing tests are re-pinned through one shared helper, never weakened › AC-12: withoutV090SchemaEdits takes out exactly the fix additions, giving the base commit's schema byte for byte, and withoutFix takes the fix objects out of a report
  AC-13  unit  passed  delivered  packages/core/test/ac-fix-hints-docs.test.ts::documentation of fix hints › AC-13: docs/LIMITS.md has a section on fix hints saying they are generic, per code or id, and never prove that the fix was made or was right | packages/core/test/ac-fix-hints-docs.test.ts::documentation of fix hints › AC-13: the CHANGELOG Unreleased section names the fix object | packages/core/test/ac-fix-hints-docs.test.ts::documentation of fix hints › AC-13: the README has a section headed "Fix hints" that lists the eight kinds, says what an agent may do with a hint and states that no hint lowers a gate | packages/core/test/ac-fix-hints-docs.test.ts::documentation of fix hints › AC-13: the schema's descriptions of fix, kind, target and hint say what each holds and never holds
  note  an AC is delivered = a locked, once-red test titled AC-<n>:, in a file mapped to AC-<n>, passed on this head run. PHARN does not judge whether that test fully captures the AC's intent.
  ```

- regress: `regressions`

  regressions, quoted as DATA:

  ```text
  test
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
The entry-gate red was traced to the host's stale `node_modules` and a stale dist bundle, not to the code at
7d88076: run alone after `pnpm install --frozen-lockfile`, the suite passed 2882/2882. The AC-12 failure was checked
by hand: the directory pathspec yields 0 paths and the glob pathspec yields 86.
```

### learned

```text
A plan that re-pins many tests must also list every test that pins those tests' own digests (here
`ac-ti09y-regression`'s `PINNED` map); the plan's suite probe missed it because it ran with placeholder edits. A git
pathspec with a wildcard and no trailing `/*` does not match the files under a directory.
```

### next_steps

```text
A person (or the main session, as a small direct change) fixes the AC-12 pathspec to `packages/*/test/*`, updates
the two digests in `ac-ti09y-regression.test.ts`'s `PINNED` map, re-runs `pnpm lint`, `pnpm test` and `pnpm build`,
and opens the PR `feat(core): machine-readable fix hints on every signal and message (H6)` from the working tree.
```
