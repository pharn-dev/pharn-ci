# RUN REPORT — d05-private-registry-allowlist

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
decision         STOP_CAP
iterations       3
blocked          none
base             1304e8f6c8c68ea12e7ceb9fe12d953264af409a
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
window start       2026-11-08T20:29:54.130Z
window end         2026-11-08T22:09:48.130Z
selected session   431ab2b1-fba7-4311-a25b-9f092c9c4207
run context        main
run contexts       agent:a31118a65dd48ccbf, agent:a61f20b675efe9b7c, agent:a69dfb8831a8499dd, agent:a7dc9c94486c17e63, agent:ada73e8a9c98a29e4, agent:afb41258c87b10bc8, main
excluded requests  8
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
(unattributed)  -     claude-fable-5-1      1     33             193               0      159821    1346                0
(unattributed)  -     claude-sonnet-5-5    30     60               0           33335     4720632    9256             1396
pharn-build     1     claude-opus-5-5       1      2             185               0      234654    1579                0
pharn-build     1     claude-sonnet-5-5   100    200          274588            3966    20012725   57059            10927
pharn-build     2     claude-sonnet-5-5    18     36          119862            1574     1905147    5655              951
pharn-build     3     claude-sonnet-5-5    22     44          122525             850     2320928    6972             1268
pharn-grill     -     claude-opus-5-5       1      2             187               0      252203    1509                0
pharn-grill     -     claude-sonnet-5-5     4      8               0           14437      547858    1418                0
pharn-plan      -     claude-opus-5-5      71    142          252203               0    12581066   45989            20867
pharn-plan      -     claude-sonnet-5-5     3      6               0            3306      376245     807              262
pharn-regress   1     claude-sonnet-5-5     3      6             201            3151      578205    1728               44
pharn-regress   2     claude-sonnet-5-5     2      4             202            2086      278622    1142              216
pharn-regress   3     claude-sonnet-5-5     2      4             200            1932      286345     825                0
pharn-spec      -     claude-fable-5-1     23    727          159821               0     2591055   22323            10706
pharn-spec      -     claude-sonnet-5-5     2      4               0            1374      246955     790               33
pharn-test      -     claude-opus-5-5      74    148          197404               0    12503238   56627            19104
pharn-test      -     claude-sonnet-5-5     3      6               0            1525      434675     540                0
pharn-verify    1     claude-sonnet-5-5     1      2               0             353      153900     162                0
pharn-verify    2     claude-sonnet-5-5     1      2               0             338      161478     165                0
pharn-verify    3     claude-sonnet-5-5     1      2               0             338      166125     165                0
TOTAL           -     -                   363   1438         1127571           68565    60511877  216057            65774
unattributed    -     -                    31     93             193           33335     4880453   10602             1396
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
  pharn-spec            -    1  405.0 s
  pharn-plan            -    1  642.3 s
  pharn-grill           -    1  18.2 s
  pharn-test            -    1  747.1 s
  pharn-build           1    1  1232.5 s
  pharn-regress         1    1  677.0 s
  pharn-verify          1    1  299.7 s
  pharn-build           2    1  466.7 s
  pharn-regress         2    1  197.4 s
  pharn-verify          2    1  191.4 s
  pharn-build           3    1  361.5 s
  pharn-regress         3    1  381.5 s
  pharn-verify          3    1  215.4 s

