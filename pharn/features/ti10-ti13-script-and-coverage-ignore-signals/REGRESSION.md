# REGRESSION — ti10-ti13-script-and-coverage-ignore-signals

base: `73ed546bc52c926fdf86c6d3ce12f5de86e4d82c` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `no-record`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (56):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/src/check.ts
packages/core/src/chunkInputs.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/src/signals/signalFiles.ts
packages/core/test/ac-ti1411-selector.test.ts
schema/report.v2.json
fixtures/test-integrity/TI10/block-echo-in-place.diff
fixtures/test-integrity/TI10/block-name-filter.diff
fixtures/test-integrity/TI10/block-nested-exit-zero.diff
fixtures/test-integrity/TI10/block-or-true.diff
fixtures/test-integrity/TI10/block-pass-with-no-tests.diff
fixtures/test-integrity/TI10/block-path-filter.diff
fixtures/test-integrity/TI10/block-pretest-removed.diff
fixtures/test-integrity/TI10/pass-and-echo.diff
fixtures/test-integrity/TI10/pass-build-echo.diff
fixtures/test-integrity/TI10/pass-new-package.diff
fixtures/test-integrity/TI10/pass-no-test-files.diff
fixtures/test-integrity/TI10/pass-no-test-files.files.txt
fixtures/test-integrity/TI10/pass-pre-existing-or-true.diff
fixtures/test-integrity/TI10/pass-stricter.diff
fixtures/test-integrity/TI10/pass-unrelated-script.diff
fixtures/test-integrity/TI13/block-c8-line.diff
fixtures/test-integrity/TI13/block-istanbul-inline.diff
fixtures/test-integrity/TI13/block-istanbul-next.diff
fixtures/test-integrity/TI13/block-new-file.diff
fixtures/test-integrity/TI13/block-pragma-no-cover.diff
fixtures/test-integrity/TI13/block-v8-next.diff
fixtures/test-integrity/TI13/pass-markdown.diff
fixtures/test-integrity/TI13/pass-moved.diff
fixtures/test-integrity/TI13/pass-pragma-no-branch.diff
fixtures/test-integrity/TI13/pass-py-istanbul.diff
fixtures/test-integrity/TI13/pass-removed.diff
fixtures/test-integrity/TI13/pass-string.diff
fixtures/test-integrity/TI13/pass-test-file.diff
fixtures/test-integrity/TI13/pass-v8-ignored-word.diff
packages/cli/test/ac-ti1013-render.test.ts
packages/core/src/signals/ti10.ts
packages/core/src/signals/ti13.ts
packages/core/test/ac-ti10-details.test.ts
packages/core/test/ac-ti10-no-signal.test.ts
packages/core/test/ac-ti10-no-tests-exemption.test.ts
packages/core/test/ac-ti10-weakened.test.ts
packages/core/test/ac-ti1013-docs.test.ts
packages/core/test/ac-ti1013-modes.test.ts
packages/core/test/ac-ti1013-regression.test.ts
packages/core/test/ac-ti1013-selector.test.ts
packages/core/test/ac-ti13-added.test.ts
packages/core/test/ac-ti13-details.test.ts
packages/core/test/ac-ti13-no-signal.test.ts
```

declared (56):

```text
packages/core/src/signals/signalFiles.ts
packages/core/src/signals/ti10.ts
packages/core/src/signals/ti13.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
packages/core/src/chunkInputs.ts
schema/report.v2.json
packages/core/test/ac-ti1411-selector.test.ts
fixtures/test-integrity/TI10/block-or-true.diff
fixtures/test-integrity/TI10/block-echo-in-place.diff
fixtures/test-integrity/TI10/block-pass-with-no-tests.diff
fixtures/test-integrity/TI10/block-path-filter.diff
fixtures/test-integrity/TI10/block-name-filter.diff
fixtures/test-integrity/TI10/block-pretest-removed.diff
fixtures/test-integrity/TI10/block-nested-exit-zero.diff
fixtures/test-integrity/TI10/pass-pre-existing-or-true.diff
fixtures/test-integrity/TI10/pass-unrelated-script.diff
fixtures/test-integrity/TI10/pass-build-echo.diff
fixtures/test-integrity/TI10/pass-stricter.diff
fixtures/test-integrity/TI10/pass-and-echo.diff
fixtures/test-integrity/TI10/pass-new-package.diff
fixtures/test-integrity/TI10/pass-no-test-files.diff
fixtures/test-integrity/TI10/pass-no-test-files.files.txt
fixtures/test-integrity/TI13/block-istanbul-next.diff
fixtures/test-integrity/TI13/block-istanbul-inline.diff
fixtures/test-integrity/TI13/block-v8-next.diff
fixtures/test-integrity/TI13/block-c8-line.diff
fixtures/test-integrity/TI13/block-pragma-no-cover.diff
fixtures/test-integrity/TI13/block-new-file.diff
fixtures/test-integrity/TI13/pass-moved.diff
fixtures/test-integrity/TI13/pass-removed.diff
fixtures/test-integrity/TI13/pass-test-file.diff
fixtures/test-integrity/TI13/pass-py-istanbul.diff
fixtures/test-integrity/TI13/pass-string.diff
fixtures/test-integrity/TI13/pass-v8-ignored-word.diff
fixtures/test-integrity/TI13/pass-pragma-no-branch.diff
fixtures/test-integrity/TI13/pass-markdown.diff
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/test/ac-ti1013-selector.test.ts
packages/core/test/ac-ti10-weakened.test.ts
packages/core/test/ac-ti10-no-signal.test.ts
packages/core/test/ac-ti10-no-tests-exemption.test.ts
packages/core/test/ac-ti10-details.test.ts
packages/core/test/ac-ti13-added.test.ts
packages/core/test/ac-ti13-no-signal.test.ts
packages/core/test/ac-ti13-details.test.ts
packages/core/test/ac-ti1013-modes.test.ts
packages/cli/test/ac-ti1013-render.test.ts
packages/core/test/ac-ti1013-regression.test.ts
packages/core/test/ac-ti1013-docs.test.ts
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
