---
spec_id: diff-unavailable-fails-with-threshold
spec_content_hash: "f2b7db693ba449ff7b36647aedfcb649776089af84170ce4e19ecdcec85191a2"
applied_lessons: none
---

## Approach

> ADVISORY: model work. Derived from the Approved SPEC only.

The whole behaviour change lives in one pure function, `buildReport` in `packages/core/src/report.ts`. Today its
`dc === null` branch sets `input.threshold === null ? "warn" : "error"` inline three times (for
`COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`) and hard-codes `"warn"` for
`DIFF_UNAVAILABLE`. The fix states that rule once: compute a single level for "diff coverage could not be computed"
from the threshold (`"error"` when `input.threshold` is a number, 0 included; `"warn"` when it is `null`) at the top
of the `dc === null` branch, with one comment that says why (with a threshold the user asked for a gate, and a gate
that cannot measure must fail closed), and use that level for all four messages. Message codes and texts do not
change. `verdictOf` is untouched: the verdict keeps following from the levels.

`check()` already routes an unavailable diff to `buildReport` with `missing.reason === "diff-unavailable"` and the
input threshold, so `check()` needs no change. The Action already sets the `verdict` output and calls
`setFailed("pharn-ci: " + error texts)` on a `fail` verdict when `fail-on-threshold` is true, so `run.ts` needs no
change; only its committed bundle is rebuilt. The CLI never builds a `DIFF_UNAVAILABLE` report.

Three existing tests assert the old `warn` with threshold 80 and are updated on purpose (the behaviour changes); every
other test keeps its expectations. Docs are brought in line in the same change.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON`; this project has no `memory-bank/` yet, so there is no
  lesson to apply.

## Steps

- In `packages/core/src/report.ts`, inside `buildReport`'s `dc === null` branch, introduce one local
  `const level: MessageLevel = input.threshold === null ? "warn" : "error";` (or an unexported helper of the same
  shape in the same file) with a single comment covering all four cases, and use it for `COVERAGE_FILE_MISSING`,
  `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `DIFF_UNAVAILABLE`. Drop the three per-branch "same
  severity as ..." comments that the shared comment replaces. Keep every `text` byte-identical. No new export, no
  schema change, no I/O (core purity).
- Update `packages/core/test/report.test.ts` "warns when the diff is unavailable": expect verdict `fail` and
  `messages[0]` to be `DIFF_UNAVAILABLE` at level `error`; retitle it to "fails when the diff is unavailable and a
  threshold is set". Keep `expectValidReport`.
- Update `packages/core/test/golden.test.ts` "warns when the diff is unavailable": expect verdict `fail`; retitle it to
  "fails when the diff is unavailable and a threshold is set". Keep `expectValidReport`. Golden fixture files are not
  regenerated (no golden report carries `DIFF_UNAVAILABLE`).
- Update `packages/action/test/run.test.ts` "refuses to measure a pull_request_target run that checked out the base
  branch": expect verdict `fail` (it runs with threshold 80 and `fail-on-threshold` true) and keep the other
  assertions. Keep its title, so `docs/THREAT-MODEL.md`'s citation of it stays valid.
- Rebuild: `pnpm build` (or `pnpm --filter @pharn-ci/action build`) and commit the regenerated
  `packages/action/dist/index.js`.
- `docs/LIMITS.md` §2: retitle from "When the gate is soft" (for example "When an input is missing"); replace the
  `DIFF_UNAVAILABLE` bullet so it says the run fails closed with a threshold (an error and verdict `fail`) and warns
  without one, keeping the list of causes (no base, shallow checkout plus API error or refusal, a diff over the size
  limit, `pull_request_target` on the base branch), and that `fetch-depth: 0` or the GitHub API fallback avoids it;
  fold the missing/empty coverage bullet into the same rule so it names all four codes
  (`COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`, `DIFF_UNAVAILABLE`); keep the
  `fail-on-threshold: false` bullet.
- `README.md`: remove the "Known limits" bullet "The gate is soft when the diff is unavailable." Keep the sentence
  "Without a threshold, pharn-ci reports and never fails the step." The `DIFF_UNAVAILABLE` codes-table row stays
  (its meaning is unchanged).
