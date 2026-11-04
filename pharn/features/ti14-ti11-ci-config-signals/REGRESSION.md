# REGRESSION — ti14-ti11-ci-config-signals

base: `54804ba8c6e67f6bb757a97a04c1691431cd2c90` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (67):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/action/src/run.ts
packages/cli/src/main.ts
packages/core/src/check.ts
packages/core/src/chunkInputs.ts
packages/core/src/gateInputs.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/test/ac-stream-check.test.ts
schema/report.v2.json
fixtures/test-integrity/TI11/block-test-step-removed.diff
fixtures/test-integrity/TI11/block-trigger-flow.diff
fixtures/test-integrity/TI11/block-trigger-removed.diff
fixtures/test-integrity/TI11/block-workflow-deleted.diff
fixtures/test-integrity/TI11/pass-action-bump.diff
fixtures/test-integrity/TI11/pass-comment-removed.diff
fixtures/test-integrity/TI11/pass-continue-expression.diff
fixtures/test-integrity/TI11/pass-if-always.diff
fixtures/test-integrity/TI11/pass-matrix-grown.diff
fixtures/test-integrity/TI11/pass-non-workflow.diff
fixtures/test-integrity/TI11/pass-pure-rename.diff
fixtures/test-integrity/TI11/pass-step-moved.diff
fixtures/test-integrity/TI11/pass-step-reflowed.diff
fixtures/test-integrity/TI11/pass-timeout-fifteen.diff
fixtures/test-integrity/TI11/pass-trigger-kept.diff
fixtures/test-integrity/TI11/warn-continue-on-error.diff
fixtures/test-integrity/TI11/warn-if-event.diff
fixtures/test-integrity/TI11/warn-if-false.diff
fixtures/test-integrity/TI11/warn-matrix-reduced.diff
fixtures/test-integrity/TI11/warn-timeout-one.diff
fixtures/test-integrity/TI14/block-config-deleted.diff
fixtures/test-integrity/TI14/block-exclude-appended.diff
fixtures/test-integrity/TI14/block-exclude-block.diff
fixtures/test-integrity/TI14/block-exclude-flow.diff
fixtures/test-integrity/TI14/block-threshold-lowered.diff
fixtures/test-integrity/TI14/block-threshold-removed.diff
fixtures/test-integrity/TI14/pass-exclude-moved.diff
fixtures/test-integrity/TI14/pass-exclude-removed.diff
fixtures/test-integrity/TI14/pass-file-item-added.diff
fixtures/test-integrity/TI14/pass-threshold-added.diff
fixtures/test-integrity/TI14/pass-threshold-moved.diff
fixtures/test-integrity/TI14/pass-threshold-raised.diff
fixtures/test-integrity/TI14/pass-unrelated-setup.diff
packages/cli/test/ac-ti1411-render.test.ts
packages/cli/test/ac-ti1411-stream.test.ts
packages/core/src/signals/signalFiles.ts
packages/core/src/signals/ti11.ts
packages/core/src/signals/ti14.ts
packages/core/src/signals/yamlLines.ts
packages/core/test/ac-ti11-continue-on-error.test.ts
packages/core/test/ac-ti11-if-condition.test.ts
packages/core/test/ac-ti11-matrix.test.ts
packages/core/test/ac-ti11-test-step.test.ts
packages/core/test/ac-ti11-timeout.test.ts
packages/core/test/ac-ti11-trigger.test.ts
packages/core/test/ac-ti14-config-path.test.ts
packages/core/test/ac-ti14-exclusion.test.ts
packages/core/test/ac-ti14-threshold.test.ts
packages/core/test/ac-ti1411-docs.test.ts
packages/core/test/ac-ti1411-modes.test.ts
packages/core/test/ac-ti1411-regression.test.ts
packages/core/test/ac-ti1411-selector.test.ts
```

declared (68):

```text
packages/core/src/gateInputs.ts
packages/core/src/signals/signalFiles.ts
packages/core/src/signals/yamlLines.ts
packages/core/src/signals/ti14.ts
packages/core/src/signals/ti11.ts
packages/core/src/check.ts
packages/core/src/chunkInputs.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
packages/cli/src/main.ts
packages/action/src/run.ts
schema/report.v2.json
packages/core/test/ac-stream-check.test.ts
packages/cli/test/ac-config-changed.test.ts
fixtures/test-integrity/TI14/block-threshold-lowered.diff
fixtures/test-integrity/TI14/block-threshold-removed.diff
fixtures/test-integrity/TI14/block-config-deleted.diff
fixtures/test-integrity/TI14/block-exclude-flow.diff
fixtures/test-integrity/TI14/block-exclude-block.diff
fixtures/test-integrity/TI14/block-exclude-appended.diff
fixtures/test-integrity/TI14/pass-threshold-raised.diff
fixtures/test-integrity/TI14/pass-threshold-moved.diff
fixtures/test-integrity/TI14/pass-threshold-added.diff
fixtures/test-integrity/TI14/pass-exclude-removed.diff
fixtures/test-integrity/TI14/pass-exclude-moved.diff
fixtures/test-integrity/TI14/pass-unrelated-setup.diff
fixtures/test-integrity/TI14/pass-file-item-added.diff
fixtures/test-integrity/TI11/block-test-step-removed.diff
fixtures/test-integrity/TI11/block-workflow-deleted.diff
fixtures/test-integrity/TI11/block-trigger-removed.diff
fixtures/test-integrity/TI11/block-trigger-flow.diff
fixtures/test-integrity/TI11/warn-matrix-reduced.diff
fixtures/test-integrity/TI11/warn-continue-on-error.diff
fixtures/test-integrity/TI11/warn-if-false.diff
fixtures/test-integrity/TI11/warn-if-event.diff
fixtures/test-integrity/TI11/warn-timeout-one.diff
fixtures/test-integrity/TI11/pass-step-moved.diff
fixtures/test-integrity/TI11/pass-step-reflowed.diff
fixtures/test-integrity/TI11/pass-comment-removed.diff
fixtures/test-integrity/TI11/pass-trigger-kept.diff
fixtures/test-integrity/TI11/pass-matrix-grown.diff
fixtures/test-integrity/TI11/pass-continue-expression.diff
fixtures/test-integrity/TI11/pass-if-always.diff
fixtures/test-integrity/TI11/pass-timeout-fifteen.diff
fixtures/test-integrity/TI11/pass-action-bump.diff
fixtures/test-integrity/TI11/pass-pure-rename.diff
fixtures/test-integrity/TI11/pass-non-workflow.diff
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/test/ac-ti1411-selector.test.ts
packages/cli/test/ac-ti1411-stream.test.ts
packages/core/test/ac-ti14-threshold.test.ts
packages/core/test/ac-ti14-exclusion.test.ts
packages/core/test/ac-ti14-config-path.test.ts
packages/core/test/ac-ti11-test-step.test.ts
packages/core/test/ac-ti11-trigger.test.ts
packages/core/test/ac-ti11-matrix.test.ts
packages/core/test/ac-ti11-continue-on-error.test.ts
packages/core/test/ac-ti11-if-condition.test.ts
packages/core/test/ac-ti11-timeout.test.ts
packages/core/test/ac-ti1411-modes.test.ts
packages/cli/test/ac-ti1411-render.test.ts
packages/core/test/ac-ti1411-regression.test.ts
packages/core/test/ac-ti1411-docs.test.ts
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
