# RUN REPORT — report-v2-skeleton

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
base             91b6270b6fbdac0bd09bc6fb4b950fb73958200a
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
window start       2026-10-24T23:38:49.445Z
window end         2026-10-24T23:57:56.818Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       main
excluded requests  64
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
(unattributed)  -     claude-opus-5-5    12     24               0           14296     4213184    5427             1467
pharn-build     1     claude-opus-5-5    51    102               0           84059    18263082   42121             9418
pharn-grill     -     claude-opus-5-5     4      8               0           11729     1114806    1457                0
pharn-plan      -     claude-opus-5-5    22     44               0           52998     5467272   22051             7708
pharn-spec      -     claude-opus-5-5    14     28               0           39282     2830958   10673             4574
pharn-test      -     claude-opus-5-5    14     28               0           26260     4230788   13631             2403
TOTAL           -     -                 117    234               0          228624    36120090   95360            25570
unattributed    -     -                  12     24               0           14296     4213184    5427             1467
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
  pharn-spec            -    1  126.0 s
  pharn-plan            -    1  239.5 s
  pharn-grill           -    1  21.8 s
  pharn-test            -    1  134.3 s
  pharn-build           1    1  535.3 s
  pharn-regress         1    1  1235 ms

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
  invocation f81c6cd5: start started (call 259 ms); lifetime 17.8 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner b006df: 17.5 s monotonic, 4 gate(s), ended done
    execution union: 17.5 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 17.5 s
    wait calls: 1 (20 ms green); union 20 ms foreground
    abort: nothing running
```

## Files

Changed since `91b6270b6fbdac0bd09bc6fb4b950fb73958200a`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `.github/PULL_REQUEST_TEMPLATE.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `.github/PULL_REQUEST_TEMPLATE.md` — schema checkbox names v1 and v2
  ```

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased entry for Report v2
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — current-output references move to Report v2
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — `report-path` description names Report v2
  ```

- `docs/MARKETPLACE.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/MARKETPLACE.md` — "Report v2 JSON file"
  ```

- `docs/RELEASING.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/RELEASING.md` — v0.2.0 breaking for report consumers; v1/v2 compatibility sentences
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — E1 row names the v2 schema
  ```

- `fixtures/coverage-paths/package-relative/report-warn.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report-warn.json` — re-pinned to v2
  ```

- `fixtures/coverage-paths/package-relative/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.json` — re-pinned to v2
  ```

- `fixtures/coverage-paths/package-relative/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/coverage-paths/package-relative/report.md` — re-pinned footer
  ```

- `fixtures/golden-cobertura/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.json` — regenerated v2 golden
  ```

- `fixtures/golden-cobertura/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-cobertura/report.md` — regenerated footer
  ```

- `fixtures/golden-exclusions/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.json` — regenerated v2 golden
  ```

- `fixtures/golden-exclusions/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-exclusions/report.md` — regenerated footer
  ```

- `fixtures/golden-multi/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.json` — regenerated v2 golden
  ```

- `fixtures/golden-multi/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden-multi/report.md` — regenerated footer
  ```

- `fixtures/golden/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.json` — regenerated v2 golden
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated footer
  ```

- `fixtures/setup-expect/report-files-missing.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/setup-expect/report-files-missing.json` — re-pinned to v2
  ```

- `fixtures/setup-expect/report-no-files-missing.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/setup-expect/report-no-files-missing.json` — re-pinned to v2
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (AGENTS.md rule 7)
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — `ActionContext` gains run fields; `meta` passed into `check()`
  ```

- `packages/cli/test/ac-coverage-format.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/ac-coverage-format.test.ts` — `schemaVersion` expected to be 2
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — `CheckInput.meta` passed through; doc comment
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — re-export the new report types (`ReportTestIntegrity`, `TestIntegritySignal`, `ReportMeta`)
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — v2 types, `schemaVersion: 2`, `testIntegrity` default, optional `meta`
  ```

- `packages/core/src/version.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/version.ts` — doc comment names Report v2
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated footer
  ```

- `packages/core/test/ac-comment-bold-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-data.test.ts` — added during build (iteration 1): its v1-era golden JSON hash is kept, compared after mapping the v2 golden back to its v1 shape
  ```

- `packages/core/test/ac-comment-bold-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-bold-footer.test.ts` — footer expects `report schema v2`
  ```

- `packages/core/test/ac-comment-look-footer.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-comment-look-footer.test.ts` — footer expects `report schema v2`
  ```

- `packages/core/test/ac-format-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-format-golden.test.ts` — footer expects `report schema v2`
  ```

- `packages/core/test/ac-header-logo-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-header-logo-data.test.ts` — added during build (iteration 1): same v1-shape mapping before its pinned hash
  ```

- `packages/core/test/ac-header-logo-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-header-logo-golden.test.ts` — added during build (iteration 1): footer mapped back to `report schema v1` before its pinned hash
  ```

- `packages/core/test/ac-paths-partial.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-paths-partial.test.ts` — added during build (iteration 1): v1-shape mapping of JSON and footer before its pinned hashes
  ```

- `packages/core/test/ac-verdict-callout-data.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-verdict-callout-data.test.ts` — added during build (iteration 1): same v1-shape mapping before its pinned hash
  ```

- `packages/core/test/ac-verdict-callout-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-verdict-callout-golden.test.ts` — added during build (iteration 1): footer mapped back before its pinned hashes
  ```

- `packages/core/test/exclusions-golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/exclusions-golden.test.ts` — title names Report v2
  ```

- `packages/core/test/exclusions-report.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/exclusions-report.test.ts` — `BASE_REPORT` becomes a v2 literal
  ```

- `packages/core/test/golden.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/golden.test.ts` — title names Report v2
  ```

- `packages/core/test/schema.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/schema.ts` — validator compiles v2 (with v1 added); `validateReportV1` kept
  ```

- `.codex/hooks.json` — _not named in PLAN ## Files_
- `.codex/hooks/enforce-writes-scope.cjs` — _not named in PLAN ## Files_
- `.codex/hooks/protect-trusted-paths.cjs` — _not named in PLAN ## Files_
- `.codex/hooks/require-loop-record.cjs` — _not named in PLAN ## Files_
- `.codex/hooks/set-writes-scope.cjs` — _not named in PLAN ## Files_
- `packages/action/src/run-meta.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run-meta.ts` — new: pure `runMeta()` builder for the report's `meta`
  ```

- `packages/action/test/ac-report-v2-meta.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-report-v2-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-report-v2-check.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-report-v2-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-report-v2-golden.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-report-v2-schema.test.ts` — _not named in PLAN ## Files_
- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — new: the published Report v2 schema
  ```

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
The regress refusal was traced to an untracked `.codex/` directory (Codex hook config plus four hook scripts with
October mtimes). It appeared mid-run, while the Codex desktop app was starting. None of this run's builds, gates or
scripts write under `.codex/`. All 752 tests, lint and build passed on the build's tree before regress ran.
```

### learned

```text
`/pharn-regress` counts any new path outside the plan's scope as a build escape, including one another tool writes
into the checkout during the run. In this environment the Agent tool launched stage agents in the background, so
every routed stage ran inline. The plan missed six earlier AC tests that pin sha256 hashes of the v1 golden files.
A report version change touches every hash-pinned golden test, not only the snapshot owners.
```

### next_steps

```text
A person decides what `.codex/` is: keep it out of this checkout, ignore it, or commit it. Then re-approve the
SPEC and re-run `/pharn-regress` and `/pharn-verify` on this tree, or re-run `/pharn-loop` for item 1 from a
clean checkout with the six hash-pinned tests declared in the plan up front.
```
