---
spec_id: pr-comment-verdict-callout
spec_content_hash: "753a92961e678febec24a1771a68b2226be8c00edf1ed5a754c690128bfe32b9"
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/render/markdown.ts` (`renderMarkdown`, `overviewLine`, `VERDICT_LABEL`),
> `fitMarkdown`, `COMMENT_MARKER`, `commentScopeLine` and `MAX_COMMENT_LENGTH` in `packages/action/src/run.ts`,
> `packages/core/test/helpers.ts`, `fixtures/render/hostile-paths.json`, the head of each of the five golden
> `report.md` files, README "Example PR comment" and CHANGELOG Unreleased, plus the earlier features' tests that
> read the overview line. The earlier `pharn/features/pr-comment-logo-2/` PLAN and AC-TESTS were read as DATA for
> the record's shape only.

The overview sentence is pushed by one line of `renderMarkdown()`:
`out.push(overviewLine(report), "")`. The product change replaces that line with a two-line GitHub alert block:

- a module constant `VERDICT_ALERT = { pass: "> [!TIP]", warn: "> [!WARNING]", fail: "> [!CAUTION]" } as const`
  next to `VERDICT_ICON` and `VERDICT_LABEL`;
- ``out.push(VERDICT_ALERT[report.verdict], `> **${VERDICT_LABEL[report.verdict]}** · ${overviewLine(report)}`, "")``.

`overviewLine()` is not changed: same wording, numbers and counts, nothing input-derived. Only its doc comment
changes ("the sentence inside the verdict callout"). The block sits at the top level of the markdown, between the
heading's empty line and the summary table, never inside `<details>` or a list. Core stays pure: string constants,
no I/O, no clock.

The PR comment, the job summary and the CLI all print `renderMarkdown()` output, so all three gain the callout.
`fitMarkdown()` re-renders the whole report with fewer rows at each fallback, so the marker, scope line, logo,
heading and callout always open the body; `run.ts` and `main.ts` need no edit. No schema, report data, message
code, message text or hint changes.

**Dry run this run.** In a scratch copy outside the project, with the two-line change above:
- `pnpm vitest run`: 26 tests in 18 files failed.
- `vitest run -u` regenerated the five tracked `report.md` goldens and `markdown.test.ts.snap`; no `report.json`
  changed. Each diff is exactly the bare overview line replaced by the two callout lines. (A first run of `-u` with
  a list of files left `fixtures/golden/report.md` unchanged; a full `-u` run updated it. The build checks
  `git status` for all five files plus the snapshot.)
- 13 tests in 8 files still failed. These are the files listed under "Existing tests corrected" below.
- With the corrections sketched below applied, all 664 tests in 145 files passed. `pnpm lint` reported only
  Biome formatting.
- Folding the callout back into the bare sentence gives the pinned hashes again: `a55ed107…` (golden, minus the
  partial-mismatch message), `54e56087…` (golden-cobertura, likewise), `d470c10c…` (golden-exclusions) and
  `a92f89d7…` (golden without its logo block). The hostile renderings start exactly two lines with `>`:
  `> [!CAUTION]` and `> **Fail** · Diff coverage was not computed; 6 agent setup files found.`

### Existing tests corrected (never weakened, AGENTS.md rule 4)

Each correction expects the two callout lines where the bare sentence was and still asserts the sentence itself. No
assertion is deleted, and no title changes.

The **hash-pinned** tests keep every pinned constant. Before hashing, each one folds the callout back into the bare
sentence: the `> [!TIP|WARNING|CAUTION]` line and the `> **<Label>** · <sentence>` line become `<sentence>`, and the
test throws if either line is missing. The pin keeps meaning "the output before this change". The test now also
proves that the callout is the only difference. The fold is one exported function, `foldCallout(markdown: string):
string`, in `packages/core/test/helpers.ts`. Above each pinned constant, one comment sentence says that
pr-comment-verdict-callout turned the overview line into a callout on purpose and that the hash is taken after
folding it back.

Test titles cited in `docs/THREAT-MODEL.md` keep their exact text. None of the files below is cited there.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON` this run; the project has no
  `memory-bank/lessons-learned.md` yet, so there is no promoted lesson to apply.

## Steps

- `packages/core/src/render/markdown.ts`:
  - add `VERDICT_ALERT` next to `VERDICT_LABEL`;
  - replace `out.push(overviewLine(report), "")` with the alert marker line, the
    `> **<Label>** · <sentence>` line and one empty line;
  - update `overviewLine()`'s doc comment.
