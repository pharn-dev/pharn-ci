# REGRESSION — release-readiness-v020

base: `b2c3a56373046ee6b64f913581a645f98240310c` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: taken from this run's ENTRY gates — the run marker, the entry offer, the pre-run snapshot, the entry stamp (sha256 `a9dd661cbd2c7bb47bdc7624c0ba2c3e6e5b5b3e57ec6799877466f2fa081407`) and its logs agree with this invocation's BASE slots at `b2c3a56373046ee6b64f913581a645f98240310c`, so this invocation created no base worktree, ran no install and spawned no base gate (retained evidence not reused: `no-record`). The base stamp marks every slot `reused` from the entry run (`test`, `build`). That they equal what a fresh BASE worktree would give is NOT claimed: the entry gates ran in this tree's real start environment.

install: none run by this invocation (the BASE evidence came from this run's entry gates).

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (20):

```text
CHANGELOG.md
README.md
docs/LIMITS.md
docs/RELEASING.md
fixtures/smoke/base/src/math.js
fixtures/smoke/coverage.lcov
fixtures/smoke/expected-summary.txt
fixtures/smoke/head/src/math.js
fixtures/smoke/head/src/math.test.js
packages/core/test/ac-v020-changelog.test.ts
packages/core/test/ac-v020-limits.test.ts
packages/core/test/ac-v020-readme.test.ts
packages/core/test/ac-v020-releasing.test.ts
packages/core/test/ac-v020-skylos-count.test.ts
packages/core/test/ac-v020-smoke-broken.test.ts
packages/core/test/ac-v020-smoke-env.test.ts
packages/core/test/ac-v020-smoke-fixture.test.ts
packages/core/test/ac-v020-smoke-imports.test.ts
packages/core/test/ac-v020-smoke-run.test.ts
scripts/smoke-release.mjs
```

declared (20):

```text
docs/LIMITS.md
README.md
CHANGELOG.md
docs/RELEASING.md
scripts/smoke-release.mjs
fixtures/smoke/base/src/math.js
fixtures/smoke/head/src/math.js
fixtures/smoke/head/src/math.test.js
fixtures/smoke/coverage.lcov
fixtures/smoke/expected-summary.txt
packages/core/test/ac-v020-limits.test.ts
packages/core/test/ac-v020-skylos-count.test.ts
packages/core/test/ac-v020-readme.test.ts
packages/core/test/ac-v020-changelog.test.ts
packages/core/test/ac-v020-releasing.test.ts
packages/core/test/ac-v020-smoke-fixture.test.ts
packages/core/test/ac-v020-smoke-run.test.ts
packages/core/test/ac-v020-smoke-broken.test.ts
packages/core/test/ac-v020-smoke-env.test.ts
packages/core/test/ac-v020-smoke-imports.test.ts
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
