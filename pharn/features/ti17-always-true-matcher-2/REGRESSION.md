# REGRESSION — ti17-always-true-matcher-2

base: `12036e8c485a656eeb9a4a9beb869e51e37b7d80` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (130):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/PRECISION.md
docs/THREAT-MODEL.md
fixtures/policy/invalid/unknown-ti.json
fixtures/policy/invalid/unknown-ti.paths
packages/action/dist/index.js
packages/action/test/ac-accept-signoff-regression.test.ts
packages/action/test/ac-pyparity2-unchanged.test.ts
packages/core/src/check.ts
packages/core/src/fix/table.ts
packages/core/src/index.ts
packages/core/src/policy/limits.ts
packages/core/src/policy/types.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/src/signals/signalFiles.ts
packages/core/test/ac-fix-hints-mapping.test.ts
packages/core/test/ac-fix-hints-pins.test.ts
packages/core/test/ac-name-only-suite.test.ts
packages/core/test/ac-p07-schema-hints.test.ts
packages/core/test/ac-p07-unchanged.test.ts
packages/core/test/ac-p11-schema-hints.test.ts
packages/core/test/ac-p11-unchanged.test.ts
packages/core/test/ac-polrules-docs.test.ts
packages/core/test/ac-precision-v030-readme.test.ts
packages/core/test/ac-precision-v030-schema.test.ts
packages/core/test/ac-py-index-docs.test.ts
packages/core/test/ac-pyparity2-limits.test.ts
packages/core/test/ac-release030-readme-signals.test.ts
packages/core/test/ac-report-v2-schema.test.ts
packages/core/test/ac-secrets-repin.test.ts
packages/core/test/ac-signal-precision-ti06-weakening.test.ts
packages/core/test/ac-skylos-nine-misses.test.ts
packages/core/test/ac-skylos-nine-table.test.ts
packages/core/test/ac-skylos-pytest-limits.test.ts
packages/core/test/ac-skylos-pytest-notes.test.ts
packages/core/test/ac-skylos-pytest-readme-changelog.test.ts
packages/core/test/ac-skylos-pytest-ti17.test.ts
packages/core/test/ac-test-sources-docs.test.ts
packages/core/test/ac-ti0205-skylos.test.ts
packages/core/test/ac-ti06-ti12-docs.test.ts
packages/core/test/ac-ti06-ti12-skylos.test.ts
packages/core/test/ac-ti06-ti12-unchanged.test.ts
packages/core/test/ac-ti07-schema.test.ts
packages/core/test/ac-ti07-skylos.test.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/core/test/ac-ti09y-regression.test.ts
packages/core/test/ac-ti09y-skylos.test.ts
packages/core/test/ac-upload-schema.test.ts
packages/core/test/ac-v020-limits.test.ts
packages/core/test/ac-v020-readme.test.ts
packages/core/test/ac-v020-skylos-count.test.ts
packages/core/test/docs-schema-levels.test.ts
packages/node-io/test/ac-skylos-pytest-misses.test.ts
packages/node-io/test/ac-skylos-pytest-table.test.ts
packages/node-io/test/ac-skylos-pytest-warn.test.ts
schema/policy.v1.json
schema/report.v2.json
fixtures/test-integrity/TI17/pass-helper-compares.diff
fixtures/test-integrity/TI17/pass-helper-in-condition.diff
fixtures/test-integrity/TI17/pass-helper-mixed.diff
fixtures/test-integrity/TI17/pass-helper-source-file.diff
fixtures/test-integrity/TI17/pass-helper-undefined.diff
fixtures/test-integrity/TI17/pass-helper-unused.diff
fixtures/test-integrity/TI17/pass-matcher-compares.diff
fixtures/test-integrity/TI17/pass-matcher-mixed.diff
fixtures/test-integrity/TI17/pass-matcher-not-called.diff
fixtures/test-integrity/TI17/pass-matcher-removed-only.diff
fixtures/test-integrity/TI17/pass-matcher-source-file.diff
fixtures/test-integrity/TI17/pass-matcher-undefined.diff
fixtures/test-integrity/TI17/pass-matcher-variable.diff
fixtures/test-integrity/TI17/pass-wildcard-called-with.diff
fixtures/test-integrity/TI17/pass-wildcard-go-test.diff
fixtures/test-integrity/TI17/pass-wildcard-nested.diff
fixtures/test-integrity/TI17/pass-wildcard-new-test.diff
fixtures/test-integrity/TI17/pass-wildcard-python-called-once-with.diff
fixtures/test-integrity/TI17/pass-wildcard-python-called-with.diff
fixtures/test-integrity/TI17/pass-wildcard-python-nested.diff
fixtures/test-integrity/TI17/pass-wildcard-python-new-test.diff
fixtures/test-integrity/TI17/pass-wildcard-python-reindented.diff
fixtures/test-integrity/TI17/pass-wildcard-reindented.diff
fixtures/test-integrity/TI17/warn-helper-pytest.diff
fixtures/test-integrity/TI17/warn-helper-unittest.diff
fixtures/test-integrity/TI17/warn-matcher-arrow.diff
fixtures/test-integrity/TI17/warn-matcher-method-js.diff
fixtures/test-integrity/TI17/warn-matcher-method-ts.diff
fixtures/test-integrity/TI17/warn-wildcard-assertequal.diff
fixtures/test-integrity/TI17/warn-wildcard-mock-any.diff
fixtures/test-integrity/TI17/warn-wildcard-python-any.diff
fixtures/test-integrity/TI17/warn-wildcard-tobe.diff
fixtures/test-integrity/TI17/warn-wildcard-toequal.diff
fixtures/test-integrity/TI17/warn-wildcard-tostrictequal.diff
fixtures/test-integrity/TI17/warn-wildcard-unittest-mock-any.diff
packages/core/src/signals/alwaysTrue.ts
packages/core/src/signals/ti17.ts
packages/core/src/signals/wildcardExpected.ts
packages/core/test/ac-ti17-benchmark-vitest.test.ts
packages/core/test/ac-ti17-changelog-threat.test.ts
packages/core/test/ac-ti17-fix-hints.test.ts
packages/core/test/ac-ti17-fixtures.test.ts
packages/core/test/ac-ti17-growth.test.ts
packages/core/test/ac-ti17-helper-pass.test.ts
packages/core/test/ac-ti17-helper-warn.test.ts
packages/core/test/ac-ti17-limits-readme.test.ts
packages/core/test/ac-ti17-matcher-method.test.ts
packages/core/test/ac-ti17-matcher-pass.test.ts
packages/core/test/ac-ti17-modes.test.ts
packages/core/test/ac-ti17-not-test-files.test.ts
packages/core/test/ac-ti17-one-per-file.test.ts
packages/core/test/ac-ti17-policy-key.test.ts
packages/core/test/ac-ti17-policy-severity.test.ts
packages/core/test/ac-ti17-render.test.ts
packages/core/test/ac-ti17-schemas.test.ts
packages/core/test/ac-ti17-signoff-pins.test.ts
packages/core/test/ac-ti17-wildcard-js-pass.test.ts
packages/core/test/ac-ti17-wildcard-js-warn.test.ts
packages/core/test/ac-ti17-wildcard-py-pass.test.ts
packages/core/test/ac-ti17-wildcard-py-warn.test.ts
packages/core/test/ti17-schema.ts
packages/node-io/test/ac-ti17-benchmark-pytest-any.test.ts
packages/node-io/test/ac-ti17-benchmark-pytest-helper.test.ts
packages/node-io/test/ac-ti17-skylos-count.test.ts
pharn/features/ti17-always-true-matcher-2/AC-TESTS.lock.json
pharn/features/ti17-always-true-matcher-2/AC-TESTS.md
pharn/features/ti17-always-true-matcher-2/BUILD.md
pharn/features/ti17-always-true-matcher-2/GRILL.md
pharn/features/ti17-always-true-matcher-2/PLAN.md
pharn/features/ti17-always-true-matcher-2/SPEC.md
```

declared (127):

```text
packages/core/src/signals/ti17.ts
packages/core/src/signals/alwaysTrue.ts
packages/core/src/signals/wildcardExpected.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/core/src/fix/table.ts
packages/core/src/render/markdown.ts
packages/core/src/policy/types.ts
packages/core/src/policy/limits.ts
packages/core/src/signals/signalFiles.ts
packages/core/src/index.ts
schema/report.v2.json
schema/policy.v1.json
packages/core/test/ti17-schema.ts
fixtures/test-integrity/TI17/warn-matcher-arrow.diff
fixtures/test-integrity/TI17/warn-matcher-method-ts.diff
fixtures/test-integrity/TI17/warn-matcher-method-js.diff
fixtures/test-integrity/TI17/pass-matcher-compares.diff
fixtures/test-integrity/TI17/pass-matcher-mixed.diff
fixtures/test-integrity/TI17/pass-matcher-not-called.diff
fixtures/test-integrity/TI17/pass-matcher-undefined.diff
fixtures/test-integrity/TI17/pass-matcher-variable.diff
fixtures/test-integrity/TI17/pass-matcher-source-file.diff
fixtures/test-integrity/TI17/pass-matcher-removed-only.diff
fixtures/test-integrity/TI17/warn-helper-pytest.diff
fixtures/test-integrity/TI17/warn-helper-unittest.diff
fixtures/test-integrity/TI17/pass-helper-compares.diff
fixtures/test-integrity/TI17/pass-helper-mixed.diff
fixtures/test-integrity/TI17/pass-helper-unused.diff
fixtures/test-integrity/TI17/pass-helper-undefined.diff
fixtures/test-integrity/TI17/pass-helper-in-condition.diff
fixtures/test-integrity/TI17/pass-helper-source-file.diff
fixtures/test-integrity/TI17/warn-wildcard-tobe.diff
fixtures/test-integrity/TI17/warn-wildcard-toequal.diff
fixtures/test-integrity/TI17/warn-wildcard-tostrictequal.diff
fixtures/test-integrity/TI17/warn-wildcard-python-any.diff
fixtures/test-integrity/TI17/warn-wildcard-mock-any.diff
fixtures/test-integrity/TI17/warn-wildcard-unittest-mock-any.diff
fixtures/test-integrity/TI17/warn-wildcard-assertequal.diff
fixtures/test-integrity/TI17/pass-wildcard-called-with.diff
fixtures/test-integrity/TI17/pass-wildcard-nested.diff
fixtures/test-integrity/TI17/pass-wildcard-new-test.diff
fixtures/test-integrity/TI17/pass-wildcard-reindented.diff
fixtures/test-integrity/TI17/pass-wildcard-python-called-with.diff
fixtures/test-integrity/TI17/pass-wildcard-python-called-once-with.diff
fixtures/test-integrity/TI17/pass-wildcard-python-nested.diff
fixtures/test-integrity/TI17/pass-wildcard-python-new-test.diff
fixtures/test-integrity/TI17/pass-wildcard-python-reindented.diff
fixtures/test-integrity/TI17/pass-wildcard-go-test.diff
fixtures/policy/invalid/unknown-ti.json
fixtures/policy/invalid/unknown-ti.paths
packages/action/test/ac-accept-signoff-regression.test.ts
packages/core/test/ac-ti09y-regression.test.ts
packages/action/test/ac-pyparity2-unchanged.test.ts
packages/core/test/ac-fix-hints-pins.test.ts
packages/core/test/ac-skylos-nine-table.test.ts
packages/core/test/ac-skylos-nine-misses.test.ts
packages/core/test/ac-ti0205-skylos.test.ts
packages/core/test/ac-ti06-ti12-skylos.test.ts
packages/core/test/ac-ti07-skylos.test.ts
packages/core/test/ac-ti09y-skylos.test.ts
packages/core/test/ac-v020-skylos-count.test.ts
packages/core/test/ac-v020-limits.test.ts
packages/core/test/ac-v020-readme.test.ts
packages/core/test/ac-ti06-ti12-docs.test.ts
packages/core/test/ac-signal-precision-ti06-weakening.test.ts
packages/core/test/ac-name-only-suite.test.ts
packages/core/test/ac-name-only-docs.test.ts
packages/core/test/ac-skylos-pytest-ti17.test.ts
packages/core/test/ac-skylos-pytest-limits.test.ts
packages/core/test/ac-skylos-pytest-readme-changelog.test.ts
packages/core/test/ac-skylos-pytest-notes.test.ts
packages/core/test/ac-release030-readme-signals.test.ts
packages/core/test/ac-pyparity2-limits.test.ts
packages/core/test/ac-precision-v030-readme.test.ts
packages/core/test/ac-report-v2-schema.test.ts
packages/core/test/ac-fix-hints-mapping.test.ts
packages/core/test/ac-p07-schema-hints.test.ts
packages/core/test/ac-p11-schema-hints.test.ts
packages/core/test/ac-precision-v030-schema.test.ts
packages/core/test/ac-py-index-docs.test.ts
packages/core/test/ac-secrets-repin.test.ts
packages/core/test/ac-test-sources-docs.test.ts
packages/core/test/ac-ti07-schema.test.ts
packages/core/test/ac-ti081516-docs.test.ts
packages/core/test/ac-upload-schema.test.ts
packages/core/test/docs-schema-levels.test.ts
packages/core/test/injection-schema.test.ts
packages/core/test/stale-docs.test.ts
packages/core/test/ac-polrules-docs.test.ts
packages/core/test/ac-ti06-ti12-unchanged.test.ts
packages/core/test/ac-p07-unchanged.test.ts
packages/core/test/ac-p11-unchanged.test.ts
packages/node-io/test/ac-skylos-pytest-warn.test.ts
packages/node-io/test/ac-skylos-pytest-misses.test.ts
packages/node-io/test/ac-skylos-pytest-table.test.ts
README.md
docs/LIMITS.md
docs/PRECISION.md
docs/THREAT-MODEL.md
CHANGELOG.md
packages/action/dist/index.js
packages/core/test/ac-ti17-benchmark-vitest.test.ts
packages/node-io/test/ac-ti17-benchmark-pytest-any.test.ts
packages/node-io/test/ac-ti17-benchmark-pytest-helper.test.ts
packages/core/test/ac-ti17-matcher-method.test.ts
packages/core/test/ac-ti17-matcher-pass.test.ts
packages/core/test/ac-ti17-helper-warn.test.ts
packages/core/test/ac-ti17-helper-pass.test.ts
packages/core/test/ac-ti17-wildcard-js-warn.test.ts
packages/core/test/ac-ti17-wildcard-js-pass.test.ts
packages/core/test/ac-ti17-wildcard-py-warn.test.ts
packages/core/test/ac-ti17-wildcard-py-pass.test.ts
packages/core/test/ac-ti17-not-test-files.test.ts
packages/core/test/ac-ti17-one-per-file.test.ts
packages/core/test/ac-ti17-modes.test.ts
packages/core/test/ac-ti17-policy-severity.test.ts
packages/core/test/ac-ti17-policy-key.test.ts
packages/core/test/ac-ti17-schemas.test.ts
packages/core/test/ac-ti17-fix-hints.test.ts
packages/core/test/ac-ti17-render.test.ts
packages/core/test/ac-ti17-growth.test.ts
packages/node-io/test/ac-ti17-skylos-count.test.ts
packages/core/test/ac-ti17-limits-readme.test.ts
packages/core/test/ac-ti17-changelog-threat.test.ts
packages/core/test/ac-ti17-fixtures.test.ts
packages/core/test/ac-ti17-signoff-pins.test.ts
```

escape-exempt (6) — this feature's own pipeline artifacts or a hook-protected trusted doc, never a build escape:

```text
pharn/features/ti17-always-true-matcher-2/AC-TESTS.lock.json
pharn/features/ti17-always-true-matcher-2/AC-TESTS.md
pharn/features/ti17-always-true-matcher-2/BUILD.md
pharn/features/ti17-always-true-matcher-2/GRILL.md
pharn/features/ti17-always-true-matcher-2/PLAN.md
pharn/features/ti17-always-true-matcher-2/SPEC.md
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
