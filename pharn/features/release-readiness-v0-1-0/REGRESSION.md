# REGRESSION — release-readiness-v0-1-0

base: `a66f83485906cf647f1f135cf8bdff53f0b5cd23` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (16):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/RELEASING.md
package.json
packages/core/test/version.test.ts
docs/MARKETPLACE.md
packages/core/test/ac-release-changelog.test.ts
packages/core/test/ac-release-docs.test.ts
packages/core/test/ac-release-version.test.ts
pharn/features/release-readiness-v0-1-0/AC-TESTS.lock.json
pharn/features/release-readiness-v0-1-0/AC-TESTS.md
pharn/features/release-readiness-v0-1-0/BUILD.md
pharn/features/release-readiness-v0-1-0/GRILL.md
pharn/features/release-readiness-v0-1-0/PLAN.md
pharn/features/release-readiness-v0-1-0/SPEC.md
```

declared (11):

```text
package.json
packages/core/test/version.test.ts
CHANGELOG.md
README.md
docs/LIMITS.md
docs/RELEASING.md
docs/MARKETPLACE.md
packages/action/dist/index.js
packages/core/test/ac-release-version.test.ts
packages/core/test/ac-release-changelog.test.ts
packages/core/test/ac-release-docs.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/release-readiness-v0-1-0/AC-TESTS.lock.json
pharn/features/release-readiness-v0-1-0/AC-TESTS.md
pharn/features/release-readiness-v0-1-0/BUILD.md
pharn/features/release-readiness-v0-1-0/GRILL.md
pharn/features/release-readiness-v0-1-0/PLAN.md
pharn/features/release-readiness-v0-1-0/SPEC.md
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
