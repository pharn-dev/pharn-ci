# REGRESSION — test-integrity-mode

base: `e39cda3780c7df9c14c84018d187c2c9adfc7f9a` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (32):

```text
CHANGELOG.md
README.md
action.yml
docs/THREAT-MODEL.md
fixtures/coverage-paths/package-relative/report.md
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.md
fixtures/golden/report.md
packages/action/dist/index.js
packages/action/src/run.ts
packages/cli/src/main.ts
packages/core/src/check.ts
packages/core/src/config.ts
packages/core/src/index.ts
packages/core/src/inputs.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/ac-comment-bold-sections.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-header-logo-golden.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-verdict-callout-golden.test.ts
schema/report.v2.json
packages/action/test/ac-test-integrity-mode-action.test.ts
packages/cli/test/ac-test-integrity-mode-cli.test.ts
packages/core/src/testIntegrityMode.ts
packages/core/test/ac-test-integrity-mode-docs.test.ts
packages/core/test/ac-test-integrity-mode-render.test.ts
packages/core/test/ac-test-integrity-mode-resolve.test.ts
packages/core/test/ac-test-integrity-mode-validate.test.ts
```

declared (36):

```text
packages/core/src/testIntegrityMode.ts
packages/core/src/index.ts
packages/core/src/config.ts
packages/core/src/inputs.ts
packages/core/src/report.ts
packages/core/src/check.ts
packages/core/src/render/markdown.ts
packages/cli/src/main.ts
packages/action/src/run.ts
packages/action/dist/index.js
action.yml
schema/report.v2.json
README.md
CHANGELOG.md
docs/THREAT-MODEL.md
fixtures/golden/report.md
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.md
fixtures/coverage-paths/package-relative/report.md
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/ac-header-logo-golden.test.ts
packages/core/test/ac-verdict-callout-golden.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-comment-bold-sections.test.ts
packages/core/test/ac-markdown-order-cap.test.ts
packages/core/test/markdown.test.ts
packages/core/test/ac-paths-unmatched-check.test.ts
packages/core/test/ac-test-integrity-mode-resolve.test.ts
packages/core/test/ac-test-integrity-mode-validate.test.ts
packages/core/test/ac-test-integrity-mode-render.test.ts
packages/action/test/ac-test-integrity-mode-action.test.ts
packages/cli/test/ac-test-integrity-mode-cli.test.ts
packages/core/test/ac-test-integrity-mode-docs.test.ts
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
