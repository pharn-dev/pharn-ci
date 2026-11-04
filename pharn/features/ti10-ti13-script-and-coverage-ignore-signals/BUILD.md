# BUILD — ti10-ti13-script-and-coverage-ignore-signals

- plan built: `pharn/features/ti10-ti13-script-and-coverage-ignore-signals/PLAN.md`
- chain gate: GREEN (`check-plan-spec-agree.mjs`, exit 0)
- test-stage gate: `READY test-first` (`check-test-stage.mjs`, exit 0)
- skills: mode=none (catalogue exit 0, no installed skills)
- seam-config: GREEN (`check-seam-config.mjs`, exit 0); no seam touched

## Scope set (fix #7, from the plan's `## Files`)

44 paths: the core sources (`signalFiles.ts`, `ti10.ts`, `ti13.ts`, `check.ts`, `report.ts`, `render/markdown.ts`,
`index.ts`, `chunkInputs.ts`), `schema/report.v2.json`, the existing test `ac-ti1411-selector.test.ts`, the TI10 and
TI13 fixtures, `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and
`packages/action/dist/index.js`.

## Gate

`build-gate.mjs --mode targeted`: exit 0. `build-gate.mjs --mode full`: exit 0 (test, lint, build all exit 0). One
earlier full run of `pnpm vitest run` showed `config-exclude.test.ts` AC-7 (a 1000 ms timing bound, 1086 ms) failing
under load; it passed alone and in the gate's full run. It is unrelated to this change.

## Files written

- `packages/core/src/signals/signalFiles.ts` — `isPackageJsonFile`, `coverageSourceLanguage`; the selector keeps
  `package.json` and JS/TS/Python source text
- `packages/core/src/signals/ti10.ts` (new), `packages/core/src/signals/ti13.ts` (new)
- `packages/core/src/check.ts`, `report.ts`, `render/markdown.ts`, `index.ts`, `chunkInputs.ts`
- `schema/report.v2.json` — the message-code description names the two new codes
- `fixtures/test-integrity/TI10/` — 14 diffs (7 block, 7 pass) and `pass-no-test-files.files.txt`
- `fixtures/test-integrity/TI13/` — 14 diffs (6 block, 8 pass)
- `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`
- `packages/action/dist/index.js` — rebuilt with `pnpm build`
- `packages/core/test/ac-ti1411-selector.test.ts` — existing test, changed (see below)

## Existing test changed (AC-11 allows it)

`ac-ti1411-selector.test.ts` asserted that `src/app.ts` keeps no line text. A JS/TS source now keeps its text by design
(AC-1), so that assertion cannot hold. The plan said to drop `src/app.ts` from the final loop; the file's `kept(...)`
lists compare the files that keep text with `common`, and `src/app.ts` now belongs to them, so it was also added to
`common`. The assertion is not weakened: `src/app.ts` is now asserted to keep its added line, the loop over the files
that must keep no text still holds `.github/dependabot.yml` and `config/pharn.yml`, and every other assertion is
unchanged. No other existing test or fixture was edited; no fixture or inline diff of an earlier test needed
`testIntegrityMode` `off`.

built within the named scope from a current approved plan — this is NOT a judgment that the code is correct; that is
`/pharn-regress` / `/pharn-verify` + the human.
