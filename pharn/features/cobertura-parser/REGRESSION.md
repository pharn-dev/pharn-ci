# REGRESSION — cobertura-parser

base: `e546f912022443757bae015a618da1fc8076f4fa` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (37):

```text
CHANGELOG.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/src/coverage/cobertura.ts
packages/core/src/paths.ts
packages/core/test/lcov.test.ts
packages/core/test/paths.test.ts
fixtures/cobertura/absolute-filenames.xml
fixtures/cobertura/climb.xml
fixtures/cobertura/coveragepy.xml
fixtures/cobertura/coverlet.xml
fixtures/cobertura/empty.xml
fixtures/cobertura/entities.xml
fixtures/cobertura/forms-base.xml
fixtures/cobertura/forms-decorated.xml
fixtures/cobertura/forms-variant.xml
fixtures/cobertura/garbage.xml
fixtures/cobertura/invalid-lines.xml
fixtures/cobertura/jacoco.xml
fixtures/cobertura/methods-branches.xml
fixtures/cobertura/multi-source.xml
fixtures/cobertura/no-lines.xml
fixtures/cobertura/no-sources.xml
fixtures/cobertura/partial-valid.xml
fixtures/cobertura/pytest-cov.xml
fixtures/cobertura/sources-outside.xml
packages/core/src/coverage/xml.ts
packages/core/test/cobertura-check.test.ts
packages/core/test/cobertura-hostile.test.ts
packages/core/test/cobertura.test.ts
pharn/features/cobertura-parser/AC-TESTS.lock.json
pharn/features/cobertura-parser/AC-TESTS.md
pharn/features/cobertura-parser/BUILD.md
pharn/features/cobertura-parser/GRILL.md
pharn/features/cobertura-parser/PLAN.md
pharn/features/cobertura-parser/SPEC.md
```

declared (31):

```text
packages/core/src/coverage/xml.ts
packages/core/src/coverage/cobertura.ts
packages/core/src/paths.ts
packages/core/test/paths.test.ts
packages/core/test/lcov.test.ts
fixtures/cobertura/coveragepy.xml
fixtures/cobertura/pytest-cov.xml
fixtures/cobertura/jacoco.xml
fixtures/cobertura/coverlet.xml
fixtures/cobertura/forms-base.xml
fixtures/cobertura/forms-variant.xml
fixtures/cobertura/forms-decorated.xml
fixtures/cobertura/entities.xml
fixtures/cobertura/invalid-lines.xml
fixtures/cobertura/methods-branches.xml
fixtures/cobertura/absolute-filenames.xml
fixtures/cobertura/multi-source.xml
fixtures/cobertura/no-sources.xml
fixtures/cobertura/sources-outside.xml
fixtures/cobertura/climb.xml
fixtures/cobertura/empty.xml
fixtures/cobertura/garbage.xml
fixtures/cobertura/no-lines.xml
fixtures/cobertura/partial-valid.xml
docs/LIMITS.md
docs/THREAT-MODEL.md
CHANGELOG.md
packages/action/dist/index.js
packages/core/test/cobertura.test.ts
packages/core/test/cobertura-check.test.ts
packages/core/test/cobertura-hostile.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/cobertura-parser/AC-TESTS.lock.json
pharn/features/cobertura-parser/AC-TESTS.md
pharn/features/cobertura-parser/BUILD.md
pharn/features/cobertura-parser/GRILL.md
pharn/features/cobertura-parser/PLAN.md
pharn/features/cobertura-parser/SPEC.md
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
