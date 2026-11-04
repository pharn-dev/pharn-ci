# RUN REPORT — accept-label-human-signoff-4

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
base             a1089fdeaddbf166996856eb59b632adc2d93827
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
window start       2026-10-25T06:19:50.834Z
window end         2026-10-25T06:52:35.541Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:aa2b69b553b27b852, agent:aad5bb31c44602434, agent:ae24113dad7e9acf1, agent:afb4528bf7626d1bf, main
excluded requests  1233
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
(unattributed)  -     claude-opus-5-5       7     14               0            9503     2398875    3660              311
pharn-build     1     claude-opus-5-5       4      8               0            2122     1364449    1026               66
pharn-build     1     claude-sonnet-5-5    55    110          265738               0    10653389   49397            13357
pharn-grill     -     claude-opus-5-5       2      4               0            1807      665023    1592               25
pharn-plan      -     claude-opus-5-5      25     50          108274            5131     3409701   21150             1965
pharn-regress   1     claude-opus-5-5       1      2               0             593      345016     246                0
pharn-spec      -     claude-opus-5-5      21     42           74596            4654     2632115   17060             1183
pharn-test      -     claude-opus-5-5      90    180          242217            2080    17880072   99045            36518
TOTAL           -     -                   205    410          690825           25890    39348640  193176            53425
unattributed    -     -                     7     14               0            9503     2398875    3660              311
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
  pharn-spec            -    1  157.9 s
  pharn-plan            -    1  215.9 s
  pharn-grill           -    1  17.3 s
  pharn-test            -    1  983.2 s
  pharn-build           1    1  459.6 s
  pharn-regress         1    1  53.2 s
  pharn-verify          1    1  28.3 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 1622 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 9ffda56b: start started (call 344 ms); lifetime 25.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 36633b: 25.3 s monotonic, 4 gate(s), ended done
    execution union: 25.3 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 25.3 s
    wait calls: 1 (178 ms green); union 178 ms foreground
```

## Files

Changed since `a1089fdeaddbf166996856eb59b632adc2d93827`, plus untracked files. **This is a changed-since-base observation, not a
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
  - `README.md` — input row, accept-label subsection, message codes, token permission
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — the `accept-label` input; `github-token` description names the issue-events read
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — sign-off not tied to a commit; over 1,000 events not read
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — issue-events read, fail-closed, bot/author rules, page cap, input in the PR-editable workflow
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/action/src/api.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/api.ts` — `getPullRequestSignoff` and `listIssueEvents` (read-only)
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — `GitHubApi` gains the two methods; `accept-label` validated first; accept step after `check()`
  ```

- `packages/cli/test/ac-ti0304-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/ac-ti0304-render.test.ts` — superseded TI03 hint assertions ("not `pharn/accepted`") replaced; TI04 keeps its check; reason in a comment and BUILD.md
  ```

- `packages/cli/test/ac-ti1013-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/test/ac-ti1013-render.test.ts` — superseded TI10/TI13 hint assertions ("ships", "not `pharn/accepted`") replaced; reason in a comment and BUILD.md
  ```

- `packages/core/src/config.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/config.ts` — `test_integrity.accept_label` rejected with an error pointing at the `accept-label` input
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — exports of the new module and helper
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — label-aware TI03/TI10/TI13 hints, `labelSpan`, accepted line, hints for the two new codes
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — two message codes, optional `testIntegrity.acceptLabel`, exported `testIntegritySignalMessages` helper used by `buildReport`
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — `testIntegrity.acceptLabel`, the two codes documented, descriptions extended
  ```

- `fixtures/accept-label/block.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/block.diff` — the concatenation of `fixtures/test-integrity/TI10/block-or-true.diff` and `fixtures/test-integrity/TI13/block-istanbul-next.diff` (TI10 and TI13 block in mode block)
  ```

- `fixtures/accept-label/events-applied-twice-author-last.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-applied-twice-author-last.json` — `labeled` by `Reviewer-1`, `unlabeled` by `octo-author`, `labeled` by `octo-author` (all `pharn/accepted`, User)
  ```