- `packages/core/test/helpers.ts`: add and export `foldCallout(markdown: string): string`, as described above.
- Regenerate with `pnpm vitest run -u`, as AGENTS.md says. Review `git status` and `git diff`: exactly the five
  `report.md` files and `markdown.test.ts.snap` change, each by one line becoming the two callout lines. No
  `report.json` changes. If `fixtures/golden/report.md` did not change, run `pnpm vitest run -u` again.
- Correct the failing tests:
  - `packages/core/test/ac-comment-bold-overview.test.ts`: the `header()` helper takes the heading, the alert
    marker and the content line as the first three non-empty lines after the logo. It asserts that the marker is
    one of the three and that the content line starts `> **<Label>** · `, and returns the sentence after that
    prefix as `overview`. Every existing sentence assertion stays. Each test also asserts the marker that fits
    its verdict.
  - `packages/core/test/ac-comment-bold-header.test.ts`: the first five non-empty lines are the logo, the heading,
    `> [!CAUTION]`, `> **Fail** · <overview>` and the table header. The "above Diff coverage" loop checks the
    callout content line in place of the bare sentence.
  - `packages/core/test/ac-comment-bold-hostile.test.ts`: the line after the heading's empty line is the alert
    marker (matches `^> \[!(TIP|WARNING|CAUTION)\]$`), and the line after it is the callout content line ending
    `found.`. Both join `fixedLines`, so the no-input-text check covers them. The test also asserts that exactly
    two lines start with `>`.
  - `packages/core/test/ac-comment-look-footer.test.ts`: `between` opens with the marker, then the content line
    matching `^> \*\*(Pass|Warn|Fail)\*\* · (Diff coverage |This change ).*found\.$`, then the table rows.
  - `packages/core/test/ac-format-golden.test.ts`: AC-14 folds the callout before removing the partial-mismatch
    lines and hashing; `GOLDEN_MD_SHA256` is unchanged.
  - `packages/core/test/ac-paths-partial.test.ts`: AC-5 folds the callout before removing the message and its
    hint and hashing (golden, golden-cobertura). The golden-exclusions file is folded before its hash. Every
    constant is unchanged.
  - `packages/core/test/ac-header-logo-golden.test.ts`: the rendering without its logo block is folded before it
    is hashed, and `GOLDEN_MD_BEFORE_SHA256` is unchanged. The test also asserts that lines 4 and 5 are
    `> [!CAUTION]` and `> **Fail** · …`.
  - `packages/action/test/ac-comment-bold-fit.test.ts`: in the full rendering, the third and fourth non-empty lines
    are `> [!CAUTION]` and `> **Fail** · <overview>`. Each body contains both lines.
  - `packages/action/test/ac-header-logo-fit.test.ts`: it still passes, but `keptLines()` would now read the alert
    marker as "the overview". It takes the `> **…** · ` content line instead and also requires the marker line in
    each body.
- `README.md`, "Example PR comment": replace the quoted bare sentence line with `> > [!CAUTION]` and
  `> > **Fail** · Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.`,
  so the quoted text matches the regenerated `fixtures/golden/report.md`.
- `CHANGELOG.md`, Unreleased › Changed: add one line saying that the PR comment, job summary and CLI markdown now
  show the overview sentence in a GitHub alert under the verdict heading: `[!CAUTION]` for fail, `[!WARNING]` for
  warn, `[!TIP]` for pass. Report data and message text are unchanged.
- Run `pnpm build`. Of what it writes, only `packages/action/dist/index.js` is tracked.
- Run `pnpm test` and `pnpm lint` until both pass. Run `pnpm format` only on files in `## Files`, named one by one.

## Files

- `packages/core/src/render/markdown.ts` — `VERDICT_ALERT` constant; overview line becomes the two-line alert callout; `overviewLine()` doc comment
- `packages/core/test/helpers.ts` — exported `foldCallout()` used by the hash-pinned tests
- `fixtures/golden/report.md` — regenerated: callout replaces the bare overview line
- `fixtures/golden-cobertura/report.md` — regenerated: as above
- `fixtures/golden-exclusions/report.md` — regenerated: as above (`[!TIP]`)
- `fixtures/golden-multi/report.md` — regenerated: as above
- `fixtures/coverage-paths/package-relative/report.md` — regenerated: as above
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots show the callout
- `packages/core/test/ac-comment-bold-overview.test.ts` — `header()` reads marker and content line; sentence assertions kept
- `packages/core/test/ac-comment-bold-header.test.ts` — expects logo, heading, callout lines, then the table header
- `packages/core/test/ac-comment-bold-hostile.test.ts` — callout lines are fixed lines; exactly two lines start with `>`
- `packages/core/test/ac-comment-look-footer.test.ts` — marker and content line before the summary table
- `packages/core/test/ac-format-golden.test.ts` — callout folded back before hashing; constants and reason comment
- `packages/core/test/ac-paths-partial.test.ts` — callout folded back before hashing; constants and reason comment
- `packages/core/test/ac-header-logo-golden.test.ts` — callout folded back before hashing; callout lines asserted
- `packages/action/test/ac-comment-bold-fit.test.ts` — callout marker and content line expected in the full rendering and each body
- `packages/action/test/ac-header-logo-fit.test.ts` — `keptLines()` takes the callout content line; marker required too
- `README.md` — "Example PR comment" shows the callout lines
- `CHANGELOG.md` — Unreleased › Changed line for the verdict callout
- `packages/action/dist/index.js` — rebuilt bundle (core changed)

