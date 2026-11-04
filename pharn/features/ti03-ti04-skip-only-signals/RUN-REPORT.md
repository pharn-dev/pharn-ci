# RUN REPORT — ti03-ti04-skip-only-signals

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
base             be11155dc701478902b77983a2fa7a5db358a806
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
window start       2026-10-25T01:25:58.500Z
window end         2026-10-25T01:57:11.079Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       agent:a6ab9628f2e69cbb2, agent:a73670891fc3b4da3, agent:a8f06cd5c459bd395, agent:af2be79d2a5265ba4, main
excluded requests  595
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
(unattributed)  -     claude-opus-5-5       1      2             216               0      193719    1787                0
(unattributed)  -     claude-sonnet-5-5    18     36             230           30995     4043317    6958             1113
pharn-build     1     claude-sonnet-5-5    41     82          213357            4099     6712148   55804            24647
pharn-grill     -     claude-opus-5-5       1      2             476               0      166561    1500                0
pharn-grill     -     claude-sonnet-5-5     1      2               0            1086      214338     709                0
pharn-plan      -     claude-opus-5-5      28     56          129810               0     3320127   25690            10394
pharn-plan      -     claude-sonnet-5-5     3      6               0            1309      636751     813               52
pharn-regress   1     claude-sonnet-5-5     1      2               0            2283      227797     292               66
pharn-spec      -     claude-opus-5-5      31     62          147806               0     3357915   24463            11203
pharn-spec      -     claude-sonnet-5-5     5     10               0            6244     1030426    5287             1181
pharn-test      -     claude-opus-5-5      39     78          156968               0     5585221   59042            20371
pharn-test      -     claude-sonnet-5-5     3      6               0            1636      659256     864               49
pharn-verify    1     claude-sonnet-5-5     1      2               0             409      230583     205                0
TOTAL           -     -                   173    346          648863           48061    26378159  183414            69076
unattributed    -     -                    19     38             446           30995     4237036    8745             1113
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
  pharn-spec            -    1  302.6 s
  pharn-plan            -    1  269.7 s
  pharn-grill           -    1  8561 ms
  pharn-test            -    1  556.1 s
  pharn-build           1    1  533.0 s
  pharn-regress         1    1  65.6 s
  pharn-verify          1    1  54.1 s

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
  invocation 1f705c78: start started (call 723 ms); lifetime 68.8 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner 0458dd: 68.0 s monotonic, 4 gate(s), ended done
    execution union: 68.0 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 64.9 s
    wait calls: 1 (161 ms green); union 161 ms foreground
    abort: nothing running
```

## Files

Changed since `be11155dc701478902b77983a2fa7a5db358a806`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased entries for TI03 and TI04
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — names TI03 and TI04 and their message codes
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — "What TI03 misses" and "What TI04 misses"
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — TI03 and TI04 read the kept text of test files; fixed-sentence details
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — adds the two detectors to the signal list
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — exports
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — message and signal hints for TI03 and TI04
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — the two message codes and their per-id messages
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — the message-code description names the two new codes
  ```

- `fixtures/test-integrity/TI03/block-it-skip-existing.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/block-it-skip-existing.diff` — `it('creates a user'` to `it.skip(` with the name kept
  ```

- `fixtures/test-integrity/TI03/block-pytest-decorator.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/block-pytest-decorator.diff` — `@pytest.mark.skip(reason="flaky")` above an unchanged test
  ```