- `fixtures/accept-label/events-applied-twice-reviewer-last.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-applied-twice-reviewer-last.json` — `labeled` by `octo-author`, `unlabeled` by `octo-author`, `labeled` by `Reviewer-1` (all `pharn/accepted`, User)
  ```

- `fixtures/accept-label/events-author.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-author.json` — `labeled` `pharn/accepted` by `OCTO-Author` (User)
  ```

- `fixtures/accept-label/events-bot.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-bot.json` — `labeled` `pharn/accepted` by `claude[bot]` (Bot)
  ```

- `fixtures/accept-label/events-hostile-login.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-hostile-login.json` — `labeled` `pharn/accepted` by `a<b>c` (User)
  ```

- `fixtures/accept-label/events-human.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-human.json` — `labeled` `bug` by `octo-author` (User), then `labeled` `pharn/accepted` by `Reviewer-1` (User)
  ```

- `fixtures/accept-label/events-no-actor.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-no-actor.json` — `labeled` `pharn/accepted` with `"actor": null`
  ```

- `fixtures/accept-label/events-no-matching-event.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-no-matching-event.json` — `labeled` `bug` and `labeled` `needs-review` by `Reviewer-1`, then `unlabeled` `pharn/accepted` by `Reviewer-1`
  ```

- `fixtures/accept-label/events-organization.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-organization.json` — `labeled` `pharn/accepted` by `octo-org` (Organization)
  ```

- `fixtures/accept-label/events-unreadable.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/events-unreadable.json` — a JSON object, not a list: `{ "message": "<b>not a list</b> @octo-author" }`
  ```

- `fixtures/accept-label/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/files.txt` — tracked files `package.json`, `src/a.ts`, `src/a.test.ts`, `e2e/login.spec.ts`, `AGENTS.md`
  ```

- `fixtures/accept-label/no-signal.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/no-signal.diff` — adds `export const two = 2;` at line 3 of `src/a.ts` (no signal)
  ```

- `fixtures/accept-label/or-true.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/or-true.diff` — a copy of `fixtures/test-integrity/TI10/block-or-true.diff` (TI10 only)
  ```

- `fixtures/accept-label/warn-only.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/accept-label/warn-only.diff` — a copy of `fixtures/test-integrity/TI03/warn-conditional-mobile.diff` (a TI03 warn, no block)
  ```

- `packages/action/src/accept-label.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/accept-label.ts` — new: eligibility, PR read, capped events paging, fail-closed mapping, applies the core decision
  ```

