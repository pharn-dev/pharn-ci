# REGRESSION — report-v2-skeleton

base: `91b6270b6fbdac0bd09bc6fb4b950fb73958200a` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-delivery-run`; entry evidence not used: `no-delivery-run`); not recorded for reuse (`no-delivery-run`).

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (49):

```text
.github/PULL_REQUEST_TEMPLATE.md
CHANGELOG.md
README.md
action.yml
docs/MARKETPLACE.md
docs/RELEASING.md
docs/THREAT-MODEL.md
fixtures/coverage-paths/package-relative/report-warn.json
fixtures/coverage-paths/package-relative/report.json
fixtures/coverage-paths/package-relative/report.md
fixtures/golden-cobertura/report.json
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.json
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.json
fixtures/golden-multi/report.md
fixtures/golden/report.json
fixtures/golden/report.md
fixtures/setup-expect/report-files-missing.json
fixtures/setup-expect/report-no-files-missing.json
packages/action/dist/index.js
packages/action/src/run.ts
packages/cli/test/ac-coverage-format.test.ts
packages/core/src/check.ts
packages/core/src/index.ts
packages/core/src/report.ts
packages/core/src/version.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-comment-bold-footer.test.ts
packages/core/test/ac-comment-look-footer.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-header-logo-data.test.ts
packages/core/test/ac-header-logo-golden.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-verdict-callout-data.test.ts
packages/core/test/ac-verdict-callout-golden.test.ts
packages/core/test/exclusions-golden.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/golden.test.ts
packages/core/test/schema.ts
packages/action/src/run-meta.ts
packages/action/test/ac-report-v2-meta.test.ts
packages/cli/test/ac-report-v2-cli.test.ts
packages/core/test/ac-report-v2-check.test.ts
packages/core/test/ac-report-v2-docs.test.ts
packages/core/test/ac-report-v2-golden.test.ts
packages/core/test/ac-report-v2-schema.test.ts
schema/report.v2.json
```

declared (53):

```text
schema/report.v2.json
packages/core/src/report.ts
packages/core/src/check.ts
packages/core/src/index.ts
packages/core/src/version.ts
packages/core/src/render/markdown.ts
packages/action/src/run-meta.ts
packages/action/src/run.ts
packages/action/dist/index.js
action.yml
packages/core/test/schema.ts
packages/core/test/report.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/golden.test.ts
packages/core/test/exclusions-golden.test.ts
packages/core/test/ac-comment-bold-footer.test.ts
packages/core/test/ac-comment-look-footer.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-format-schema.test.ts
packages/core/test/ac-paths-schema.test.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-header-logo-data.test.ts
packages/core/test/ac-header-logo-golden.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-verdict-callout-data.test.ts
packages/core/test/ac-verdict-callout-golden.test.ts
packages/cli/test/ac-coverage-format.test.ts
fixtures/golden/report.json
fixtures/golden/report.md
fixtures/golden-cobertura/report.json
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.json
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.json
fixtures/golden-multi/report.md
fixtures/coverage-paths/package-relative/report.json
fixtures/coverage-paths/package-relative/report-warn.json
fixtures/coverage-paths/package-relative/report.md
fixtures/setup-expect/report-files-missing.json
fixtures/setup-expect/report-no-files-missing.json
docs/RELEASING.md
CHANGELOG.md
README.md
docs/MARKETPLACE.md
docs/THREAT-MODEL.md
.github/PULL_REQUEST_TEMPLATE.md
packages/core/test/ac-report-v2-schema.test.ts
packages/core/test/ac-report-v2-check.test.ts
packages/core/test/ac-report-v2-golden.test.ts
packages/cli/test/ac-report-v2-cli.test.ts
packages/action/test/ac-report-v2-meta.test.ts
packages/core/test/ac-report-v2-docs.test.ts
```

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