deterministic work — gate processes run vs taken from reused evidence (counted from each stage's gate-run stamp)
  pharn-regress iter 1 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE fresh (no-record) — worktree created, install ran (exit 0, 814 ms), base gates 2 run, 0 reused, 0 nothing-to-run, of 2
  pharn-verify iter 1 run 1: gates 4 run, 1 reused, 0 nothing-to-run, of 5
  pharn-regress iter 2 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE REUSED (no worktree, no install, 0 base gate processes; 2 results from earlier evidence)
  pharn-verify iter 2 run 1: gates 4 run, 1 reused, 0 nothing-to-run, of 5
  pharn-regress iter 3 run 1: HEAD gates 2 run, 0 reused, 0 nothing-to-run, of 2; BASE REUSED (no worktree, no install, 0 base gate processes; 2 results from earlier evidence)
  pharn-verify iter 3 run 1: gates 4 run, 1 reused, 0 nothing-to-run, of 5
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
  invocation 477383ca: start started (call 2040 ms); lifetime 811.1 s (wall clock, start to the runner end record; placement, not CPU or gate time)
    runner d94a4b: 809.0 s monotonic, 4 gate(s), ended done
    execution union: 809.0 s
    of it inside measured stage rows (wall-clock placement only — not proof both were active, not a saving): 795.1 s
    wait calls: 1 (21 ms red); union 21 ms foreground
    abort: nothing running
```

## Files

Changed since `1304e8f6c8c68ea12e7ceb9fe12d953264af409a`, plus untracked files. **This is a changed-since-base observation, not a
record of what the build wrote** — a path can appear here because another stage, a generator, or a
person touched it. A `not named in PLAN ## Files` marker is therefore not a scope violation; the
scope question is `check-bash-reconcile.mjs`'s and this report never answers it.

1 path(s) were already dirty before the run started; those are marked below.

Rendered after `cost.json` was written and before any commit this run may make, so `cost.json`
appears below and this report itself does not.

- `CHANGELOG.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `CHANGELOG.md` — Unreleased: Added line
  ```

- `README.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `README.md` — Dependency safety (private registries, D05 row), inputs table, CLI synopsis and flags, policy key
  ```

- `action.yml`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `action.yml` — declare the `dependency-allowed-hosts` input
  ```

- `docs/LIMITS.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/LIMITS.md` — "Declared sources only" and "Allowed hosts are exact" name the allow-list and its bounds
  ```

- `docs/THREAT-MODEL.md`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `docs/THREAT-MODEL.md` — rows C9 and D8 and residual 43
  ```

- `packages/action/dist/index.js`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`)
  ```

- `packages/action/src/run.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/action/src/run.ts` — the `dependency-allowed-hosts` input and its error label
  ```

- `packages/cli/src/main.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/cli/src/main.ts` — repeatable `--dependency-allowed-host`, early validation, HELP line
  ```

- `packages/core/src/config.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/config.ts` — refuse `dependencies.allowed_hosts` in `.pharn/ci.yml` with a message naming the workflow input
  ```

- `packages/core/src/dependencies/check.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/check.ts` — apply the allowed hosts to manifest, index-option and lockfile D05; an allowed private entry stays in `offRegistry`
  ```

- `packages/core/src/dependencies/npmManifest.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/npmManifest.ts` — set `url` on a URL dependency
  ```

- `packages/core/src/dependencies/pythonManifest.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/pythonManifest.ts` — set `url` on a URL requirement and a pyproject `url =` source
  ```

- `packages/core/src/dependencies/settings.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/settings.ts` — `allowedHosts` on the input and app-policy layers and on the resolved settings; app replaces input, file ignored
  ```

- `packages/core/src/dependencies/types.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/types.ts` — `ManifestDependency.url?` for kind `url`
  ```

- `packages/core/src/inputs.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/inputs.ts` — `RawInputs.dependencyAllowedHosts`, its error label, validation, and the input layer
  ```

- `packages/core/src/policy/apply.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/apply.ts` — app list into the layer, `looser` for input hosts it does not name, `not-allowed` from a file
  ```

- `packages/core/src/policy/errors.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/errors.ts` — `MESSAGES.host`, `maxItemsMessage`
  ```

- `packages/core/src/policy/grammar.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/grammar.ts` — `POLICY_PATTERNS.HOST`, `GRAMMARS.host`
  ```

- `packages/core/src/policy/limits.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/limits.ts` — `POLICY_MAX_HOST`, `POLICY_MAX_ALLOWED_HOSTS`
  ```

- `packages/core/src/policy/types.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/types.ts` — `PolicyDependencies.allowed_hosts`
  ```

- `packages/core/src/policy/validate.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/policy/validate.ts` — `listOf` max parameter; `dependencies.allowed_hosts`
  ```

- `packages/core/src/render/markdown.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/render/markdown.ts` — the `DEPENDENCY_D05` advice names `dependency-allowed-hosts`
  ```

- `packages/core/test/ac-ti081516-docs.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/ac-ti081516-docs.test.ts` — re-pin: `dependency-allowed-hosts` joins the set-aside of new action.yml inputs
  ```

- `packages/core/test/dependencies-render.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/dependencies-render.test.ts` — re-pin (literal): the D05 hint line gains the allow-list sentence
  ```

- `packages/core/test/dependencies-settings.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/dependencies-settings.test.ts` — add precedence and `.pharn/ci.yml` refusal cases; existing cases unchanged
  ```

- `packages/core/test/policy-schema.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/policy-schema.test.ts` — add Ajv/validator boundary cases for the host grammar and the 50-item cap
  ```

- `pharn.config.json` — _dirty-before-run; not named in PLAN ## Files_
- `schema/policy.v1.json`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `schema/policy.v1.json` — `$defs.host` and `dependencies.allowed_hosts` with its tighten rule; `registries` description reworded
  ```

