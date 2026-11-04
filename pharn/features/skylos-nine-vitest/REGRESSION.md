# REGRESSION — skylos-nine-vitest

base: `feb9cae77215c8a1cf34415addd972d9017427d8` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: taken from this run's ENTRY gates — the run marker, the entry offer, the pre-run snapshot, the entry stamp (sha256 `f5ffbc146ff6da36b5541b89d4e7ee5682e7fb4b9fa51391e732bb2695012996`) and its logs agree with this invocation's BASE slots at `feb9cae77215c8a1cf34415addd972d9017427d8`, so this invocation created no base worktree, ran no install and spawned no base gate (retained evidence not reused: `other-run`). The base stamp marks every slot `reused` from the entry run (`test`, `build`). That they equal what a fresh BASE worktree would give is NOT claimed: the entry gates ran in this tree's real start environment.

install: none run by this invocation (the BASE evidence came from this run's entry gates).

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (24):

```text
fixtures/skylos-nine/added-skip/change.diff
fixtures/skylos-nine/added-skip/files.txt
fixtures/skylos-nine/always-true-matcher/change.diff
fixtures/skylos-nine/always-true-matcher/files.txt
fixtures/skylos-nine/deleted-test/change.diff
fixtures/skylos-nine/deleted-test/files.txt
fixtures/skylos-nine/deselect-setting/change.diff
fixtures/skylos-nine/deselect-setting/files.txt
fixtures/skylos-nine/edited-expected-value/change.diff
fixtures/skylos-nine/edited-expected-value/files.txt
fixtures/skylos-nine/emptied-assertion/change.diff
fixtures/skylos-nine/emptied-assertion/files.txt
fixtures/skylos-nine/hard-coded-answer/change.diff
fixtures/skylos-nine/hard-coded-answer/files.txt
fixtures/skylos-nine/loosened-assertion/change.diff
fixtures/skylos-nine/loosened-assertion/files.txt
fixtures/skylos-nine/replaced-test/change.diff
fixtures/skylos-nine/replaced-test/files.txt
packages/core/test/ac-skylos-nine-added-skip.test.ts
packages/core/test/ac-skylos-nine-deleted-test.test.ts
packages/core/test/ac-skylos-nine-diffs.test.ts
packages/core/test/ac-skylos-nine-fixtures.test.ts
packages/core/test/ac-skylos-nine-misses.test.ts
packages/core/test/ac-skylos-nine-table.test.ts
```

declared (24):

```text
fixtures/skylos-nine/deleted-test/change.diff
fixtures/skylos-nine/deleted-test/files.txt
fixtures/skylos-nine/added-skip/change.diff
fixtures/skylos-nine/added-skip/files.txt
fixtures/skylos-nine/emptied-assertion/change.diff
fixtures/skylos-nine/emptied-assertion/files.txt
fixtures/skylos-nine/deselect-setting/change.diff
fixtures/skylos-nine/deselect-setting/files.txt
fixtures/skylos-nine/hard-coded-answer/change.diff
fixtures/skylos-nine/hard-coded-answer/files.txt
fixtures/skylos-nine/always-true-matcher/change.diff
fixtures/skylos-nine/always-true-matcher/files.txt
fixtures/skylos-nine/replaced-test/change.diff
fixtures/skylos-nine/replaced-test/files.txt
fixtures/skylos-nine/loosened-assertion/change.diff
fixtures/skylos-nine/loosened-assertion/files.txt
fixtures/skylos-nine/edited-expected-value/change.diff
fixtures/skylos-nine/edited-expected-value/files.txt
packages/core/test/ac-skylos-nine-deleted-test.test.ts
packages/core/test/ac-skylos-nine-added-skip.test.ts
packages/core/test/ac-skylos-nine-misses.test.ts
packages/core/test/ac-skylos-nine-table.test.ts
packages/core/test/ac-skylos-nine-fixtures.test.ts
packages/core/test/ac-skylos-nine-diffs.test.ts
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
