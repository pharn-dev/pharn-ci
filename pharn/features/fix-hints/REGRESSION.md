# REGRESSION — fix-hints

base: `7d88076280ec86435c3f84ad3c6102e272ab64d5` — chosen by: named with --base

**verdict: 1 REGRESSION(S) OUTSIDE THE FEATURE — STAGE FAILS.**

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `start-dirty`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (124):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
fixtures/coverage-paths/package-relative/report-warn.json
fixtures/coverage-paths/package-relative/report.json
fixtures/golden-cobertura/report.json
fixtures/golden-multi/report.json
fixtures/golden/report.json
packages/action/dist/index.js
packages/action/test/ac-accept-signoff-default-golden.test.ts
packages/action/test/ac-accept-signoff-regression.test.ts
packages/action/test/ac-policy3-outcomes.test.ts
packages/action/test/ac-polset-action.test.ts
packages/action/test/ac-pyparity2-unchanged.test.ts
packages/action/test/ac-upload-url-failures.test.ts
packages/action/test/setup-sizes.test.ts
packages/action/test/stale-instructions-action.test.ts
packages/cli/test/ac-inventory-empty.test.ts
packages/cli/test/ac-polset-cli.test.ts
packages/cli/test/stale-instructions-cli.test.ts
packages/core/src/acceptLabel.ts
packages/core/src/dependencies/types.ts
packages/core/src/index.ts
packages/core/src/report.ts
packages/core/src/upload/outcome.ts
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-globs-check.test.ts
packages/core/test/ac-header-logo-data.test.ts
packages/core/test/ac-name-only-suite.test.ts
packages/core/test/ac-p07-schema-hints.test.ts
packages/core/test/ac-p07-unchanged.test.ts
packages/core/test/ac-p11-agent-vs-human.test.ts
packages/core/test/ac-p11-diff-kinds.test.ts
packages/core/test/ac-p11-diff-unavailable.test.ts
packages/core/test/ac-p11-incomplete.test.ts
packages/core/test/ac-p11-policy-file-base.test.ts
packages/core/test/ac-p11-schema-hints.test.ts
packages/core/test/ac-p11-unchanged.test.ts
packages/core/test/ac-p14-caps.test.ts
packages/core/test/ac-p14-policy-file.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-policy3-unchanged.test.ts
packages/core/test/ac-polrules-p01-expect.test.ts
packages/core/test/ac-polrules-p01-require.test.ts
packages/core/test/ac-polrules-p08-forbidden.test.ts
packages/core/test/ac-polrules-p09-config.test.ts
packages/core/test/ac-polrules-p09-policy-file.test.ts
packages/core/test/ac-polrules-p09-settings.test.ts
packages/core/test/ac-polrules-p09-workflow.test.ts
packages/core/test/ac-polrules-p10.test.ts
packages/core/test/ac-polrules-report.test.ts
packages/core/test/ac-polset-absent.test.ts
packages/core/test/ac-polset-budget.test.ts
packages/core/test/ac-polset-duplicate-deny.test.ts
packages/core/test/ac-polset-messages.test.ts
packages/core/test/ac-polset-p02-allow.test.ts
packages/core/test/ac-polset-p02-fixed.test.ts
packages/core/test/ac-polset-p03.test.ts
packages/core/test/ac-polset-p04.test.ts
packages/core/test/ac-polset-p05.test.ts
packages/core/test/ac-polset-p06.test.ts
packages/core/test/ac-polset-p09.test.ts
packages/core/test/ac-polset-pins.test.ts
packages/core/test/ac-polset-unavailable.test.ts
packages/core/test/ac-precision-v030-schema.test.ts
packages/core/test/ac-py-index-docs.test.ts
packages/core/test/ac-pyparity2-ti09-headers.test.ts
packages/core/test/ac-report-v2-check.test.ts
packages/core/test/ac-secrets-repin.test.ts
packages/core/test/ac-test-integrity-mode-render.test.ts
packages/core/test/ac-test-sources-docs.test.ts
packages/core/test/ac-ti01-unparsed.test.ts
packages/core/test/ac-ti0102-regression.test.ts
packages/core/test/ac-ti0205-regression.test.ts
packages/core/test/ac-ti0304-regression.test.ts
packages/core/test/ac-ti06-ti12-unchanged.test.ts
packages/core/test/ac-ti07-schema.test.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/core/test/ac-ti09-opaque-head.test.ts
packages/core/test/ac-ti1013-regression.test.ts
packages/core/test/ac-unparseable-cases.test.ts
packages/core/test/ac-unread-added.test.ts
packages/core/test/ac-upload-outcome.test.ts
packages/core/test/ac-upload-schema.test.ts
packages/core/test/ac-verdict-callout-data.test.ts
packages/core/test/dependencies-check.test.ts
packages/core/test/dependencies-registry.test.ts
packages/core/test/docs-schema-levels.test.ts
packages/core/test/golden.test.ts
packages/core/test/injection-check.test.ts
packages/core/test/injection-policy.test.ts
packages/core/test/injection-schema.test.ts
packages/core/test/report-unsafe-chars.test.ts
packages/core/test/report.test.ts
packages/core/test/setup-sizes.test.ts
packages/core/test/stale-check.test.ts
packages/core/test/stale-docs.test.ts
packages/core/test/threshold-semantics.test.ts
packages/node-io/test/ac-ti07-moved.test.ts
pharn.config.json
schema/report.v2.json
packages/action/test/ac-fix-hints-action.test.ts
packages/cli/test/ac-fix-hints-golden.test.ts
packages/core/src/fix/attach.ts
packages/core/src/fix/table.ts
packages/core/test/ac-fix-hints-docs.test.ts
packages/core/test/ac-fix-hints-findings.test.ts
packages/core/test/ac-fix-hints-kinds.test.ts
packages/core/test/ac-fix-hints-mapping.test.ts
packages/core/test/ac-fix-hints-messages.test.ts
packages/core/test/ac-fix-hints-no-leak.test.ts
packages/core/test/ac-fix-hints-pins.test.ts
packages/core/test/ac-fix-hints-schema.test.ts
packages/core/test/ac-fix-hints-table.test.ts
packages/core/test/ac-fix-hints-upload.test.ts
packages/core/test/ac-fix-hints-words.test.ts
packages/core/test/v090-codes.ts
pharn/features/fix-hints/AC-TESTS.lock.json
pharn/features/fix-hints/AC-TESTS.md
pharn/features/fix-hints/BUILD.md
pharn/features/fix-hints/GRILL.md
pharn/features/fix-hints/PLAN.md
pharn/features/fix-hints/SPEC.md
```

declared (117):

```text
packages/core/src/fix/table.ts
packages/core/src/fix/attach.ts
packages/core/src/report.ts
packages/core/src/dependencies/types.ts
packages/core/src/acceptLabel.ts
packages/core/src/upload/outcome.ts
packages/core/src/index.ts
schema/report.v2.json
README.md
CHANGELOG.md
docs/LIMITS.md
fixtures/golden/report.json
fixtures/golden-cobertura/report.json
fixtures/golden-multi/report.json
fixtures/coverage-paths/package-relative/report.json
fixtures/coverage-paths/package-relative/report-warn.json
packages/action/dist/index.js
packages/core/test/v090-codes.ts
packages/action/test/ac-accept-signoff-default-golden.test.ts
packages/action/test/ac-accept-signoff-regression.test.ts
packages/action/test/ac-policy3-outcomes.test.ts
packages/action/test/ac-polset-action.test.ts
packages/action/test/ac-pyparity2-unchanged.test.ts
packages/action/test/ac-upload-url-failures.test.ts
packages/action/test/setup-sizes.test.ts
packages/action/test/stale-instructions-action.test.ts
packages/cli/test/ac-inventory-empty.test.ts
packages/cli/test/ac-polset-cli.test.ts
packages/cli/test/stale-instructions-cli.test.ts
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-globs-check.test.ts
packages/core/test/ac-header-logo-data.test.ts
packages/core/test/ac-name-only-suite.test.ts
packages/core/test/ac-p07-schema-hints.test.ts
packages/core/test/ac-p07-unchanged.test.ts
packages/core/test/ac-p11-agent-vs-human.test.ts
packages/core/test/ac-p11-diff-kinds.test.ts
packages/core/test/ac-p11-diff-unavailable.test.ts
packages/core/test/ac-p11-incomplete.test.ts
packages/core/test/ac-p11-policy-file-base.test.ts
packages/core/test/ac-p11-schema-hints.test.ts
packages/core/test/ac-p11-unchanged.test.ts
packages/core/test/ac-p14-caps.test.ts
packages/core/test/ac-p14-policy-file.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-policy3-unchanged.test.ts
packages/core/test/ac-polrules-p01-expect.test.ts
packages/core/test/ac-polrules-p01-require.test.ts
packages/core/test/ac-polrules-p08-forbidden.test.ts
packages/core/test/ac-polrules-p09-config.test.ts
packages/core/test/ac-polrules-p09-policy-file.test.ts
packages/core/test/ac-polrules-p09-settings.test.ts
packages/core/test/ac-polrules-p09-workflow.test.ts
packages/core/test/ac-polrules-p10.test.ts
packages/core/test/ac-polrules-report.test.ts
packages/core/test/ac-polset-absent.test.ts
packages/core/test/ac-polset-budget.test.ts
packages/core/test/ac-polset-duplicate-deny.test.ts
packages/core/test/ac-polset-messages.test.ts
packages/core/test/ac-polset-p02-allow.test.ts
packages/core/test/ac-polset-p02-fixed.test.ts
packages/core/test/ac-polset-p03.test.ts
packages/core/test/ac-polset-p04.test.ts
packages/core/test/ac-polset-p05.test.ts
packages/core/test/ac-polset-p06.test.ts
packages/core/test/ac-polset-p09.test.ts
packages/core/test/ac-polset-pins.test.ts
packages/core/test/ac-polset-unavailable.test.ts
packages/core/test/ac-precision-v030-schema.test.ts
packages/core/test/ac-py-index-docs.test.ts
packages/core/test/ac-pyparity2-ti09-headers.test.ts
packages/core/test/ac-report-v2-check.test.ts
packages/core/test/ac-secrets-repin.test.ts
packages/core/test/ac-test-integrity-mode-render.test.ts
packages/core/test/ac-test-sources-docs.test.ts
packages/core/test/ac-ti01-unparsed.test.ts
packages/core/test/ac-ti0102-regression.test.ts
packages/core/test/ac-ti0205-regression.test.ts
packages/core/test/ac-ti0304-regression.test.ts
packages/core/test/ac-ti06-ti12-unchanged.test.ts
packages/core/test/ac-ti07-schema.test.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/core/test/ac-ti09-opaque-head.test.ts
packages/core/test/ac-ti1013-regression.test.ts
packages/core/test/ac-unparseable-cases.test.ts
packages/core/test/ac-unread-added.test.ts
packages/core/test/ac-upload-outcome.test.ts
packages/core/test/ac-upload-schema.test.ts
packages/core/test/ac-verdict-callout-data.test.ts
packages/core/test/dependencies-check.test.ts
packages/core/test/dependencies-registry.test.ts
packages/core/test/docs-schema-levels.test.ts
packages/core/test/golden.test.ts
packages/core/test/injection-check.test.ts
packages/core/test/injection-policy.test.ts
packages/core/test/injection-schema.test.ts
packages/core/test/report-unsafe-chars.test.ts
packages/core/test/report.test.ts
packages/core/test/setup-sizes.test.ts
packages/core/test/stale-check.test.ts
packages/core/test/stale-docs.test.ts
packages/core/test/threshold-semantics.test.ts
packages/node-io/test/ac-ti07-moved.test.ts
packages/core/test/ac-fix-hints-kinds.test.ts
packages/core/test/ac-fix-hints-table.test.ts
packages/core/test/ac-fix-hints-words.test.ts
packages/core/test/ac-fix-hints-mapping.test.ts
packages/core/test/ac-fix-hints-findings.test.ts
packages/core/test/ac-fix-hints-messages.test.ts
packages/core/test/ac-fix-hints-no-leak.test.ts
packages/core/test/ac-fix-hints-schema.test.ts
packages/cli/test/ac-fix-hints-golden.test.ts
packages/core/test/ac-fix-hints-upload.test.ts
packages/action/test/ac-fix-hints-action.test.ts
packages/core/test/ac-fix-hints-pins.test.ts
packages/core/test/ac-fix-hints-docs.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/fix-hints/AC-TESTS.lock.json
pharn/features/fix-hints/AC-TESTS.md
pharn/features/fix-hints/BUILD.md
pharn/features/fix-hints/GRILL.md
pharn/features/fix-hints/PLAN.md
pharn/features/fix-hints/SPEC.md
```

already changed when this run began (1) — the run's pre-run snapshot recorded these with exactly the bytes they hold now, so they are reported, NOT counted as this build's escape (a re-run records an earlier run's escape the same way; pre-run-snapshot-core.mjs states the bounds):

```text
pharn.config.json
```

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 1 — REGRESSION — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (1): test

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