- `fixtures/dependencies/d05-private-host/base/package-lock.json.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/base/package-lock.json.txt` — new fixture: base lockfile
  ```

- `fixtures/dependencies/d05-private-host/base/package.json.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/base/package.json.txt` — new fixture: base manifest
  ```

- `fixtures/dependencies/d05-private-host/base/requirements.txt.fixture`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/base/requirements.txt.fixture` — new fixture: base requirements
  ```

- `fixtures/dependencies/d05-private-host/change.diff`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/change.diff` — new fixture: the diff of the private-host case
  ```

- `fixtures/dependencies/d05-private-host/files.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/files.txt` — new fixture: tracked files at HEAD
  ```

- `fixtures/dependencies/d05-private-host/head/package-lock.json.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/head/package-lock.json.txt` — new fixture: head lockfile with entries on the private host and one git source
  ```

- `fixtures/dependencies/d05-private-host/head/package.json.txt`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/head/package.json.txt` — new fixture: head manifest with a URL dependency on the private host
  ```

- `fixtures/dependencies/d05-private-host/head/requirements.txt.fixture`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `fixtures/dependencies/d05-private-host/head/requirements.txt.fixture` — new fixture: head requirements with an index option on the private host
  ```

- `packages/action/test/ac-d05-allow-adapters.test.ts` — _not named in PLAN ## Files_
- `packages/cli/test/ac-d05-allow-input.test.ts` — _not named in PLAN ## Files_
- `packages/core/src/dependencies/hosts.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/src/dependencies/hosts.ts` — new: `isRegistryHostName`, `parseAllowedHosts` (trim, skip empty, host grammar, max 50, lower-case, de-duplicate)
  ```

- `packages/core/test/ac-d05-allow-advice.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-app-policy.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-app-replaces.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-app-subset.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-config.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-default.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-docs.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-file-policy.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-lookups.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-manifests.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-policy-schema.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/ac-d05-allow-url-rules.test.ts` — _not named in PLAN ## Files_
- `packages/core/test/dependencies-allowed-hosts.test.ts`

  planned purpose (PLAN.md), quoted as DATA:

  ```text
  - `packages/core/test/dependencies-allowed-hosts.test.ts` — new build-owned fixture test through `check()`, with `expectValidReport`
  ```

- `pharn/features/d05-private-registry-allowlist/AC-TESTS.lock.json` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/AC-TESTS.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/BUILD.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/GRILL.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/LOOP.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/PLAN.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/REGRESSION.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/SPEC.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/VERIFY.md` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/cost.json` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/regression-report.json` — _not named in PLAN ## Files_
- `pharn/features/d05-private-registry-allowlist/verify-report.json` — _not named in PLAN ## Files_

## Verdicts

**iteration 3 (final) only.** `/pharn-loop` OVERWRITES `verify-report.json` and `regression-report.json`
in place whenever it re-runs those stages, so earlier iterations' verdicts are not on disk at the
stop and this
report will not invent them. Per-iteration **cost** is genuine and is in `## Tokens` above.

- isolation: HOST (host execution accepted by operator)

- verify: `FAIL`

  failing_gates, quoted as DATA:

  ```text
  test
  ```

