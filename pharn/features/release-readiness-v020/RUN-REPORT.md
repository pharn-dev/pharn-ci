# RUN REPORT — release-readiness-v020

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
base             b2c3a56373046ee6b64f913581a645f98240310c
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
window start       2026-10-25T07:18:47.525Z
window end         2026-10-25T07:40:53.286Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a6206eb0e78029476, agent:a658b1ab28c902ddd, agent:abf91e64fec15b976, agent:aee8d1d5d8e6c82cb, main
excluded requests  1613
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
(unattributed)  -     claude-sonnet-5-5    13     26               0           24529     2994207    4547              561
pharn-build     1     claude-opus-5-5       1      2             202               0      150317    1202                0
pharn-build     1     claude-sonnet-5-5    37     74          158667            3619     4818635   21653             4584
pharn-grill     -     claude-opus-5-5       1      2             460               0      177003    1361                0
pharn-grill     -     claude-sonnet-5-5     2      4               0            4009      446097     770                0
pharn-plan      -     claude-opus-5-5      35     70          140457               0     4358743   35370            14925
pharn-plan      -     claude-sonnet-5-5     3      6               0            3812      653724     857              105
pharn-regress   1     claude-sonnet-5-5     1      2            1173               0      158667    1343                0
pharn-spec      -     claude-opus-5-5      38     76          177496               0     4824836   29790            15160
pharn-spec      -     claude-sonnet-5-5     3      6               0            4145      639369    3295               55
pharn-test      -     claude-opus-5-5      31     62          113566               0     3692420   29899             8713
pharn-test      -     claude-sonnet-5-5     3      6               0            1287      682537     748                0
TOTAL           -     -                   168    336          592021           41401    23596555  130835            44103
unattributed    -     -                    13     26               0           24529     2994207    4547              561
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
  pharn-spec            -    1  348.3 s
  pharn-plan            -    1  376.4 s
  pharn-grill           -    1  7483 ms
  pharn-test            -    1  304.4 s
  pharn-build           1    1  198.3 s
  pharn-regress         1    1  15.0 s
  pharn-verify          1    1  21.9 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE from the entry gates (no worktree, no install, 0 base gate processes; 2 results from this run's entry check)
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
  invocation 36c11364: start started (call 332 ms); lifetime 34.7 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 650512: 34.4 s monotonic, 4 gate(s), ended done
    execution union: 34.4 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 31.0 s
    wait calls: 1 (22 ms green); union 22 ms foreground
    abort: nothing running
```

## Files

Changed since `b2c3a56373046ee6b64f913581a645f98240310c`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — new lines at the end of `### Added` under `## [Unreleased]` (Skylos 2 of 9, the LIMITS section); nothing existing edited
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — Contents line, new `## Test integrity` section with the rendered added-skip example and the 2-of-9 result, Roadmap bullet rewritten
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — section 1's stale "not detected yet" sentence corrected; new `## What test integrity does not catch` section before `## 2.`
  ```

- `docs/RELEASING.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/RELEASING.md` — `**Smoke in the dry run.**` and `**Fork PR check.**` under step 2, `**Release smoke.**` under step 3
  ```

- `fixtures/smoke/base/src/math.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/smoke/base/src/math.js` — new: base state of the smoke repository
  ```

- `fixtures/smoke/coverage.lcov`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/smoke/coverage.lcov` — new: lcov for the head, every executable line covered
  ```

- `fixtures/smoke/expected-summary.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/smoke/expected-summary.txt` — new: the whole lines the job summary must contain
  ```

- `fixtures/smoke/head/src/math.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/smoke/head/src/math.js` — new: head state, one function added
  ```

- `fixtures/smoke/head/src/math.test.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/smoke/head/src/math.test.js` — new: the head's tests (committed, never run)
  ```

- `packages/core/test/ac-v020-changelog.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-limits.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-readme.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-releasing.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-skylos-count.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-smoke-broken.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-smoke-env.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-smoke-fixture.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-smoke-imports.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-v020-smoke-run.test.ts` — _not named in PLAN ## Files_
- `scripts/smoke-release.mjs`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `scripts/smoke-release.mjs` — new release smoke script (Node built-ins only)
  ```

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
  AC-1  unit  passed  delivered  packages/core/test/ac-v020-limits.test.ts::release-readiness-v020: docs/LIMITS.md › AC-1: one 'What test integrity does not catch' section after the accept-label misses, naming the seven signals, the accept label, Skylos 2 of 9, the two caught cases and the seven missed cases with their planned signals
  AC-2  unit  passed  delivered  packages/core/test/ac-v020-limits.test.ts::release-readiness-v020: docs/LIMITS.md › AC-2: the section names a same-name replacement with a trivial body, toEqual(expectedFromOutput), mocks in setup files, and calls the unbuilt signals planned
  AC-3  unit  passed  delivered  packages/core/test/ac-v020-skylos-count.test.ts::release-readiness-v020: the LIMITS 2-of-9 figure matches check() › AC-3: exactly the two cases LIMITS lists as caught give a signal (only their named id), the seven it lists as missed give none, so the live count is 2 of 9
  AC-4  unit  passed  delivered  packages/core/test/ac-v020-limits.test.ts::release-readiness-v020: docs/LIMITS.md › AC-4: the stale 'not detected yet' sentence is gone and every ## and ### heading of the base copy is still present
  AC-5  unit  passed  delivered  packages/core/test/ac-v020-readme.test.ts::release-readiness-v020: README.md › AC-5: one ## Test integrity heading, its Contents line, the section's words and links, no uses: line, and the Status note and uses: pins unchanged
  AC-6  unit  passed  delivered  packages/core/test/ac-v020-readme.test.ts::release-readiness-v020: README.md › AC-6: every non-blank line of the rendered added-skip Test integrity section appears, in order, in the README section with its > quote removed
  AC-7  unit  passed  delivered  packages/core/test/ac-v020-readme.test.ts::release-readiness-v020: README.md › AC-7: the Roadmap no longer says deleted test files are already named by…, and links to #test-integrity
  AC-8  unit  passed  delivered  packages/core/test/ac-v020-changelog.test.ts::release-readiness-v020: CHANGELOG.md › AC-8: Unreleased names Skylos, 2 of 9 and docs/LIMITS.md, keeps the Report v2 line and every earlier line, and the ## [ headings are unchanged
  AC-9  unit  passed  delivered  packages/core/test/ac-v020-releasing.test.ts::release-readiness-v020: docs/RELEASING.md › AC-9: a fork / job summary / comment item comes before **Release.**, the Release smoke and dry-run smoke steps are written, and every earlier ## heading and item lead is kept
  AC-10  unit  passed  delivered  packages/core/test/ac-v020-smoke-fixture.test.ts::release-readiness-v020: the smoke fixture's expected summary › AC-10: expected-summary.txt holds the Test integrity heading and the no-findings line, and no line with pharn-ci followed by a version
  AC-11  integration  passed  delivered  packages/core/test/ac-v020-smoke-run.test.ts::release-readiness-v020: release smoke on the committed bundle › AC-11: node scripts/smoke-release.mjs . exits 0, prints exactly one non-blank line starting ok, and leaves TMPDIR empty
  AC-12  integration  passed  delivered  packages/core/test/ac-v020-smoke-broken.test.ts::release-readiness-v020: the release smoke fails on a broken setup › AC-12: a bundle that exits 1 fails the smoke at exit | packages/core/test/ac-v020-smoke-broken.test.ts::release-readiness-v020: the release smoke fails on a broken setup › AC-12: a bundle that writes verdict fail and exits 0 fails the smoke at verdict | packages/core/test/ac-v020-smoke-broken.test.ts::release-readiness-v020: the release smoke fails on a broken setup › AC-12: a copied script and fixtures/smoke/ whose expected-summary.txt has an extra line fail the smoke naming that line | packages/core/test/ac-v020-smoke-broken.test.ts::release-readiness-v020: the release smoke fails on a broken setup › AC-12: the committed bundle under packages/action/package.json version 9.9.9 fails the smoke naming 9.9.9
  AC-13  integration  passed  delivered  packages/core/test/ac-v020-smoke-env.test.ts::release-readiness-v020: the release smoke's bundle environment › AC-13: the bundle sees none of the parent's GITHUB_EVENT_NAME, GITHUB_EVENT_PATH, GITHUB_TOKEN or INPUT_PR-NUMBER, exactly the six INPUT_ values, and runner paths inside TMPDIR
  AC-14  unit  passed  delivered  packages/core/test/ac-v020-smoke-imports.test.ts::release-readiness-v020: the release smoke script's imports › AC-14: every import and require specifier starts node:, none is a network module, and the text has no fetch(
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
`product/BACKLOG.md` item 9, `docs/RELEASING.md`, `release.yml`, `docs/LIMITS.md`, the README, the existing release and
accept-label docs tests, and how the Action behaves outside a pull request (a committed coverage file makes it add
`COVERAGE_FILE_TRACKED`, and `report.json` goes under `RUNNER_TEMP`).
```

### learned

```text
The write guard refuses a plan naming `.github/workflows/**`, so a workflow edit is always a hand step after the loop.
The smoke script writes the coverage file untracked after the head commit, and sets `RUNNER_TEMP` inside its own temp
directory. The existing CHANGELOG Report v2 entry still says the `testIntegrity` block is empty until signals ship; it
was left unchanged.
```

### next_steps

```text
Add the `Release smoke` job (after `publish`, `contents: read`, checking out the released commit into its own
directory and running `node scripts/smoke-release.mjs <dir>`) and a dry-run smoke step in `verify` to
`.github/workflows/release.yml`. Then the release itself, by a maintainer: the version bump PR, the dry run, the
real run, the Marketplace step after the smoke is green.
```
