# REGRESSION — coverage-exclusions

base: `8cc31571e0fa196543f8452deaa8e1eb3b116939` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: taken from this run's ENTRY gates — the run marker, the entry offer, the pre-run snapshot, the entry stamp (sha256 `550716ea7eaa6cedc7dbeebbab76f0b63657b3c808fb406767bf3910e05f86ee`) and its logs agree with this invocation's BASE slots at `8cc31571e0fa196543f8452deaa8e1eb3b116939`, so this invocation created no base worktree, ran no install and spawned no base gate (retained evidence not reused: `no-record`). The base stamp marks every slot `reused` from the entry run (`test`, `build`). That they equal what a fresh BASE worktree would give is NOT claimed: the entry gates ran in this tree's real start environment.

install: none run by this invocation (the BASE evidence came from this run's entry gates).

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (35):

```text
CHANGELOG.md
README.md
action.yml
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/action/src/run.ts
packages/cli/src/main.ts
packages/core/src/check.ts
packages/core/src/config.ts
packages/core/src/diffCoverage.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
schema/report.v1.json
fixtures/golden-exclusions/ci.yml
fixtures/golden-exclusions/coverage.info
fixtures/golden-exclusions/files.txt
fixtures/golden-exclusions/pr.diff
fixtures/golden-exclusions/report.json
fixtures/golden-exclusions/report.md
packages/action/test/exclude.test.ts
packages/cli/test/exclude.test.ts
packages/core/src/glob.ts
packages/core/test/config-exclude.test.ts
packages/core/test/exclusions-check.test.ts
packages/core/test/exclusions-golden.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/glob.test.ts
pharn/features/coverage-exclusions/AC-TESTS.lock.json
pharn/features/coverage-exclusions/AC-TESTS.md
pharn/features/coverage-exclusions/BUILD.md
pharn/features/coverage-exclusions/GRILL.md
pharn/features/coverage-exclusions/PLAN.md
pharn/features/coverage-exclusions/SPEC.md
```

declared (29):

```text
packages/core/src/glob.ts
packages/core/src/config.ts
packages/core/src/diffCoverage.ts
packages/core/src/report.ts
packages/core/src/check.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
schema/report.v1.json
packages/cli/src/main.ts
packages/action/src/run.ts
action.yml
fixtures/golden-exclusions/ci.yml
fixtures/golden-exclusions/pr.diff
fixtures/golden-exclusions/coverage.info
fixtures/golden-exclusions/files.txt
fixtures/golden-exclusions/report.json
fixtures/golden-exclusions/report.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
CHANGELOG.md
packages/action/dist/index.js
packages/core/test/glob.test.ts
packages/core/test/config-exclude.test.ts
packages/core/test/exclusions-check.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/exclusions-golden.test.ts
packages/cli/test/exclude.test.ts
packages/action/test/exclude.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/coverage-exclusions/AC-TESTS.lock.json
pharn/features/coverage-exclusions/AC-TESTS.md
pharn/features/coverage-exclusions/BUILD.md
pharn/features/coverage-exclusions/GRILL.md
pharn/features/coverage-exclusions/PLAN.md
pharn/features/coverage-exclusions/SPEC.md
```

pre-run snapshot: applied — no undeclared path was already changed when this run began.

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