- acceptance criteria: `PASS` (test-first)

  the AC gate — id, level, status, reason, matched test ids — quoted as DATA:

  ```text
  AC-1  integration  passed  delivered  packages/action/test/ac-d05-allow-adapters.test.ts::an allowed private registry host through the adapters › AC-1: one CLI --dependency-allowed-host flag lets the same entry pass, and the JSON report never names the host | packages/action/test/ac-d05-allow-adapters.test.ts::an allowed private registry host through the adapters › AC-1: the Action input dependency-allowed-hosts lets a lockfile entry from that host pass, and the report never names the host
  AC-2  integration  passed  delivered  packages/core/test/ac-d05-allow-default.test.ts::no allowed-hosts setting › AC-2: the private-host lockfile entry is a D05 block with a DEPENDENCY_D05 error, exactly as 0.9.1 reports it, and only because no host is allowed
  AC-3  unit  passed  delivered  packages/core/test/ac-d05-allow-url-rules.test.ts::allowed hosts keep the URL rules › AC-3: http, user info, a port or a longer host name on the allowed host is a D05 block; plain https on it is not
  AC-4  integration  passed  delivered  packages/core/test/ac-d05-allow-manifests.test.ts::an allowed host in manifests and requirements files › AC-4: a pyproject `name @ url`, a requirements --index-url and a package.json URL on the allowed host are not D05; on another host each is
  AC-5  unit  passed  delivered  packages/cli/test/ac-d05-allow-input.test.ts::the allowed-hosts input › AC-5: an empty entry between two hosts is skipped, not an error, and the two hosts are allowed | packages/cli/test/ac-d05-allow-input.test.ts::the allowed-hosts input › AC-5: an entry that is not a host name, or 51 entries, is an input error naming the input or flag and saying what a host name is | packages/cli/test/ac-d05-allow-input.test.ts::the allowed-hosts input › AC-5: the CLI exits 2 on a --dependency-allowed-host that is not a host name, says what a host name is, and writes no report
  AC-6  unit  passed  delivered  packages/core/test/ac-d05-allow-config.test.ts::.pharn/ci.yml and the allowed hosts › AC-6: dependencies.allowed_hosts with any value is a ConfigError saying the change under review can edit the file, naming the dependency-allowed-hosts input
  AC-7  integration  passed  delivered  packages/core/test/ac-d05-allow-app-policy.test.ts::an app policy's allowed hosts › AC-7: with no input, the app policy's dependencies.allowed_hosts allows the host: no D05, no POLICY_OVERRIDE_IGNORED, policy source app
  AC-8  integration  passed  delivered  packages/core/test/ac-d05-allow-app-replaces.test.ts::the app policy replaces the input's allowed hosts › AC-8: an input host the app list does not name is D05 block, with one POLICY_OVERRIDE_IGNORED warning naming dependencies.allowed_hosts (input) and no host, and the verdict is not pass
  AC-9  unit  passed  delivered  packages/core/test/ac-d05-allow-app-subset.test.ts::an input host the app policy also names › AC-9: nothing is recorded as ignored, the host stays allowed, and no POLICY_OVERRIDE_IGNORED message is in the report
  AC-10  integration  passed  delivered  packages/core/test/ac-d05-allow-file-policy.test.ts::a policy file's allowed hosts › AC-10: a file: policy's dependencies.allowed_hosts allows nothing (the entry is D05) and POLICY_OVERRIDE_IGNORED names dependencies.allowed_hosts (policy-file)
  AC-11  unit  passed  delivered  packages/core/test/ac-d05-allow-lookups.test.ts::lookups and allowed private hosts › AC-11: with lookups on, corp-utils from an allowed private host is not planned, exactly as when the host is not allowed, and it is no D05 finding
  AC-12  unit  passed  delivered  packages/core/test/ac-d05-allow-advice.test.ts::the DEPENDENCY_D05 advice › AC-12: the hint under the D05 finding names dependency-allowed-hosts for a registry the team runs
  AC-13  unit  passed  delivered  packages/core/test/ac-d05-allow-policy-schema.test.ts::dependencies.allowed_hosts in the org policy › AC-13: schema/policy.v1.json accepts host names and refuses a URL, a non-string or 51 entries under /dependencies/allowed_hosts, repeating no value | packages/core/test/ac-d05-allow-policy-schema.test.ts::dependencies.allowed_hosts in the org policy › AC-13: validatePolicy accepts host names and refuses a URL, a non-string or 51 entries under /dependencies/allowed_hosts, repeating no value
  AC-14  unit  passed  delivered  packages/core/test/ac-d05-allow-docs.test.ts::the allowed hosts in the documentation › AC-14: README documents dependency-allowed-hosts, --dependency-allowed-host and dependencies.allowed_hosts, each with the host-name rules | packages/core/test/ac-d05-allow-docs.test.ts::the allowed hosts in the documentation › AC-14: schema/policy.v1.json describes dependencies.allowed_hosts with its tighten rule
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
- The build agent of iteration 1 reported editing `packages/core/src/dependencies/check.ts` through a Bash script instead of the Edit tool (recorded in `BUILD.md`); the reconcile gate is the place that sees it.
- `pharn.config.json` was modified before the run and is not part of this change.
```

### learned

```text
- The spec put the host allow-list in the workflow input `dependency-allowed-hosts` (CLI `--dependency-allowed-host`) and the app policy key `dependencies.allowed_hosts`, and made `.pharn/ci.yml` refuse the key. This differs from the increment description, which asked for `dependencies.registries` in `.pharn/ci.yml`; the SPEC's first Assumptions line says why (a PR-editable list would let a change allow its own off-registry source).
- All 14 AC tests pass and regress found nothing; the only red is the plan's missing `input-aliases.test.ts` entry.
```

### next_steps

```text
Add `packages/action/test/input-aliases.test.ts` to the plan's `## Files` and add `"dependency-allowed-hosts"` to its `SHIPPED_INPUTS` list (one entry, nothing removed), or make that one-line edit by hand; the implementation is in the working tree, uncommitted. The SPEC is a Draft: a person decides the ci.yml-versus-input question, then re-approves it.
```
