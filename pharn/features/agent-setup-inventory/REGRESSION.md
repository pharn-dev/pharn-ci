# REGRESSION — agent-setup-inventory

base: `e546f912022443757bae015a618da1fc8076f4fa` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (25):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
fixtures/golden/report.json
fixtures/golden/report.md
packages/action/dist/index.js
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/src/setup/scan.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/scan.test.ts
schema/report.v1.json
fixtures/setup/all-kinds.txt
packages/core/src/setup/summary.ts
packages/core/test/ac-setup-classify.test.ts
packages/core/test/ac-setup-render.test.ts
packages/core/test/ac-setup-rules.test.ts
packages/core/test/ac-setup-summary.test.ts
pharn/features/agent-setup-inventory/AC-TESTS.lock.json
pharn/features/agent-setup-inventory/AC-TESTS.md
pharn/features/agent-setup-inventory/BUILD.md
pharn/features/agent-setup-inventory/GRILL.md
pharn/features/agent-setup-inventory/PLAN.md
pharn/features/agent-setup-inventory/SPEC.md
```

declared (19):

```text
packages/core/src/setup/scan.ts
packages/core/src/setup/summary.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
schema/report.v1.json
fixtures/setup/all-kinds.txt
fixtures/golden/report.json
fixtures/golden/report.md
packages/core/test/scan.test.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/action/dist/index.js
README.md
docs/LIMITS.md
CHANGELOG.md
packages/core/test/ac-setup-classify.test.ts
packages/core/test/ac-setup-rules.test.ts
packages/core/test/ac-setup-summary.test.ts
packages/core/test/ac-setup-render.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/agent-setup-inventory/AC-TESTS.lock.json
pharn/features/agent-setup-inventory/AC-TESTS.md
pharn/features/agent-setup-inventory/BUILD.md
pharn/features/agent-setup-inventory/GRILL.md
pharn/features/agent-setup-inventory/PLAN.md
pharn/features/agent-setup-inventory/SPEC.md
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
