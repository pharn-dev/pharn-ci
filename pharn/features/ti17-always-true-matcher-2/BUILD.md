# BUILD — ti17-always-true-matcher-2

Advisory record of `/pharn-build` (iteration 1 under `/pharn-loop`). It is a record, not a verdict.

- **Plan built:** `pharn/features/ti17-always-true-matcher-2/PLAN.md` (carried `spec_content_hash`
  `a097ee5856fed13f08a42431b7792538fc45e2d963ea81ce321ceb5fd1867320`), at base commit `12036e8c485a656eeb9a4a9beb869e51e37b7d80`.
- **Chain gate:** GREEN, by `check-plan-spec-agree.mjs` (exit 0), run at Step 0 setup time and again after the build.
- **Test-stage gate (verbatim token):** `READY test-first` — the mapping holds and the lock records a red run over the pinned tests.
- **Writes-scope set (fix #7):** 102 paths from the plan's `## Files` via `set-writes-scope.cjs --from-plan`; the
  reconciliation baseline was anchored after it (3958 paths). Re-scoped to `BUILD.md` only for this record.
- **Gate result:** passed. `build-gate.mjs --mode full` exited 0 (test 0, lint 0, build 0). The targeted run exited 0
  (70 declared test files). Earlier targeted and full rounds were red only with vitest 5000 ms timeouts and one 541 s
  whole-run timeout while the host load average was 80 to 108 from other processes; no assertion failed, and the same
  tests passed alone and at low load. Nothing was changed to get past them.
- **skills:** `mode=none` (catalogue exit 0, `installed-skills/1`, no installed skills). No seam was touched, so Step 2c
  was a no-op.

## Files written

New source: `packages/core/src/signals/ti17.ts`, `alwaysTrue.ts`, `wildcardExpected.ts`; test helper
`packages/core/test/ti17-schema.ts`; 35 fixtures under `fixtures/test-integrity/TI17/`.

Edited source: `packages/core/src/check.ts`, `report.ts`, `index.ts`, `fix/table.ts`, `render/markdown.ts`,
`policy/types.ts`, `policy/limits.ts`, `signals/signalFiles.ts`; `schema/report.v2.json`, `schema/policy.v1.json`;
`fixtures/policy/invalid/unknown-ti.json` and `.paths` (TI17 to TI18); rebuilt `packages/action/dist/index.js`.

Edited docs: `README.md`, `docs/LIMITS.md`, `docs/PRECISION.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`.

Re-pinned existing tests (each with a comment naming `ti17-always-true-matcher-2`, none weakened, skipped or deleted):

- The fixture walker `packages/action/test/ac-accept-signoff-regression.test.ts` (`ADDED_AFTER_BASE` gains the 35 TI17
  fixtures; `BEFORE_COUNT` 216 and `BEFORE_DIGEST` unchanged) and its two sha256 pins in
  `packages/core/test/ac-ti09y-regression.test.ts` and `packages/action/test/ac-pyparity2-unchanged.test.ts`.
- Skylos count and table tests (8 of 9): `ac-skylos-nine-table`, `ac-skylos-nine-misses`, `ac-ti0205-skylos`,
  `ac-ti06-ti12-skylos`, `ac-ti07-skylos`, `ac-ti09y-skylos`, `ac-v020-skylos-count`, `ac-v020-limits`,
  `ac-v020-readme`, `ac-ti06-ti12-docs`, `ac-signal-precision-ti06-weakening`, `ac-name-only-suite` (core) and
  `ac-skylos-pytest-warn`, `ac-skylos-pytest-misses`, `ac-skylos-pytest-table` (node-io), plus
  `ac-skylos-pytest-limits`, `ac-skylos-pytest-notes`, `ac-skylos-pytest-readme-changelog`, `ac-skylos-pytest-ti17`.
  The `ac-pyparity2-unchanged` digest of `ac-skylos-nine-table` was recomputed from the final file.
- Schema byte-compare pins now read the schema through `withoutTi17SchemaEdits` first: `ac-fix-hints-pins`,
  `ac-p07-schema-hints`, `ac-p11-schema-hints`, `ac-precision-v030-schema`, `ac-py-index-docs`, `ac-secrets-repin`,
  `ac-test-sources-docs`, `ac-ti07-schema`, `ac-ti081516-docs`, `ac-upload-schema`, `docs-schema-levels`,
  `ac-polrules-docs`, and `ac-pyparity2-unchanged`.
- Others: `ac-report-v2-schema` (rejected id TI18), `ac-fix-hints-mapping`, `ac-release030-readme-signals`,
  `ac-pyparity2-limits`, `ac-precision-v030-readme`, `ac-ti06-ti12-unchanged`, and the fixture allowances of
  `ac-p07-unchanged`, `ac-p11-unchanged` and `ac-pyparity2-unchanged` (the TI17 directory, and the two `unknown-ti`
  fixtures accepted only as modified and only when TI18 back to TI17 gives the base bytes).
- Not edited: `ac-name-only-docs`, `injection-schema`, `stale-docs` (listed "only if it fails"; they pass).

Reference only: `stash@{0}` (the first run) was read as data; nothing was popped and every file was written through
the write tools inside the plan's scope.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is `/pharn-regress` / `/pharn-verify` + the human.