- `fixtures/test-integrity/TI03/block-skipif-true.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/block-skipif-true.diff` — `it('n'` to `it.skipIf(true)('n'`
  ```

- `fixtures/test-integrity/TI03/block-todo-existing.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/block-todo-existing.diff` — `test('n', () => {` to `test.todo('n')`
  ```

- `fixtures/test-integrity/TI03/block-xdescribe-existing.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/block-xdescribe-existing.diff` — `describe('s'` to `xdescribe('s'`
  ```

- `fixtures/test-integrity/TI03/pass-comment.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-comment.diff` — commented-out `// it.skip(` and `# @pytest.mark.skip`
  ```

- `fixtures/test-integrity/TI03/pass-fails-async-edit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-fails-async-edit.diff` — `it.fails` sync to async (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/pass-fixme.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-fixme.diff` — `test.fixme(` added
  ```

- `fixtures/test-integrity/TI03/pass-non-test-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-non-test-file.diff` — `test.skip(isMobile, "x")` in `src/util.ts`
  ```

- `fixtures/test-integrity/TI03/pass-skip-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-skip-moved.diff` — an `it.skip` moved within its file
  ```

- `fixtures/test-integrity/TI03/pass-skipif-false.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-skipif-false.diff` — `it.skipIf(false)('n'` in place of `it('n'`
  ```

- `fixtures/test-integrity/TI03/pass-xit-respelled.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/pass-xit-respelled.diff` — `it.skip('n'` to `xit('n'`
  ```

- `fixtures/test-integrity/TI03/warn-conditional-mobile.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-conditional-mobile.diff` — `test.skip(isMobile, "mobile only")` (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-go-skip-root.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-go-skip-root.diff` — `t.Skip("needs root")` under an `if` (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-pytest-skip-fixture.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-pytest-skip-fixture.diff` — `pytest.skip(` fixture not downloaded (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-pytest-skip-redis.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-pytest-skip-redis.diff` — `pytest.skip("REDIS_URL not set")` under an `if` (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-skip-new-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-skip-new-file.diff` — a new test file holding `it.skip(`
  ```

- `fixtures/test-integrity/TI03/warn-skipif-camera.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-skipif-camera.diff` — `it.skipIf(!hasCamera)('n'` in place of `it('n'` (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-skipif-docker.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-skipif-docker.diff` — `@pytest.mark.skipif(` no Docker (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-skipif-openssl.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-skipif-openssl.diff` — `@pytest.mark.skipif(` OpenSSL version (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-skipunless-windows.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-skipunless-windows.diff` — `@unittest.skipUnless(` Windows only (PRECISION §1)
  ```

- `fixtures/test-integrity/TI03/warn-xfail-new-test.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI03/warn-xfail-new-test.diff` — `@pytest.mark.xfail(reason="known bug")` above an added test (PRECISION §1)
  ```

- `fixtures/test-integrity/TI04/block-describe-only.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-describe-only.diff` — `describe.only(` added
  ```

- `fixtures/test-integrity/TI04/block-fdescribe.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-fdescribe.diff` — bare `fdescribe(` added
  ```

- `fixtures/test-integrity/TI04/block-fit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-fit.diff` — bare `fit(` added
  ```

- `fixtures/test-integrity/TI04/block-it-only.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-it-only.diff` — `it.only(` added
  ```

- `fixtures/test-integrity/TI04/block-only-renamed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-only-renamed.diff` — `it.only('a'` edited to `it.only('b'`
  ```

- `fixtures/test-integrity/TI04/block-test-describe-only.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/block-test-describe-only.diff` — `test.describe.only(` added
  ```

- `fixtures/test-integrity/TI04/pass-comment.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-comment.diff` — a commented-out `// it.only(`
  ```

- `fixtures/test-integrity/TI04/pass-go-fit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-go-fit.diff` — `fit(` in a Go test file
  ```

- `fixtures/test-integrity/TI04/pass-json-fixture.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-json-fixture.diff` — `it.only(` in `tests/fixtures/data.json`
  ```

- `fixtures/test-integrity/TI04/pass-non-test-file.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-non-test-file.diff` — `it.only(` in `src/util.ts`
  ```

- `fixtures/test-integrity/TI04/pass-only-async-edit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-only-async-edit.diff` — `it.only` sync to async
  ```

- `fixtures/test-integrity/TI04/pass-only-moved.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-only-moved.diff` — a `describe.only` moved within its file
  ```

- `fixtures/test-integrity/TI04/pass-python-def-fit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-python-def-fit.diff` — `def fit(self):` in a Python test file (PRECISION §1)
  ```

- `fixtures/test-integrity/TI04/pass-solver-fit.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI04/pass-solver-fit.diff` — `solver.fit(x)` in a JS test file (PRECISION §1)
  ```

- `packages/cli/test/ac-ti0304-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/signals/testLines.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/testLines.ts` — the one-line JS/TS, Python and Go test-line parsers (new)
  ```

- `packages/core/src/signals/ti03.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti03.ts` — the TI03 detector (new)
  ```

- `packages/core/src/signals/ti04.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti04.ts` — the TI04 detector (new)
  ```

- `packages/core/test/ac-ti03-added-test.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti03-conditional.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti03-in-body.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti03-js-existing.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti03-no-signal.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti03-python-existing.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti0304-details.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti0304-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti0304-modes.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti0304-regression.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti04-narrowed.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti04-not-a-test-call.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti04-pre-existing.test.ts` — _not named in PLAN ## Files_

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
  AC-1  integration  passed  delivered  packages/core/test/ac-ti04-narrowed.test.ts::TI04: a narrowing marker added to a JS/TS test file › AC-1: seven added .only, fit and fdescribe lines give seven block TI04 signals with one fixed detail
  AC-2  integration  passed  delivered  packages/core/test/ac-ti04-not-a-test-call.test.ts::TI04: lines that only look like a narrowing marker › AC-2: method calls, assignments, comments, Python, Go, non-test and JSON files give no TI04 signal
  AC-3  integration  passed  delivered  packages/core/test/ac-ti04-pre-existing.test.ts::TI04: a marker that was already there, a renamed one, and the per-file cap › AC-3: an edit to async and a move give nothing, a rename gives one signal, 21 added markers give 20
  AC-4  integration  passed  delivered  packages/core/test/ac-ti03-js-existing.test.ts::TI03: an unconditional skip on a test the diff shows existed › AC-4: each JS/TS skip of an existing test is one TI03 signal, block in mode block and warn in mode warn
  AC-5  integration  passed  delivered  packages/core/test/ac-ti03-python-existing.test.ts::TI03: an unconditional Python skip decorator above an unchanged test › AC-5: each decorator added alone above an unchanged def test_x or class TestUser is one block TI03 signal
  AC-6  integration  passed  delivered  packages/core/test/ac-ti03-conditional.test.ts::TI03: a conditional skip › AC-6: each conditional JS/TS skip, skipIf or runIf and Python skipif, skipIf, skipUnless or xfail(cond) is one warn TI03 signal
  AC-7  integration  passed  delivered  packages/core/test/ac-ti03-in-body.test.ts::TI03: a skip inside a test body › AC-7: pytest.skip, t.Skip, t.Skipf, t.SkipNow, test.skip(), test.skip(true) and this.skip() are warn; the if lines give nothing
  AC-8  integration  passed  delivered  packages/core/test/ac-ti03-added-test.test.ts::TI03: a skip in a test the change adds › AC-8: a decorator above an added test, a skip on an added test name and skips in added files are warn
  AC-9  integration  passed  delivered  packages/core/test/ac-ti03-no-signal.test.ts::TI03: edits that keep a skip, non-skips, comments, strings and non-test files › AC-9: none of these diffs gives a TI03 signal
  AC-10  integration  passed  delivered  packages/core/test/ac-ti0304-details.test.ts::TI03 and TI04: the fixed details › AC-10: one detail per TI03 category, four different ones, all at most 300 characters, no fixture text in details or messages
  AC-11  integration  passed  delivered  packages/core/test/ac-ti0304-modes.test.ts::TI03 and TI04 in the three modes › AC-11: block sorts and fails, warn shows every signal as warn, off computes nothing, a conditional skip alone warns
  AC-12  integration  passed  delivered  packages/cli/test/ac-ti0304-render.test.ts::TI03 and TI04 in the PR comment, the streaming reader and the CLI › AC-12: the section lists each signal with a hint, both message hints exist, streamed equals whole text, the CLI JSON holds TI03
  AC-13  integration  passed  delivered  packages/core/test/ac-ti0304-regression.test.ts::TI03 and TI04 leave the earlier signals and fixtures alone › AC-13: the TI01, TI11 and TI14 fixtures give the same signals and messages as before, and the golden diff stays quiet
  AC-14  unit  passed  delivered  packages/core/test/ac-ti0304-docs.test.ts::TI03 and TI04: docs, schema and fixtures › AC-14: at least five must-trigger and five must-not-trigger diffs per id, the PRECISION cases among them, and they behave | packages/core/test/ac-ti0304-docs.test.ts::TI03 and TI04: docs, schema and fixtures › AC-14: the changelog, README, limits and threat model name TI03 and TI04 | packages/core/test/ac-ti0304-docs.test.ts::TI03 and TI04: docs, schema and fixtures › AC-14: the v2 schema names both message codes and the v1 schema is byte-identical to the base commit's
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
The existing TI01, TI11 and TI14 detectors, the test-file helpers (`isTestFile`, `definesTests`), the diff reader's kept
line text for test files, and `docs/PRECISION.md` for the must-not-block cases. With `--unified=0` the diff shows no
context, so whether a skipped test exists at base is decided only from evidence in the diff: a removed line of the same
file that opens a test with the same name, or a Python decorator added alone above an unchanged `def`.
```

### learned

```text
Every in-body skip (`pytest.skip()`, `t.Skip`, `test.skip()`) and every conditional skip is `warn` by design, because the
diff cannot show an enclosing `if` or whether the test exists. Each negative AC starts with a positive control so that the
test fails in the red run for the right reason. The AC test files were checked with `biome check` before the lock.
```

### next_steps

```text
Backlog item 6: TI10 and TI13 (package.json test scripts weakened, coverage-ignore comments added in source). TI13 reads
source files, so `keepSignalFileText` will need to keep text for non-test source files (bounded), unlike TI03 and TI04.
Backlog item 7 (the accept label) should update the TI03 hint to name the label, and flaky quarantine (A6) should extend
it again.
```
