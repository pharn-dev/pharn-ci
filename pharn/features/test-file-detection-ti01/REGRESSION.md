# REGRESSION — test-file-detection-ti01

base: `b145a7f3e7ad2b8b13af7b591a3186128a355cc6` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

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
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/src/check.ts
packages/core/src/chunkInputs.ts
packages/core/src/diff/unified.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
packages/core/src/testFiles.ts
packages/core/test/ac-test-files-deleted-check.test.ts
schema/report.v2.json
fixtures/test-integrity/TI01/block-code-stays.diff
fixtures/test-integrity/TI01/block-rename-away.diff
fixtures/test-integrity/TI01/block-root-tests.diff
fixtures/test-integrity/TI01/info-migration-mjs.diff
fixtures/test-integrity/TI01/info-migration-ts.diff
fixtures/test-integrity/TI01/info-package-removed.diff
fixtures/test-integrity/TI01/info-with-source.diff
fixtures/test-integrity/TI01/pass-binary.diff
fixtures/test-integrity/TI01/pass-fixture-json.diff
fixtures/test-integrity/TI01/pass-helper.diff
fixtures/test-integrity/TI01/pass-init-py.diff
packages/cli/test/ac-ti01-cli.test.ts
packages/core/src/signals/ti01.ts
packages/core/test/ac-ti01-block.test.ts
packages/core/test/ac-ti01-counted.test.ts
packages/core/test/ac-ti01-diff-caps.test.ts
packages/core/test/ac-ti01-diff-hunks.test.ts
packages/core/test/ac-ti01-docs.test.ts
packages/core/test/ac-ti01-exemptions.test.ts
packages/core/test/ac-ti01-files-deleted-compat.test.ts
packages/core/test/ac-ti01-modes.test.ts
packages/core/test/ac-ti01-not-counted.test.ts
packages/core/test/ac-ti01-render.test.ts
packages/core/test/ac-ti01-test-file-globs.test.ts
```

declared (38):

```text
packages/core/src/testFiles.ts
packages/core/src/diff/unified.ts
packages/core/src/signals/ti01.ts
packages/core/src/chunkInputs.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
schema/report.v2.json
packages/core/test/ac-test-files-deleted-check.test.ts
fixtures/test-integrity/TI01/block-code-stays.diff
fixtures/test-integrity/TI01/block-rename-away.diff
fixtures/test-integrity/TI01/block-root-tests.diff
fixtures/test-integrity/TI01/pass-helper.diff
fixtures/test-integrity/TI01/pass-init-py.diff
fixtures/test-integrity/TI01/pass-fixture-json.diff
fixtures/test-integrity/TI01/pass-binary.diff
fixtures/test-integrity/TI01/info-with-source.diff
fixtures/test-integrity/TI01/info-package-removed.diff
fixtures/test-integrity/TI01/info-migration-ts.diff
fixtures/test-integrity/TI01/info-migration-mjs.diff
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/test/ac-ti01-test-file-globs.test.ts
packages/core/test/ac-ti01-diff-hunks.test.ts
packages/core/test/ac-ti01-diff-caps.test.ts
packages/core/test/ac-ti01-block.test.ts
packages/core/test/ac-ti01-modes.test.ts
packages/core/test/ac-ti01-not-counted.test.ts
packages/core/test/ac-ti01-exemptions.test.ts
packages/core/test/ac-ti01-counted.test.ts
packages/core/test/ac-ti01-files-deleted-compat.test.ts
packages/cli/test/ac-ti01-cli.test.ts
packages/core/test/ac-ti01-render.test.ts
packages/core/test/ac-ti01-docs.test.ts
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
