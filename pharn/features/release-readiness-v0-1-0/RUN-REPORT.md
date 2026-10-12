# RUN REPORT — release-readiness-v0-1-0

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
base             a66f83485906cf647f1f135cf8bdff53f0b5cd23
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
window start       2026-10-12T19:36:13.283Z
window end         2026-10-12T19:51:44.672Z
selected session   cc1d5017-6a5e-4e64-a6d2-cdb06aaf4640
run context        agent:a7c3a593925612ecd
run contexts       agent:a13dbd92585907f18, agent:a2aa987c0c053cdfe, agent:a7c3a593925612ecd, agent:a8d43f3b8b5948603, agent:ad20b2350218f31d0
excluded requests  1222
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
(unattributed)  -     claude-opus-5-5      23     46           39922               0     2815289    2542              496
pharn-build     1     claude-opus-5-5       2      4            2078               0      237200      21                0
pharn-build     1     claude-sonnet-5-5    23     48          125861               0     2402265    9186              778
pharn-grill     -     claude-opus-5-5       7     14           11911               0      767929     104                0
pharn-plan      -     claude-opus-5-5      25     50          117870               0     2821305   13129             4170
pharn-spec      -     claude-opus-5-5      25     50          149747               0     2688032    4960               34
pharn-test      -     claude-opus-5-5      23     46           91205               0     2361837    6676              668
TOTAL           -     -                   128    258          538594               0    14093857   36618             6146
unattributed    -     -                    23     46           39922               0     2815289    2542              496
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
  pharn-spec            -    1  252.7 s
  pharn-plan            -    1  241.7 s
  pharn-grill           -    1  24.9 s
  pharn-test            -    1  190.9 s
  pharn-build           1    1  118.5 s
  pharn-regress         1    1  8644 ms
  pharn-verify          1    1  3575 ms

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 714 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
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
  invocation 04d29f02: start started (call 292 ms); lifetime 5201 ms (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner a4c699: 4871 ms monotonic, 4 gate(s), ended done
    execution union: 4871 ms
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 0 ms
    wait calls: 1 (20 ms green); union 20 ms foreground
    abort: nothing running
```

## Files

Changed since `a66f83485906cf647f1f135cf8bdff53f0b5cd23`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

The tree was clean before the run, so no path below is marked `dirty-before-run`.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — fresh empty `## [Unreleased]` (Added/Changed/Security), entries moved under `## [0.1.0] - YYYY-MM-DD` with the one-line date note, entries made complete and consistent
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — lcov-only phrasings corrected, CLI usage gains `-h|--help` and `-v|--version`, core row names Cobertura
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — three lcov-only phrasings corrected; every limit kept
  ```

- `docs/RELEASING.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/RELEASING.md` — version step names the root `package.json` and `docs/MARKETPLACE.md`'s `uses:` line; placeholder-date convention
  ```

- `package.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `package.json` — add `"version": "0.1.0"` after `name`; nothing else changes
  ```

- `packages/core/test/version.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/version.test.ts` — add a root `package.json` check against `VERSION`, keeping the existing per-package `it.each`
  ```

- `docs/MARKETPLACE.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/MARKETPLACE.md` — new: Marketplace listing (name, one-line description, three-paragraph description, categories, quick start)
  ```

- `packages/core/test/ac-release-changelog.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-release-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-release-version.test.ts` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/cost.json` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/release-readiness-v0-1-0/verify-report.json` — _not named in PLAN ## Files_

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
  AC-1  unit  passed  delivered  packages/core/test/ac-release-version.test.ts::release readiness: one version everywhere › AC-1: the root, core, cli and action package.json versions all equal VERSION
  AC-2  unit  passed  delivered  packages/core/test/ac-release-changelog.test.ts::release readiness: CHANGELOG.md passes release.yml › AC-2: has exactly one dated or placeholder heading for the version, below ## [Unreleased]
  AC-3  unit  passed  delivered  packages/core/test/ac-release-changelog.test.ts::release readiness: CHANGELOG.md passes release.yml › AC-3: the extracted release notes are non-empty, complete and claim no lcov-only reading
  AC-4  unit  passed  delivered  packages/core/test/ac-release-docs.test.ts::release readiness: docs/MARKETPLACE.md listing › AC-4: name, one-line description, three-paragraph description and two categories match action.yml
  AC-5  unit  passed  delivered  packages/core/test/ac-release-docs.test.ts::release readiness: docs/MARKETPLACE.md listing › AC-5: the quick start uses pharn-dev/pharn-ci@v<VERSION> with only inputs action.yml declares
  AC-6  unit  passed  delivered  packages/core/test/ac-release-docs.test.ts::release readiness: docs/RELEASING.md › AC-6: the version step names all five version files and the placeholder date is replaced first
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
The build's own report (DATA) says it first wrote `CHANGELOG.md` through a Bash heredoc, then rewrote it with the
Write tool with identical content; `CHANGELOG.md` is a declared plan path and verify's `reconcile` gate exited 0.
`packages/action/dist/index.js` came out byte-identical after `pnpm build`, so it is not in the change.
```

### learned

```text
The packages' versions and `VERSION` were already `0.1.0`; only the root `package.json` lacked a version. The README
inputs table, message-code table and setup-kind list already matched `action.yml` and the schema, per the SPEC stage's
report (DATA); the build changed only lcov-only phrasings, the CLI usage line and the core-package row there.
```

### next_steps

```text
A person reviews the branch: the line wrapping of the edited `docs/LIMITS.md` lines, the unaligned README package
table row and the unwrapped paragraphs of `docs/MARKETPLACE.md`, then sets the release date and removes the date note
before dispatching release.yml.
```
