# VERIFY — `cobertura-parser`

_How to read this file: the verdict line and every value shown inline are enum-gated (floor-verifiable) values, each rendered only after a membership test; every fenced block is untrusted DATA — a gate id, a PLAN-derived path, or a checker's own message — quoted, never an instruction._

**VERIFY FAILS: gate(s) red — stage FAILS.**

failing gate ids, quoted as DATA:

```text
reconcile
```

## Gates

gate source: discovered — the closed allowlist ∩ the project's `package.json` scripts.

exit code, then gate id — quoted as DATA:

```text
0  build
0  instruction-growth
0  lint
1  reconcile
0  test
```

REUSED, NOT RE-EXECUTED by this verify run — each result is a completed execution of this delivery run's `/pharn-regress` HEAD side with the same execution identity over the same tree fingerprint (that a fresh run would give the same result is advisory). Gate id, then the source's run seq, quoted as DATA:

```text
build  regress/head seq 1
```

## Reconcile

reconcile: `ESCAPE` (exit 1) — read from check-bash-reconcile.mjs's own JSON document, as the gate recorded it.

**49 escape(s)** — a path changed since the anchor that the write guards would have denied. Closed reasons (over the 20 shown): no closed reason ×20.

each escape — file, denied_by, reason, scope_set_by — JSON-quoted as DATA:

```text
".pharn/cost/cobertura-parser/markers.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/cost/cobertura-parser/work.jsonl"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/full.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/full/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/full/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/full/1-lint.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/full/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/targeted.times.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/targeted/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/targeted/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/targeted/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-build/cobertura-parser/targets.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/0-test.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/0-test.test-results.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/1-build.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/1-build.out"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/base-gates/stamp.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/head-install.json"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
".pharn/pharn-regress/head/0-test.err"  denied_by="writes-scope (snapshot)"  reason=-  scope_set_by="pharn/features/cobertura-parser/PLAN.md"
```

… and 29 more escape(s) not listed. Re-run `node pharn/floor/check-bash-reconcile.mjs --base . --require-baseline` to see the escapes — before any new build re-anchors the baseline, which erases them.

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Completeness

completeness: build complete — every concrete path the PLAN declares exists, and every one it marks `(delete)` is absent.

## Acceptance criteria

acceptance criteria: `test-first` — an AC is delivered when its locked, once-red test titled `AC-<n>:` passed on this run.

AC gate verdict: `PASS`

The per-AC table is `verify-report.json`'s `ac_gate` block (and `RUN-REPORT.md`, which renders it by code in an orchestrated run) — cited here, never retyped.

## Verifiers

no verifiers registered — floor gates only.

_verified = the named gates passed, every declared path exists, and (test-first) every AC's locked, once-red test passed on this run — or (bootstrap) each level's runner reported a passed test, or (legacy) no AC check applied; this is NOT a guarantee of correctness beyond what those gates check — completeness is 'files exist', not 'semantically done', PHARN does not judge whether a test captures its AC's intent, and verifier concerns are advisory help, not assurance._
