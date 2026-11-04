---
spec_id: skylos-nine-vitest
spec_content_hash: 8d82e785c11ef5ab12637d03353475aaa1151401d7fa681b2ed920d89981de94
applied_lessons: none
---

## Approach

> ADVISORY — model work. Nothing below is a guarantee; the floor checks are `check-spec-approved.mjs`,
> `check-plan-lessons.mjs` and `check-ac-tests.mjs`, and the AC tests themselves.

This feature adds **inputs only**: eighteen hand-written fixture files in nine case directories under
`fixtures/skylos-nine/`. No product code changes (`packages/*/src`, `schema/`, `action.yml`, `packages/action/dist` stay
untouched), so the build has nothing to bundle and no CHANGELOG line. The six AC test files
(`packages/core/test/ac-skylos-nine-*.test.ts`) are written by `/pharn-test` before the build and listed only in
`AC-TESTS.md`; they hold the case table, the expected catch/miss results and the signal ids, so the fixtures carry none
of that (SPEC Constraints).

Each case directory holds exactly `change.diff` and `files.txt`:

- `change.diff` — a `--unified=0` style unified diff (header lines `diff --git`, an `index` or `new/deleted file mode`
  line, `--- a/…` / `+++ b/…`, then hunks of `@@ … @@`, `-` and `+` lines only — no context lines), in the shape of
  `fixtures/test-integrity/TI01/block-code-stays.diff` and `fixtures/test-integrity/TI03/block-it-skip-existing.diff`.
  Every path a diff touches ends in `.ts` (so AC-5's extension rule holds); no `pytest`, no `.py`.
- `files.txt` — the repository's tracked files at head, one repository-relative path per line, ending with a newline.

The nine cases share one tiny imaginary vitest project so the fixtures read as one story: `src/cart.ts` (a `total`
function), its test `src/cart.test.ts` (`describe("cart", …)` with a few `it(…)` blocks using `expect(…).toBe(…)`),
`src/index.ts` and `vitest.config.ts`. The AC tests pass the existing coverage fixture
`fixtures/test-files-deleted/coverage.info` as the coverage input (SPEC Assumptions), so coverage is not part of a case.

Indicative content per case (the build may adjust wording, line numbers and names within the SPEC's ACs):

1. **`deleted-test`** (caught by TI01, block) — the diff deletes `src/__tests__/cart.test.ts` (`deleted file mode
   100644`, one `@@ -1,N +0,0 @@` hunk whose removed lines import from `vitest` and define `describe`/`it` tests). It
   deletes nothing else and adds no same-named test, and `src/cart.ts` stays, so TI01's precision rules (same-named
   source deleted, other files of the package deleted, same-named test added) leave it at `block`. `files.txt` lists
   `src/cart.ts`, `src/index.ts`, `vitest.config.ts` and not the deleted test.
2. **`added-skip`** (caught by TI03, block) — one hunk in `src/cart.test.ts` turning `  it("applies the discount", () => {`
   into `  it.skip("applies the discount", () => {` (same name, no condition), the shape of
   `fixtures/test-integrity/TI03/block-it-skip-existing.diff`. `files.txt` lists the test file and its source.
3. **`emptied-assertion`** (miss; TI05 later) — in `src/cart.test.ts`, removes a line `    expect(total([2, 3])).toBe(5);`
   and adds either nothing or a bare call `    total([2, 3]);`; no added line holds `expect(`.
4. **`deselect-setting`** (miss; TI09 later) — touches only `vitest.config.ts`: replaces
   `    include: ["src/**/*.test.ts"],` with a narrower include, or adds an `    exclude: ["src/cart.test.ts"],` line. No
   `package.json`, `.pharn/ci.yml` or workflow file, so TI10, TI14 and TI11 stay silent.
5. **`hard-coded-answer`** (miss; TI15 later) — touches only `src/cart.ts` (not a test file): adds a line such as
   `  if (prices.length === 2 && prices[0] === 2) return 5;`. No coverage-ignore comment, so TI13 stays silent.
6. **`always-true-matcher`** (miss; no planned signal) — in `src/cart.test.ts`, adds a line
   `expect.extend({ toBeTotal: () => ({ pass: true, message: () => "" }) });` and swaps an assertion to the new matcher.
7. **`replaced-test`** (miss; TI02 later) — modifies `src/cart.test.ts` (which stays in `files.txt`): removes one
   `  it("rejects a negative price", () => {` line and adds one `  it("accepts an empty cart", () => {` line with a
   different name. No `.skip`/`.only`/`.todo`, so TI03 and TI04 stay silent.
8. **`loosened-assertion`** (miss; TI06 later) — removes `    expect(total([2, 3])).toBe(5);` and adds
   `    expect(total([2, 3])).toBeTruthy();`.
9. **`edited-expected-value`** (miss; TI07 later) — removes `    expect(total([2, 3])).toBe(5);` and adds
   `    expect(total([2, 3])).toBe(6);` (same matcher, different expected literal).

If a shipped signal (TI01, TI03, TI04, TI10, TI11, TI13, TI14) fires on a miss case's diff when the AC tests run, the
build changes that case's diff until it does not; the miss assertion is never weakened (SPEC Constraints).

## Applied lessons

- none — the project has no `memory-bank/lessons-learned.md` yet (`check-lessons-index.mjs --verdict` printed
  `NO_CANON`), so there are no promoted lessons to apply.

## Steps

- Create the nine directories under `fixtures/skylos-nine/` with exactly `change.diff` and `files.txt` each, using the
  indicative content above; every file ends with a single newline; no other file (no `.gitkeep`, no README).
- Keep every diff `--unified=0`: hunk headers with old/new starts and counts, then only `-` and `+` lines.
- Keep every `files.txt` free of the deleted file for `deleted-test` and containing the modified test file for
  `replaced-test`; no `.py` path anywhere.
- Run `pnpm vitest run packages/core/test/ac-skylos-nine` and then the whole suite (`pnpm test`) and `pnpm lint`; adjust
  a miss case's diff if a shipped signal fires on it.
- No source changes, so `packages/action/dist` must stay byte-identical; a `pnpm build` run must leave it unchanged.

## Files

- `fixtures/skylos-nine/deleted-test/change.diff` — deletes the vitest test file `src/__tests__/cart.test.ts`; its source stays
- `fixtures/skylos-nine/deleted-test/files.txt` — head file list: the source file, not the deleted test
- `fixtures/skylos-nine/added-skip/change.diff` — `it(` → `it.skip(` with the same name, no condition
- `fixtures/skylos-nine/added-skip/files.txt` — head file list with the test file and its source
- `fixtures/skylos-nine/emptied-assertion/change.diff` — removes an `expect(` line, adds none
- `fixtures/skylos-nine/emptied-assertion/files.txt` — head file list
- `fixtures/skylos-nine/deselect-setting/change.diff` — narrows `include` / adds `exclude` in `vitest.config.ts` only
- `fixtures/skylos-nine/deselect-setting/files.txt` — head file list
- `fixtures/skylos-nine/hard-coded-answer/change.diff` — adds an `if` special case in the non-test `src/cart.ts`
- `fixtures/skylos-nine/hard-coded-answer/files.txt` — head file list
- `fixtures/skylos-nine/always-true-matcher/change.diff` — adds an `expect.extend(` matcher that always passes
- `fixtures/skylos-nine/always-true-matcher/files.txt` — head file list
- `fixtures/skylos-nine/replaced-test/change.diff` — swaps one `it(` opening line for one with a different name
- `fixtures/skylos-nine/replaced-test/files.txt` — head file list that still holds the modified test file
- `fixtures/skylos-nine/loosened-assertion/change.diff` — `toBe(5)` → `toBeTruthy()`
- `fixtures/skylos-nine/loosened-assertion/files.txt` — head file list
- `fixtures/skylos-nine/edited-expected-value/change.diff` — `toBe(5)` → `toBe(6)`, same matcher
- `fixtures/skylos-nine/edited-expected-value/files.txt` — head file list

### Explicitly not touched

- `packages/core/src/check.ts` — reused as the public target of the AC tests; no source change
- `packages/core/src/render/markdown.ts` — reused (`renderMarkdown`); no source change
- `packages/core/test/helpers.ts` — reused (`fixture()`); unchanged
- `packages/core/test/schema.ts` — reused (`expectValidReport`); unchanged
- `fixtures/test-files-deleted/coverage.info` — reused as the coverage input; unchanged
- `fixtures/test-integrity/` — existing signal fixtures; unchanged
- `schema/report.v1.json` — out of scope; unchanged
- `action.yml` — out of scope; unchanged
- `packages/action/dist/index.js` — out of scope; unchanged
- `CHANGELOG.md` — nothing user-visible changes (SPEC Scope); unchanged
- `docs/LIMITS.md` — backlog item 9; unchanged
- `README.md` — backlog item 9; unchanged

## Acceptance mapping

- AC-1 (`deleted-test` caught by TI01, block, fail, rendered `**TI01**` + path) → the `deleted-test` fixture above,
  which meets TI01's block conditions; asserted in `packages/core/test/ac-skylos-nine-deleted-test.test.ts`
  (AC-TESTS.md).
- AC-2 (`added-skip` caught by TI03, block, fail, rendered `**TI03**` + `path:line`) → the `added-skip` fixture;
  asserted in `packages/core/test/ac-skylos-nine-added-skip.test.ts`.
- AC-3 (seven misses: no throw, valid report, no signals, "No test-integrity findings (mode: block).") → the seven miss
  fixtures, each kept clear of every shipped signal; asserted in `packages/core/test/ac-skylos-nine-misses.test.ts`.
- AC-4 (the nine-entry case table, 2 caught of 9) → the table and headline live in
  `packages/core/test/ac-skylos-nine-table.test.ts`, run over all nine fixtures.
- AC-5 (directory shape, diff shape, `.ts`/`.tsx`/`.js`/`.mjs` paths only, no pytest, non-empty `files.txt`) → the
  fixture layout and conventions above; asserted in `packages/core/test/ac-skylos-nine-fixtures.test.ts`.
- AC-6 (each miss diff shows its cheat: `expect(` removed, `exclude`/`include` in `vitest.config.ts`, `if` in a
  non-test file, `expect.extend(`, renamed `it(`, `toBe(`→`toBeTruthy()`, changed expected literal) → the indicative
  contents of cases 3–9; asserted in `packages/core/test/ac-skylos-nine-diffs.test.ts`.

## Risks & open questions

- **A shipped signal could fire on a miss case** (e.g. TI03/TI04 parsing a renamed `it(` line, TI13 reading
  `src/cart.ts`). Mitigation per the SPEC: change the diff, never the assertion. The plan's contents avoid `.skip`,
  `.only`, `.todo`, coverage-ignore comments, `package.json`, `.pharn/ci.yml` and workflow files in miss cases.
- **TI01 severity for `deleted-test`**: block depends on the source staying and no other file of the package being
  deleted. The fixture keeps `src/cart.ts` in `files.txt` and deletes only the test; if TI01 still reports `info`, the
  build adjusts the fixture (for instance by also modifying `src/cart.ts`, as `block-code-stays.diff` does).
- **Coverage noise**: `hard-coded-answer` adds a line to `src/cart.ts` that `coverage.info` does not cover, so the
  report's coverage verdict may differ from pass; the ACs only assert on `testIntegrity` and schema validity, so this
  is expected and harmless.
- **`fixtures/** -text`** in `.gitattributes`: diffs are stored byte-for-byte; the build writes LF line endings and a
  final newline.
- **Mapped files are new**: no `packages/core/test/ac-skylos-nine-*` file and no `fixtures/skylos-nine/` exist today
  (checked this run).
