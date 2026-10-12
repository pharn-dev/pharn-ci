# REGRESSION — coverage-format-selection

base: `fb152902b9156bb94a830de2102a29e5901dcc06` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (38):

```text
CHANGELOG.md
README.md
action.yml
docs/LIMITS.md
docs/THREAT-MODEL.md
fixtures/golden/report.json
packages/action/dist/index.js
packages/action/src/run.ts
packages/action/test/run.test.ts
packages/cli/src/main.ts
packages/cli/test/main.test.ts
packages/core/src/check.ts
packages/core/src/config.ts
packages/core/src/coverage/types.ts
packages/core/src/index.ts
packages/core/src/report.ts
schema/report.v1.json
fixtures/cobertura/clover.xml
fixtures/cobertura/jacoco-native.xml
fixtures/golden-cobertura/coverage.xml
fixtures/golden-cobertura/files.txt
fixtures/golden-cobertura/pr.diff
fixtures/golden-cobertura/report.json
fixtures/golden-cobertura/report.md
packages/action/test/ac-coverage-format.test.ts
packages/cli/test/ac-coverage-format.test.ts
packages/core/src/coverage/detect.ts
packages/core/test/ac-format-check.test.ts
packages/core/test/ac-format-config.test.ts
packages/core/test/ac-format-detect.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-format-schema.test.ts
pharn/features/coverage-format-selection/AC-TESTS.lock.json
pharn/features/coverage-format-selection/AC-TESTS.md
pharn/features/coverage-format-selection/BUILD.md
pharn/features/coverage-format-selection/GRILL.md
pharn/features/coverage-format-selection/PLAN.md
pharn/features/coverage-format-selection/SPEC.md
```

declared (32):

```text
packages/core/src/coverage/detect.ts
packages/core/src/coverage/types.ts
packages/core/src/config.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/core/src/index.ts
schema/report.v1.json
packages/cli/src/main.ts
packages/action/src/run.ts
action.yml
packages/cli/test/main.test.ts
packages/action/test/run.test.ts
fixtures/cobertura/clover.xml
fixtures/cobertura/jacoco-native.xml
fixtures/golden-cobertura/pr.diff
fixtures/golden-cobertura/files.txt
fixtures/golden-cobertura/coverage.xml
fixtures/golden-cobertura/report.json
fixtures/golden-cobertura/report.md
fixtures/golden/report.json
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
CHANGELOG.md
packages/action/dist/index.js
packages/core/test/ac-format-detect.test.ts
packages/core/test/ac-format-check.test.ts
packages/core/test/ac-format-schema.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-format-config.test.ts
packages/cli/test/ac-coverage-format.test.ts
packages/action/test/ac-coverage-format.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/coverage-format-selection/AC-TESTS.lock.json
pharn/features/coverage-format-selection/AC-TESTS.md
pharn/features/coverage-format-selection/BUILD.md
pharn/features/coverage-format-selection/GRILL.md
pharn/features/coverage-format-selection/PLAN.md
pharn/features/coverage-format-selection/SPEC.md
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