### Explicitly not touched

- `packages/core/src/render/logo.ts` — logo line unchanged
- `packages/core/src/index.ts` — no new export
- `packages/core/src/report.ts` — report data, message codes, text and hints unchanged
- `schema/report.v1.json` — no schema change
- `packages/action/src/run.ts` — `fitMarkdown`, marker, scope line, limits and fallback rows unchanged
- `packages/cli/src/main.ts` — prints `renderMarkdown` output as today
- `fixtures/golden/report.json` — report data unchanged; AC-5 compares against it as committed
- `fixtures/golden-cobertura/report.json` — unchanged
- `fixtures/golden-exclusions/report.json` — unchanged
- `fixtures/golden-multi/report.json` — unchanged
- `fixtures/coverage-paths/package-relative/report.json` — unchanged
- `fixtures/render/hostile-paths.json` — AC-4 input, read only
- `docs/THREAT-MODEL.md` — no new untrusted parsing, write target or API call; nothing input-derived in the callout
- `packages/core/test/markdown.test.ts` — passes once its snapshot is regenerated
- `packages/action/test/run.test.ts` — passed unchanged in the dry run
- `packages/action/test/ac-header-logo-run.test.ts` — passed unchanged in the dry run
- `packages/cli/test/ac-header-logo-cli.test.ts` — passed unchanged in the dry run

## Acceptance mapping

- AC-1 → the renderer replaces only the overview line with the marker chosen by `report.verdict` and
  `> **<Label>** · ` plus the same sentence. The five goldens before this increment (sha256 `d0b78ab8…` golden and
  golden-multi, `457bad30…` golden-cobertura, `d470c10c…` golden-exclusions, `4c6c42ea…` package-relative) are what
  the folded renderings equal. The dry run showed this for each file.
- AC-2 → `VERDICT_ALERT` and `VERDICT_LABEL` are both keyed by verdict, and `overviewLine()` gives the three
  sentences unchanged. The callout's empty line is followed by `summaryLines()`' table header.
- AC-3 → `overviewLine()` keeps its `This change adds no coverable lines` branch; the callout prefixes the label.
- AC-4 → the callout holds only fixed words, the label, numbers and counts. Message text escapes `>` as `&gt;`, and
  table rows and list items never start with `>`. The dry run showed exactly two `>` lines in both hostile renderings.
- AC-5 → no change to `check()`, `report.ts` or the schema; `fixtures/golden/report.json` stays as committed
  (sha256 `37d7101a…f8635f7`).
- AC-6 → `fitMarkdown()` re-renders the whole report at each fallback, so the callout always follows the heading,
  before the table and messages. `run.ts` needs no change.
- AC-7 → `run()` posts `COMMENT_MARKER\nSCOPE\n` plus `renderMarkdown()`, which now has the `[!CAUTION]` callout
  under the Fail heading.
- AC-8 → `main()` prints `renderMarkdown()` output, which has the `[!TIP]` callout under the Pass heading.

## Risks & open questions

- Nine corrected test files are earlier features' AC tests (`ac-comment-bold-*`, `ac-comment-look-footer`,
  `ac-format-golden`, `ac-paths-partial`, `ac-header-logo-golden`, `ac-header-logo-fit`). Their locks pin them only for
  those features' records. The PR description must say why each was corrected (AGENTS.md rule 4): the overview
  sentence moved into a callout on purpose, and every pinned hash is unchanged after folding it back.
- `packages/core/test/helpers.ts` is shared by many tests. Adding an export does not change any existing function.
  If `check-ac-tests.mjs` classed it as test infrastructure, the build would instead copy `foldCallout()` into
  each of the three hash-pinned files.
- In an Actions job summary and in a terminal the alert may show as a plain blockquote with the `[!CAUTION]`
  text. The SPEC Assumptions accept this.
- The README example sits inside a blockquote, so the callout appears there as a nested quote (`> > [!CAUTION]`),
  not as a coloured box. The SPEC Assumptions accept this.
- The AC test files in `AC-TESTS.md` are written by `/pharn-test` and stay out of this plan's `## Files`. They
  use new `ac-verdict-callout-*` names that no other feature uses.
