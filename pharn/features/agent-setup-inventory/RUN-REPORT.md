# RUN REPORT — agent-setup-inventory

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
decision         STOP_TERMINAL
iterations       1
blocked          none
base             e546f912022443757bae015a618da1fc8076f4fa
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
window start       2026-10-12T18:32:51.975Z
window end         2026-10-12T18:50:28.421Z
selected session   cc1d5017-6a5e-4e64-a6d2-cdb06aaf4640
run context        agent:a99016b419dbf5791
run contexts       agent:a588fa5ea95e3638a, agent:a64a325c5534521b5, agent:a928ae76492b14f60, agent:a99016b419dbf5791, agent:ae0b7ef934a9fbe33
excluded requests  495
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
(unattributed)  -     claude-opus-5-5      25     50           40203               0     3100585    2292              249
pharn-build     1     claude-opus-5-5       2      4            2222               0      242320      32                0
pharn-build     1     claude-sonnet-5-5    28     56          106548               0     3243317   11250              454
pharn-grill     -     claude-opus-5-5       5     10           10865               0      557988      72                0
pharn-plan      -     claude-opus-5-5      24     48          123494               0     2750334   13531             4264
pharn-spec      -     claude-opus-5-5      22     44           87573               0     2087240    8521             2683
pharn-test      -     claude-opus-5-5      24     48          104205               0     2609073   10668             1120
TOTAL           -     -                   130    260          475110               0    14590857   46366             8770
unattributed    -     -                    25     50           40203               0     3100585    2292              249
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
  pharn-spec            -    1  217.3 s
  pharn-plan            -    1  310.1 s
  pharn-grill           -    1  19.2 s
  pharn-test            -    1  189.5 s
  pharn-build           1    1  172.5 s
  pharn-regress         1    1  8080 ms
  pharn-verify          1    1  5513 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 652 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation b577660c: start started (call 299 ms); lifetime 5992 ms (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner ab28ff: 5652 ms monotonic, 4 gate(s), ended done
    execution union: 5652 ms
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 168 ms
    wait calls: 1 (18 ms green); union 18 ms foreground
    abort: nothing running
```

## Files

Changed since `e546f912022443757bae015a618da1fc8076f4fa`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased lines for kinds, nested matching, summary
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — inventory bullet, kinds table, sample comment summary line
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — §4 detected kinds, nested vs root-only, precedence
  ```

- `fixtures/golden/report.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.json` — regenerated: gains `agentSetup.summary`
  ```

- `fixtures/golden/report.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/golden/report.md` — regenerated: gains the summary line
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (core is bundled into the action)
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — export the new public API
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — summary line, `<details>` collapse above 25 files
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — `agentSetup.summary` type and its computation in `buildReport`
  ```

- `packages/core/src/setup/scan.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/setup/scan.ts` — 10 new kinds, exported ordered `SETUP_RULES`, nested matching, precedence
  ```

- `packages/core/test/__snapshots__/markdown.test.ts.snap`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: no-coverable-changes snapshot gains the summary line
  ```

- `packages/core/test/scan.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/scan.test.ts` — two former non-matches corrected to their new kinds
  ```

- `schema/report.v1.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v1.json` — optional `agentSetup.summary`, `$defs.agentSetupSummary`, kind description
  ```

- `.pharn/cost/agent-setup-inventory/entry.jsonl` — _not named in PLAN ## Files_
- `.pharn/cost/agent-setup-inventory/markers.jsonl` — _not named in PLAN ## Files_
- `.pharn/cost/agent-setup-inventory/work.jsonl` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full.times.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/1-lint.err` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/1-lint.out` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/2-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/2-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/full/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targeted.times.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targeted/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targeted/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targeted/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targeted/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-build/agent-setup-inventory/targets.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/base-tests.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/0-lint.err` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/0-lint.out` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/1-base_test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/2-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/3-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/3-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/progress.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/result.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/runner.json` — _not named in PLAN ## Files_
- `.pharn/pharn-entry/runner.log` — _not named in PLAN ## Files_
- `.pharn/pharn-loop/agent-setup-inventory/active.json` — _not named in PLAN ## Files_
- `.pharn/pharn-loop/agent-setup-inventory/pre-run-status.txt` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/1-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/1-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/base-gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head-install.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/1-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/1-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/head/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/install.err` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/install.out` — _not named in PLAN ## Files_
- `.pharn/pharn-regress/scope.json` — _not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-test/gates/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-test/gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/0-test.test-results.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/1-lint.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/1-lint.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/2-build.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/2-build.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/3-instruction-growth.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/3-instruction-growth.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/4-reconcile.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/4-reconcile.out` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/completeness.err` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/completeness.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/gates/stamp.json` — _not named in PLAN ## Files_
- `.pharn/pharn-verify/head-install.json` — _not named in PLAN ## Files_
- `.pharn/reconcile/baseline.json` — _not named in PLAN ## Files_
- `.pharn/writes-scope.json` — _not named in PLAN ## Files_
- `fixtures/setup/all-kinds.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/setup/all-kinds.txt` — new: representative path per rule for the AC-7 test
  ```

- `packages/core/src/setup/summary.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/setup/summary.ts` — new: `AGENT_TOOLS`, kind→tools table, `summarizeAgentSetup`
  ```

- `packages/core/test/ac-setup-classify.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-setup-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-setup-rules.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-setup-summary.test.ts` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/cost.json` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/agent-setup-inventory/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 1 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- verify: `FAIL`

  failing_gates, quoted as DATA:

  ```text
  reconcile
  ```

- reconcile — why the gate failed:

  reconcile: `ESCAPE` (exit 1) — read from check-bash-reconcile.mjs's own JSON document, as the gate recorded it.

  **54 escape(s)** — a path changed since the anchor that the write guards would have denied. Closed reasons (over the 20 shown): no closed reason ×20.

  each escape — file, denied_by, reason, scope_set_by — JSON-quoted as DATA:

  ```text
  ".pharn/cost/agent-setup-inventory/markers.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/cost/agent-setup-inventory/work.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/1-lint.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/1-lint.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/2-build.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/2-build.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/full/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targeted.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targeted/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targeted/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targeted/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targeted/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-build/agent-setup-inventory/targets.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ".pharn/pharn-regress/base-gates/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/agent-setup-inventory/PLAN.md"
  ```

  … and 34 more escape(s) not listed. Re-run `node pharn/floor/check-bash-reconcile.mjs --base . --require-baseline` to see the escapes — before any new build re-anchors the baseline, which erases them.

- acceptance criteria: `PASS` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-1: classifies CLAUDE.local.md and GEMINI.md at the root and nested
  AC-2  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-2: classifies scoped Copilot instructions, custom agents and prompt files
  AC-3  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-3: classifies editor MCP configs, Codex, Windsurf and Cline files, root only
  AC-4  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-4: classifies .mcp.json, .claude/ kinds and .cursor/rules/ in nested directories
  AC-5  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-5: keeps every previous match and non-match, decided by the first matching rule
  AC-6  unit  passed  delivered  packages/core/test/ac-setup-classify.test.ts::agent setup classification (agent-setup-inventory) › AC-6: lets the more specific directory rule win over a file-name rule
  AC-7  unit  passed  delivered  packages/core/test/ac-setup-rules.test.ts::agent setup rule table (agent-setup-inventory) › AC-7: matches every fixture path with exactly one rule and scans all 21 kinds
  AC-8  unit  passed  delivered  packages/core/test/ac-setup-summary.test.ts::agent setup summary (agent-setup-inventory) › AC-8: adds agentSetup.summary for the golden inputs and validates against the schema
  AC-9  unit  passed  delivered  packages/core/test/ac-setup-summary.test.ts::agent setup summary (agent-setup-inventory) › AC-9: maps each kind to its agent tools
  AC-10  unit  passed  delivered  packages/core/test/ac-setup-summary.test.ts::agent setup summary (agent-setup-inventory) › AC-10: reports an empty summary and no summary line when there are no agent setup files
  AC-11  unit  passed  delivered  packages/core/test/ac-setup-render.test.ts::agent setup rendering (agent-setup-inventory) › AC-11: shows the summary line above the agent setup table for the golden inputs
  AC-12  unit  passed  delivered  packages/core/test/ac-setup-render.test.ts::agent setup rendering (agent-setup-inventory) › AC-12: uses the singular for a one-file inventory
  AC-13  unit  passed  delivered  packages/core/test/ac-setup-render.test.ts::agent setup rendering (agent-setup-inventory) › AC-13: collapses the table in a details block above 25 files and keeps the 50-row limit
  AC-14  unit  passed  delivered  packages/core/test/ac-setup-summary.test.ts::agent setup summary (agent-setup-inventory) › AC-14: accepts a report without a summary and rejects an unknown tool or a string count
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
The reconcile escapes were listed with `check-bash-reconcile.mjs --base . --require-baseline` and grouped by
directory. All of them are PHARN run-state files under `.pharn/` (cost, pharn-build, pharn-regress, pharn-verify,
reconcile). No product file escaped the plan's `## Files`.
```

### learned

```text
In this git worktree, verify's reconcile gate counts PHARN's own `.pharn/` run state, written by the floor scripts
during build, regress and verify, as escapes from the build's writes-scope. This turns an otherwise green
iteration (AC gate PASS, regress no-regressions, all project gates green) into a terminal stop.
```

### next_steps

```text
A person reviews the working-tree changes and BUILD.md, and decides whether `.pharn/` run state should be exempt
from the reconcile gate. If it should, re-run, or commit the change by hand after reviewing it. The SPEC is still
model-approved: either revert it to Draft or approve it yourself.
```
