# RUN REPORT — test-file-detection-ti01

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
base             b145a7f3e7ad2b8b13af7b591a3186128a355cc6
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
window start       2026-10-25T00:33:50.587Z
window end         2026-10-25T00:51:02.456Z
selected session   29dbd6b7-ab9e-4847-bd21-d2f82fab6115
run context        main
run contexts       main
excluded requests  352
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
(unattributed)  -     claude-sonnet-5-5    20     40               0           45866     6404031   23006            14634
pharn-build     1     claude-sonnet-5-5    39     78               0           72562    13931599   43215            14910
pharn-grill     -     claude-sonnet-5-5     2      4               0            1891      557729     917                0
pharn-plan      -     claude-sonnet-5-5    11     22               0           40372     2814868   20229             8278
pharn-spec      -     claude-sonnet-5-5     8     16               0           29038     1814968    8952              715
pharn-test      -     claude-sonnet-5-5    12     24               0           38911     3601972   26781             5828
TOTAL           -     -                    92    184               0          228640    29125167  123100            44365
unattributed    -     -                    20     40               0           45866     6404031   23006            14634
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
  pharn-spec            -    1  73.9 s
  pharn-plan            -    1  153.6 s
  pharn-grill           -    1  10.6 s
  pharn-test            -    1  188.0 s
  pharn-build           1    1  unmeasured — no-return-marker
  pharn-test            -    2  29 ms
  pharn-regress         1    1  22.0 s
  pharn-verify          1    1  15.1 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (other-run) — worktree created, install ran (exit 0, 737 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation ada5f6f1: start started (call 202 ms); lifetime 19.1 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner f3038c: 18.9 s monotonic, 4 gate(s), ended done
    execution union: 18.9 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 1 (50 ms green); union 51 ms foreground
    abort: nothing running
```

## Files

Changed since `b145a7f3e7ad2b8b13af7b591a3186128a355cc6`, plus untracked files. **This is a changed-since-base observation, not a
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
  - `README.md` — the test-integrity section names TI01
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — diff text bounds and what TI01 misses
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — parsing of untrusted diff text
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle
  ```

- `packages/core/src/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/check.ts` — keepText on the text path, computes and passes the signals
  ```

- `packages/core/src/chunkInputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/chunkInputs.ts` — the streaming reader selects test-file text
  ```

- `packages/core/src/diff/unified.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/diff/unified.ts` — opt-in line text per hunk, with bounds
  ```

- `packages/core/src/index.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/index.ts` — exports
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — the section's finding lines and the TI01 hint
  ```

- `packages/core/src/report.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/report.ts` — signal types, the message code, the message, the testIntegrity block
  ```

- `packages/core/src/testFiles.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/testFiles.ts` — the detection function and the TI01 helpers
  ```

- `packages/core/test/ac-test-files-deleted-check.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-test-files-deleted-check.test.ts` — existing test: run with mode off (reason in BUILD.md)
  ```

- `schema/report.v2.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/report.v2.json` — the message-code description names TEST_INTEGRITY_TI01
  ```

- `fixtures/test-integrity/TI01/block-code-stays.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/block-code-stays.diff` — a test file deleted, its source stays
  ```

- `fixtures/test-integrity/TI01/block-rename-away.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/block-rename-away.diff` — a test renamed to a non-test path, no hunk
  ```

- `fixtures/test-integrity/TI01/block-root-tests.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/block-root-tests.diff` — a repo-root tests file deleted with an unrelated source file
  ```

- `fixtures/test-integrity/TI01/info-migration-mjs.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/info-migration-mjs.diff` — a spec replaced by a `.test.mjs`
  ```

- `fixtures/test-integrity/TI01/info-migration-ts.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/info-migration-ts.diff` — a mocha spec replaced by a vitest `.test.ts`
  ```

- `fixtures/test-integrity/TI01/info-package-removed.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/info-package-removed.diff` — a package removed with its `__tests__`
  ```

- `fixtures/test-integrity/TI01/info-with-source.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/info-with-source.diff` — `foo.test.ts` deleted with `foo.ts`
  ```

- `fixtures/test-integrity/TI01/pass-binary.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/pass-binary.diff` — a binary file under tests deleted
  ```

- `fixtures/test-integrity/TI01/pass-fixture-json.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/pass-fixture-json.diff` — a data fixture under tests deleted
  ```

- `fixtures/test-integrity/TI01/pass-helper.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/pass-helper.diff` — a helper under tests deleted
  ```

- `fixtures/test-integrity/TI01/pass-init-py.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/test-integrity/TI01/pass-init-py.diff` — an empty `__init__.py` under tests deleted
  ```

- `packages/cli/test/ac-ti01-cli.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/signals/ti01.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/signals/ti01.ts` — the TI01 detector (new)
  ```

- `packages/core/test/ac-ti01-block.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-counted.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-diff-caps.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-diff-hunks.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-exemptions.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-files-deleted-compat.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-modes.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-not-counted.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-render.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-ti01-test-file-globs.test.ts` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-ti01-test-file-globs.test.ts::isTestFile(): the test-file globs › AC-1: the spec's test paths are test files, the near misses are not, and the existing fixtures' paths stay test files
  AC-2  unit  passed  delivered  packages/core/test/ac-ti01-diff-hunks.test.ts::unified diff parser: line text per hunk › AC-2: addedLines of every file equal what a parse without the option returns | packages/core/test/ac-ti01-diff-hunks.test.ts::unified diff parser: line text per hunk › AC-2: parseUnifiedDiff keeps added and removed text with line numbers for the selected files only | packages/core/test/ac-ti01-diff-hunks.test.ts::unified diff parser: line text per hunk › AC-2: the line-by-line reader gives the same result
  AC-3  unit  passed  delivered  packages/core/test/ac-ti01-diff-caps.test.ts::unified diff parser: bounds on the kept text › AC-3: 6000 removed lines keep at most 5000, each at most 400 characters, and mark the file truncated | packages/core/test/ac-ti01-diff-caps.test.ts::unified diff parser: bounds on the kept text › AC-3: a 100-line deletion of the same shape is kept whole and is not marked truncated
  AC-4  integration  passed  delivered  packages/core/test/ac-ti01-block.test.ts::check(): TI01 in mode block › AC-4: a deleted test file that defines tests while its source stays is a block signal and fails the report
  AC-5  integration  passed  delivered  packages/core/test/ac-ti01-modes.test.ts::check(): TI01 in the default mode and in mode off › AC-5: with mode off no signal is computed, the block stays pass and the OFF message is present | packages/core/test/ac-ti01-modes.test.ts::check(): TI01 in the default mode and in mode off › AC-5: with no mode given the signal is warn and the report warns
  AC-6  integration  passed  delivered  packages/core/test/ac-ti01-not-counted.test.ts::check(): files TI01 does not count › AC-6: pass-binary.diff deletes tests/img.test.ts and yields no TI01 signal | packages/core/test/ac-ti01-not-counted.test.ts::check(): files TI01 does not count › AC-6: pass-fixture-json.diff deletes tests/fixtures/data.json and yields no TI01 signal | packages/core/test/ac-ti01-not-counted.test.ts::check(): files TI01 does not count › AC-6: pass-helper.diff deletes tests/helpers.ts and yields no TI01 signal | packages/core/test/ac-ti01-not-counted.test.ts::check(): files TI01 does not count › AC-6: pass-init-py.diff deletes tests/__init__.py and yields no TI01 signal
  AC-7  integration  passed  delivered  packages/core/test/ac-ti01-exemptions.test.ts::check(): TI01 exemptions make the finding info › AC-7: info-migration-mjs.diff leaves lib/x.test.js as an info signal | packages/core/test/ac-ti01-exemptions.test.ts::check(): TI01 exemptions make the finding info › AC-7: info-migration-ts.diff leaves lib/x.test.js as an info signal | packages/core/test/ac-ti01-exemptions.test.ts::check(): TI01 exemptions make the finding info › AC-7: info-package-removed.diff leaves packages/a/__tests__/y.test.ts as an info signal | packages/core/test/ac-ti01-exemptions.test.ts::check(): TI01 exemptions make the finding info › AC-7: info-with-source.diff leaves src/foo.test.ts as an info signal
  AC-8  integration  passed  delivered  packages/core/test/ac-ti01-counted.test.ts::check(): files TI01 counts as block › AC-8: a deleted test file whose kept text was truncated before any test-defining line counts | packages/core/test/ac-ti01-counted.test.ts::check(): files TI01 counts as block › AC-8: a repository-root tests folder deleted with an unrelated source file | packages/core/test/ac-ti01-counted.test.ts::check(): files TI01 counts as block › AC-8: a test deleted while its source stays | packages/core/test/ac-ti01-counted.test.ts::check(): files TI01 counts as block › AC-8: a test renamed away to a non-test path with no hunk
  AC-9  integration  passed  delivered  packages/core/test/ac-ti01-files-deleted-compat.test.ts::check(): TEST_FILES_DELETED is unchanged by TI01 › AC-9: every existing deleted-test fixture still yields one info TEST_FILES_DELETED, and with the mode off the verdict of the baseline
  AC-10  integration  passed  delivered  packages/cli/test/ac-ti01-cli.test.ts::TI01 through the CLI and the streaming diff reader › AC-10: the CLI JSON output holds the TI01 block signal for the deleted test file | packages/cli/test/ac-ti01-cli.test.ts::TI01 through the CLI and the streaming diff reader › AC-10: the streamed diff and the whole text give the same testIntegrity block and messages
  AC-11  unit  passed  delivered  packages/core/test/ac-ti01-render.test.ts::renderMarkdown(): the Test integrity section lists TI01 findings › AC-11: a check() report with a block signal lists it with a hint, and the Messages hint does not name an accept label | packages/core/test/ac-ti01-render.test.ts::renderMarkdown(): the Test integrity section lists TI01 findings › AC-11: the report without signals keeps exactly the four lines of the empty state, where a report with one lists it | packages/core/test/ac-ti01-render.test.ts::renderMarkdown(): the Test integrity section lists TI01 findings › AC-11: three signals of severity block, warn and info give three finding lines, each with its hint line
  AC-12  unit  passed  delivered  packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/block-code-stays.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/block-rename-away.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/block-root-tests.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/info-migration-mjs.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/info-migration-ts.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/info-package-removed.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/info-with-source.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/pass-binary.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/pass-fixture-json.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/pass-helper.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: fixtures/test-integrity/TI01/pass-init-py.diff exists | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: the changelog, README, limits and threat model name TI01 | packages/core/test/ac-ti01-docs.test.ts::TI01: docs, schema and fixtures › AC-12: the v2 schema names TEST_INTEGRITY_TI01 and the v1 schema is byte-identical to the base commit's
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
The diff parser and its two callers (`check()` for a diff text, `readDiffChunks` for the CLI and Action stream), the
report builder, the markdown renderer and the existing tests that pin `TEST_FILES_DELETED`. One existing test asserts the
verdict equals the baseline's for deleted-test fixtures; TI01 raises the verdict by design, so that test now runs with the
mode off (recorded in `BUILD.md`).
```

### learned

```text
The red run counts a pass of any `AC-n:` titled test as `ac-test-passes-before-build`, so a "nothing changed" criterion
needs a control assertion that fails before the build. AC test files written by shell heredoc skipped Biome formatting and
failed the lint gate after the build existed; the fix was to set the build aside, format, re-lock and re-run the red run.
Run `biome check` on the AC test files before pinning them next time.
```

### next_steps

```text
Backlog item 4: TI14 and TI11 (ci.yml exclusions widened and threshold lowered). The diff parser now keeps line text only
for test files (`keepTestFileText`); TI14 and TI11 read `.pharn/ci.yml` and workflow files, so the selection predicate
needs to cover those paths too. The Test integrity section lists findings by signal id with a hint per id
(`SIGNAL_HINTS` in `render/markdown.ts`); add each new id there.
```
