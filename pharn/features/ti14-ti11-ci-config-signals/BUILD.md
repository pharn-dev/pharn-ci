# BUILD — ti14-ti11-ci-config-signals

Plan built: `pharn/features/ti14-ti11-ci-config-signals/PLAN.md` (iteration 1).

- Chain gate: GREEN (`check-plan-spec-agree.mjs`).
- Test-stage gate: `READY test-first — the mapping holds and the lock records a red run over the pinned tests`.
- Skills: `mode=none (no-skills)`; seam-config GREEN, no seam touched.
- Scope set (fix #7): the 53 paths of PLAN.md `## Files`.
- Gate result: `build-gate.mjs --mode full` GREEN (exit 0): test, lint, build. The targeted run was green after one fix.

## Files written

- `packages/core/src/gateInputs.ts` (`configRepoPath`), `signals/signalFiles.ts`, `signals/yamlLines.ts`, `signals/ti14.ts`,
  `signals/ti11.ts` (new), `check.ts`, `chunkInputs.ts`, `report.ts`, `render/markdown.ts`, `index.ts`
- `packages/cli/src/main.ts`, `packages/action/src/run.ts` (pass the config path and repo root to `readDiffChunks`)
- `schema/report.v2.json` (message-code description), CHANGELOG, README, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`
- 13 fixtures under `fixtures/test-integrity/TI14/` and 20 under `fixtures/test-integrity/TI11/`
- `packages/core/test/ac-stream-check.test.ts` (existing test, edited): its `parsedDiff` helper now parses with
  `keepSignalFileText()`, the way the CLI and the Action read a diff. Without it the text and the parsed form of the
  config-lowering fixture differ (the parsed form keeps no line text, so it carries no TI14 signal). No assertion was
  changed, removed or weakened.
- `packages/cli/test/ac-config-changed.test.ts` was listed as possibly touched and was not changed; its assertions hold.
- `packages/action/dist/index.js` rebuilt by `pnpm build`.

## Departures from the written rules (recorded)

- `packages/core/src/check.ts` and `packages/core/src/chunkInputs.ts` were edited by a short Python script run through
  Bash (a small mechanical replace), not by the write tools. Both paths are in the plan's `## Files`. All other source
  files were written with the write tools. Biome `format --write` was run on the named source files one by one.
- During the test stage, `packages/cli/test/ac-ti1411-render.test.ts` was adjusted once through a Python replace to use the
  shared `expectValidReport` helper; the test was re-formatted and then locked, so the lock covers the final bytes.

## Design notes

- `ti11.ts` excludes the key `on` from the matrix rule (an `on: [push, pull_request]` list is not a matrix).
- A diff handed to `check()` as `parsed` without kept line text yields no TI14 or TI11 signal; documented in LIMITS.

Built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is
`/pharn-regress` / `/pharn-verify` + the human.
