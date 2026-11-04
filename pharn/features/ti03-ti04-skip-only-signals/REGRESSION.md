# REGRESSION — ti03-ti04-skip-only-signals

base: `be11155dc701478902b77983a2fa7a5db358a806` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: taken from this run's ENTRY gates — the run marker, the entry offer, the pre-run snapshot, the entry stamp (sha256 `27dbcdf16638cce2b492d93528612d6c16b15c176aab1595b3c6ed0197972caa`) and its logs agree with this invocation's BASE slots at `be11155dc701478902b77983a2fa7a5db358a806`, so this invocation created no base worktree, ran no install and spawned no base gate (retained evidence not reused: `other-run`). The base stamp marks every slot `reused` from the entry run (`test`, `build`). That they equal what a fresh BASE worktree would give is NOT claimed: the entry gates ran in this tree's real start environment.

install: none run by this invocation (the BASE evidence came from this run's entry gates).

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (63):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/src/check.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
schema/report.v2.json
fixtures/test-integrity/TI03/block-it-skip-existing.diff
fixtures/test-integrity/TI03/block-pytest-decorator.diff
fixtures/test-integrity/TI03/block-skipif-true.diff
fixtures/test-integrity/TI03/block-todo-existing.diff
fixtures/test-integrity/TI03/block-xdescribe-existing.diff
fixtures/test-integrity/TI03/pass-comment.diff
fixtures/test-integrity/TI03/pass-fails-async-edit.diff
fixtures/test-integrity/TI03/pass-fixme.diff
fixtures/test-integrity/TI03/pass-non-test-file.diff
fixtures/test-integrity/TI03/pass-skip-moved.diff
fixtures/test-integrity/TI03/pass-skipif-false.diff
fixtures/test-integrity/TI03/pass-xit-respelled.diff
fixtures/test-integrity/TI03/warn-conditional-mobile.diff
fixtures/test-integrity/TI03/warn-go-skip-root.diff
fixtures/test-integrity/TI03/warn-pytest-skip-fixture.diff
fixtures/test-integrity/TI03/warn-pytest-skip-redis.diff
fixtures/test-integrity/TI03/warn-skip-new-file.diff
fixtures/test-integrity/TI03/warn-skipif-camera.diff
fixtures/test-integrity/TI03/warn-skipif-docker.diff
fixtures/test-integrity/TI03/warn-skipif-openssl.diff
fixtures/test-integrity/TI03/warn-skipunless-windows.diff
fixtures/test-integrity/TI03/warn-xfail-new-test.diff
fixtures/test-integrity/TI04/block-describe-only.diff
fixtures/test-integrity/TI04/block-fdescribe.diff
fixtures/test-integrity/TI04/block-fit.diff
fixtures/test-integrity/TI04/block-it-only.diff
fixtures/test-integrity/TI04/block-only-renamed.diff
fixtures/test-integrity/TI04/block-test-describe-only.diff
fixtures/test-integrity/TI04/pass-comment.diff
fixtures/test-integrity/TI04/pass-go-fit.diff
fixtures/test-integrity/TI04/pass-json-fixture.diff
fixtures/test-integrity/TI04/pass-non-test-file.diff
fixtures/test-integrity/TI04/pass-only-async-edit.diff
fixtures/test-integrity/TI04/pass-only-moved.diff
fixtures/test-integrity/TI04/pass-python-def-fit.diff
fixtures/test-integrity/TI04/pass-solver-fit.diff
packages/cli/test/ac-ti0304-render.test.ts
packages/core/src/signals/testLines.ts
packages/core/src/signals/ti03.ts
packages/core/src/signals/ti04.ts
packages/core/test/ac-ti03-added-test.test.ts
packages/core/test/ac-ti03-conditional.test.ts
packages/core/test/ac-ti03-in-body.test.ts
packages/core/test/ac-ti03-js-existing.test.ts
packages/core/test/ac-ti03-no-signal.test.ts
packages/core/test/ac-ti03-python-existing.test.ts
packages/core/test/ac-ti0304-details.test.ts
packages/core/test/ac-ti0304-docs.test.ts
packages/core/test/ac-ti0304-modes.test.ts
packages/core/test/ac-ti0304-regression.test.ts
packages/core/test/ac-ti04-narrowed.test.ts
packages/core/test/ac-ti04-not-a-test-call.test.ts
packages/core/test/ac-ti04-pre-existing.test.ts
```

declared (63):

```text
packages/core/src/signals/testLines.ts
packages/core/src/signals/ti03.ts
packages/core/src/signals/ti04.ts
packages/core/src/check.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/index.ts
schema/report.v2.json
fixtures/test-integrity/TI03/block-it-skip-existing.diff
fixtures/test-integrity/TI03/block-xdescribe-existing.diff
fixtures/test-integrity/TI03/block-todo-existing.diff
fixtures/test-integrity/TI03/block-skipif-true.diff
fixtures/test-integrity/TI03/block-pytest-decorator.diff
fixtures/test-integrity/TI03/warn-conditional-mobile.diff
fixtures/test-integrity/TI03/warn-skipif-camera.diff
fixtures/test-integrity/TI03/warn-skipif-docker.diff
fixtures/test-integrity/TI03/warn-skipif-openssl.diff
fixtures/test-integrity/TI03/warn-skipunless-windows.diff
fixtures/test-integrity/TI03/warn-pytest-skip-redis.diff
fixtures/test-integrity/TI03/warn-pytest-skip-fixture.diff
fixtures/test-integrity/TI03/warn-go-skip-root.diff
fixtures/test-integrity/TI03/warn-xfail-new-test.diff
fixtures/test-integrity/TI03/warn-skip-new-file.diff
fixtures/test-integrity/TI03/pass-fails-async-edit.diff
fixtures/test-integrity/TI03/pass-skip-moved.diff
fixtures/test-integrity/TI03/pass-xit-respelled.diff
fixtures/test-integrity/TI03/pass-skipif-false.diff
fixtures/test-integrity/TI03/pass-fixme.diff
fixtures/test-integrity/TI03/pass-comment.diff
fixtures/test-integrity/TI03/pass-non-test-file.diff
fixtures/test-integrity/TI04/block-it-only.diff
fixtures/test-integrity/TI04/block-describe-only.diff
fixtures/test-integrity/TI04/block-test-describe-only.diff
fixtures/test-integrity/TI04/block-fit.diff
fixtures/test-integrity/TI04/block-fdescribe.diff
fixtures/test-integrity/TI04/block-only-renamed.diff
fixtures/test-integrity/TI04/pass-solver-fit.diff
fixtures/test-integrity/TI04/pass-python-def-fit.diff
fixtures/test-integrity/TI04/pass-go-fit.diff
fixtures/test-integrity/TI04/pass-only-async-edit.diff
fixtures/test-integrity/TI04/pass-only-moved.diff
fixtures/test-integrity/TI04/pass-comment.diff
fixtures/test-integrity/TI04/pass-non-test-file.diff
fixtures/test-integrity/TI04/pass-json-fixture.diff
CHANGELOG.md
README.md
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/core/test/ac-ti04-narrowed.test.ts
packages/core/test/ac-ti04-not-a-test-call.test.ts
packages/core/test/ac-ti04-pre-existing.test.ts
packages/core/test/ac-ti03-js-existing.test.ts
packages/core/test/ac-ti03-python-existing.test.ts
packages/core/test/ac-ti03-conditional.test.ts
packages/core/test/ac-ti03-in-body.test.ts
packages/core/test/ac-ti03-added-test.test.ts
packages/core/test/ac-ti03-no-signal.test.ts
packages/core/test/ac-ti0304-details.test.ts
packages/core/test/ac-ti0304-modes.test.ts
packages/cli/test/ac-ti0304-render.test.ts
packages/core/test/ac-ti0304-regression.test.ts
packages/core/test/ac-ti0304-docs.test.ts
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