- `docs/THREAT-MODEL.md`: row D3 drops the residual "`DIFF_UNAVAILABLE` is a warning, not a failure (§3)" and says the
  run fails with a threshold, citing the new AC-3 Action test by its file and title; row E1 adds that an unavailable
  diff is `DIFF_UNAVAILABLE`, an error with a threshold, citing the AC-2 test; §3 removes residual 2 ("The gate is
  soft when the diff is unavailable") and renumbers residuals 3 to 7 as 2 to 6. Rows reference §3 only as "(§3)", not
  by number, so no other cross-reference changes; re-check with a grep at build time.
- `CHANGELOG.md`: under `## [Unreleased]` > `### Changed`, one line: `DIFF_UNAVAILABLE` is now an error, and the
  verdict `fail`, when a threshold is set (a warning without one), like a missing, empty or unrecognized coverage
  file; shallow-clone users with a threshold should use `actions/checkout` with `fetch-depth: 0` or rely on the GitHub
  API fallback.
- Run `pnpm lint` and `pnpm test`; format only the files above, named one by one.

## Files

- `packages/core/src/report.ts` — one shared level rule (error with a threshold, warn without) for `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED` and `DIFF_UNAVAILABLE`; texts unchanged
- `packages/core/test/report.test.ts` — the "warns when the diff is unavailable" test expects `error` and `fail`, retitled
- `packages/core/test/golden.test.ts` — the "warns when the diff is unavailable" test expects `fail`, retitled
- `packages/action/test/run.test.ts` — the `pull_request_target` base-branch test expects verdict `fail`; title kept
- `packages/action/dist/index.js` — regenerated with `pnpm build`
- `docs/LIMITS.md` — §2 retitled and rewritten: the four missing-input codes fail closed with a threshold, warn without; `fetch-depth: 0` or the API fallback avoids `DIFF_UNAVAILABLE`
- `README.md` — remove the "gate is soft when the diff is unavailable" limits bullet
- `docs/THREAT-MODEL.md` — D3 residual removed and the new test cited; E1 names `DIFF_UNAVAILABLE`; §3 residual 2 removed and the rest renumbered
- `CHANGELOG.md` — Unreleased > Changed line for the behaviour change, with the shallow-clone advice

### Explicitly not touched

- `packages/core/src/check.ts` — already passes the threshold and the `diff-unavailable` reason to `buildReport`
- `packages/core/src/render/markdown.ts` — renders whatever level the message carries
- `packages/action/src/run.ts` — already sets `verdict` and fails the step on a `fail` verdict (SPEC non-goal)
- `packages/action/src/index.ts` — I/O unchanged
- `packages/cli/src/main.ts` — never builds a `DIFF_UNAVAILABLE` report (SPEC non-goal)
- `schema/report.v1.json` — unchanged (SPEC constraint)
- `fixtures/golden/report.json` — no golden fixture changes (SPEC constraint)
- `fixtures/golden/report.md` — no golden fixture changes (SPEC constraint)
- `packages/core/test/markdown.test.ts` — uses `coverage-file-missing`, whose level is unchanged
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — unchanged
- `action.yml` — no new input; descriptions unchanged
- `LIMITS.md` — PHARN's root-level document, not a product doc
- `THREAT-MODEL.md` — PHARN's root-level document, not a product doc
- `vitest.config.ts` — test infrastructure
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 (unit, `buildReport`): the shared level rule makes `DIFF_UNAVAILABLE` `error` for threshold 80 and 0 (both
  are numbers, not `null`) and `warn` for `null`; `verdictOf` turns those into `fail` and `warn`. The three coverage
  reasons go through the same rule, so they stay `error`/`warn`. All reports keep the schema shape (only `level`
  changes, within its enum), so `expectValidReport` passes.
- AC-2 (integration, `check()`): `check()` routes `diff: { unavailable }` to `buildReport` with the threshold, so the
  golden lcov text with an unavailable diff yields `fail` at 80 and `warn` with `null`, carrying `DIFF_UNAVAILABLE`.
- AC-3 (integration, Action `run()`): with no local history and a refusing compare API, `getDiff` returns
  `{ unavailable: ... }`; with threshold 80 the report is `fail`, `run()` sets output `verdict` to `fail`, and
  `setFailed` receives `pharn-ci: Diff coverage was not computed: could not get the diff ...`. With no threshold the
  verdict is `warn` and `setFailed` is not called.

## Risks & open questions

- Behaviour change for users: a workflow with a threshold and a shallow checkout whose API fallback also fails, or a
  push with no previous commit, now fails the step where it used to warn. That is the point of F-02; the CHANGELOG line
  tells users how to avoid it. The verdict is still not affected without a threshold.
- `buildReport`'s fallback `input.missing ?? { reason: "diff-unavailable", ... }` (`diffCoverage: null` with no
  `missing`) now also becomes an error with a threshold. No caller in the repo hits it (`check()` always sets
  `missing`), and the shared rule is what the SPEC asks for; no test relies on the old level.
- The SPEC assumes the AC-3 test "reuses the existing harness's" no-local-history and compare-error options. That
  harness is file-local in `packages/action/test/run.test.ts` and not exported, and AC test files must be new files
  outside this plan's scope, so the AC-3 test re-creates the same two behaviours (git throws for everything but
  `ls-files`; `compareDiff` throws) with its own in-memory deps, as `packages/action/test/ac-coverage-format.test.ts`
  does.
- `docs/THREAT-MODEL.md` D3 status: with the residual gone the row could read "Enforced today", but the D3 mitigation
  itself (refusing a base-branch checkout) is unchanged; the build should keep "Partly enforced" unless the D3 row no
  longer names any residual, and say which it chose.
- The three updated tests change expected level and verdict on purpose; the reason (F-02, fail closed with a
  threshold) belongs in the run record and the commit message, per AGENTS.md rule 4.