- `packages/action/test/ac-accept-signoff-actor.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-custom.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-default-golden.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-fail-closed.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-history.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-honoured.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-input.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-not-asked.test.ts` — _not named in PLAN ## Files_
- `packages/action/test/ac-accept-signoff-regression.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-accept-signoff-cli.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-accept-signoff-config.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/acceptLabel.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/acceptLabel.ts` — new, pure: default label, input validation, login pattern, label membership, the newest-labeled-event decision, `withAcceptLabel`, `acceptTestIntegrity`, `ignoreAcceptLabel`
  ```

- `packages/core/test/ac-accept-signoff-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-accept-signoff-hints.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-accept-signoff-line.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-accept-signoff-schema.test.ts` — _not named in PLAN ## Files_

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
  AC-1  integration  passed  delivered  packages/action/test/ac-accept-signoff-input.test.ts::action input accept-label › AC-1: a 50-code-point name and a padded name are written as acceptLabel, the default spellings are not | packages/action/test/ac-accept-signoff-input.test.ts::action input accept-label › AC-1: a value with 51 code points fails the step with one error naming accept-label, before any comment | packages/action/test/ac-accept-signoff-input.test.ts::action input accept-label › AC-1: a value with U+0007 between other characters fails the step with one error naming accept-label, before any comment | packages/action/test/ac-accept-signoff-input.test.ts::action input accept-label › AC-1: a value with a line feed between other characters fails the step with one error naming accept-label, before any comment | packages/action/test/ac-accept-signoff-input.test.ts::action input accept-label › AC-1: a value with a tab between other characters fails the step with one error naming accept-label, before any comment
  AC-2  integration  passed  delivered  packages/cli/test/ac-accept-signoff-config.test.ts::test_integrity.accept_label in .pharn/ci.yml never sets the label › AC-2: accept_label alone: the Action step fails pointing at the accept-label input and accepts nothing | packages/cli/test/ac-accept-signoff-config.test.ts::test_integrity.accept_label in .pharn/ci.yml never sets the label › AC-2: accept_label with mode block: the Action step fails pointing at the accept-label input and accepts nothing
  AC-3  integration  passed  delivered  packages/action/test/ac-accept-signoff-not-asked.test.ts::the accept label is only looked at in mode block, with a block signal, on a pull request that carries it › AC-3: control: the same `|| true` diff in mode block on the labelled pull request is accepted | packages/action/test/ac-accept-signoff-not-asked.test.ts::the accept label is only looked at in mode block, with a block signal, on a pull request that carries it › AC-3: mode block on the labelled pull request with only a warn signal, or no signal, asks nothing | packages/action/test/ac-accept-signoff-not-asked.test.ts::the accept label is only looked at in mode block, with a block signal, on a pull request that carries it › AC-3: mode block with a block signal on an unlabelled pull request, a push and a merge_group run keeps the block and fails | packages/action/test/ac-accept-signoff-not-asked.test.ts::the accept label is only looked at in mode block, with a block signal, on a pull request that carries it › AC-3: modes warn and off on the labelled pull request ask nothing and keep their severities
  AC-4  integration  passed  delivered  packages/action/test/ac-accept-signoff-honoured.test.ts::the accept label applied by a reviewer who is not the PR author › AC-4: a pr-number run downgrades every block to warn, records who accepted it and passes as warn | packages/action/test/ac-accept-signoff-honoured.test.ts::the accept label applied by a reviewer who is not the PR author › AC-4: a pull_request run downgrades every block to warn, records who accepted it and passes as warn
  AC-5  integration  passed  delivered  packages/action/test/ac-accept-signoff-custom.test.ts::a configured accept label, label case, and a failing diff coverage › AC-5: PHARN/Accepted on the pull request and Pharn/accepted in the newest event match the default label | packages/action/test/ac-accept-signoff-custom.test.ts::a configured accept label, label case, and a failing diff coverage › AC-5: a pull request carrying the configured label team/tests-ok is accepted under that name | packages/action/test/ac-accept-signoff-custom.test.ts::a configured accept label, label case, and a failing diff coverage › AC-5: an accepted run whose diff coverage is below the threshold still fails on the coverage | packages/action/test/ac-accept-signoff-custom.test.ts::a configured accept label, label case, and a failing diff coverage › AC-5: with team/tests-ok configured, a pull request carrying only pharn/accepted asks nothing and keeps its blocks
  AC-6  integration  passed  delivered  packages/action/test/ac-accept-signoff-actor.test.ts::the newest labeling event made by the PR author or by an account that is not a user › AC-6: a label applied by a Bot account is ignored, the blocks stay and the step fails | packages/action/test/ac-accept-signoff-actor.test.ts::the newest labeling event made by the PR author or by an account that is not a user › AC-6: a label applied by an Organization account is ignored, the blocks stay and the step fails | packages/action/test/ac-accept-signoff-actor.test.ts::the newest labeling event made by the PR author or by an account that is not a user › AC-6: a label applied by the PR author (OCTO-Author, another case of octo-author) is ignored, the blocks stay and the step fails
  AC-7  integration  passed  delivered  packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: no labeling event for the label, only other labels and an unlabeled event: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: reading the pull request itself fails: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the event list is longer than 1,000 events: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the events request rejects with HTTP 403: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the events request times out: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the events response is not a list: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the newest labeling event has no actor (a deleted account): the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the newest labeling event's actor is a User with a 40-character login: the blocks stay, the step fails and the message names only the label | packages/action/test/ac-accept-signoff-fail-closed.test.ts::anything the Action cannot read about who applied the label fails closed › AC-7: the newest labeling event's actor is a User with the login a<b>c: the blocks stay, the step fails and the message names only the label
  AC-8  integration  passed  delivered  packages/action/test/ac-accept-signoff-history.test.ts::the newest labeling event decides › AC-8: Reviewer-1 labels, the author unlabels and labels again: not honoured, the PR author applied it | packages/action/test/ac-accept-signoff-history.test.ts::the newest labeling event decides › AC-8: the author labels and unlabels, then Reviewer-1 labels: honoured, accepted by Reviewer-1
  AC-9  unit  passed  delivered  packages/core/test/ac-accept-signoff-hints.test.ts::the TI03, TI10 and TI13 hints name the accept label › AC-9: the hints name the configured label, or pharn/accepted, keep their words, and hostile labels stay in one code span
  AC-10  unit  passed  delivered  packages/core/test/ac-accept-signoff-line.test.ts::the accepted line in the Test integrity section › AC-10: an accepted report has one line naming the label and @Reviewer-1 after the findings; a null one has none
  AC-11  unit  passed  delivered  packages/core/test/ac-accept-signoff-schema.test.ts::Report v2 with the accept label › AC-11: the accepted, ignored and labelled reports validate, a numeric acceptLabel does not, v2 documents the additions and v1 is unchanged
  AC-12  integration  passed  delivered  packages/cli/test/ac-accept-signoff-cli.test.ts::pharn-ci check never honours the accept label › AC-12: mode block on a `|| true` diff exits 1 with TI10 block and no accept fields; --accept-label is an unknown option
  AC-13  integration  passed  delivered  packages/action/test/ac-accept-signoff-default-golden.test.ts::a default Action run's report is the golden report › AC-13: with accept-label unset the report has no acceptLabel and equals fixtures/golden/report.json
  AC-14  integration  passed  delivered  packages/action/test/ac-accept-signoff-regression.test.ts::the accept label leaves the existing signals, hints, golden outputs and dist alone › AC-14: the dist is a fresh bundle holding the accept label; fixtures, hints and golden outputs are as before
  AC-15  unit  passed  delivered  packages/core/test/ac-accept-signoff-docs.test.ts::the accept label in action.yml, the docs and the fixtures › AC-15: action.yml, README, CHANGELOG, THREAT-MODEL, LIMITS and fixtures/accept-label/ describe the accept label
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
The issue-events API, the Action's PR read and run flow (`run.ts`, `api.ts`), the report message loop, the hints in
`markdown.ts`, the config parser's unknown-key error, and every test that compares an Action report with
`fixtures/golden/report.json` (`ac-stream-action.test.ts` AC-8, `ac-stream-adapters.test.ts` AC-11).
```

### learned

```text
A new field on every Action report breaks the whole-report golden comparisons, so optional report fields are written
only when they carry information (here, a non-default label). The entry gates run `base:test` and `test` at once, so
the 1000 ms bounds in `config-exclude.test.ts` can flake under that load. An abandoned run's AC-TESTS.md claims its test
file names, so a retry must pick new ones (`claimed-elsewhere`).
```

### next_steps

```text
Backlog item 8: Skylos nine, part 1 (`fixtures/skylos-nine/` for vitest; TI01 and TI03 pinned as AC tests, the other
seven pinned as expected misses). Worth a separate fix: make the `config-exclude.test.ts` timing assertions robust to a
loaded machine without weakening them. The abandoned records of runs 1 to 3 can be removed.
```
