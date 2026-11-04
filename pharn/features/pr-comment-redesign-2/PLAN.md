---
spec_id: pr-comment-redesign-2
spec_content_hash: 41dbaff389d1e28ee45db56e21d106c4d660802fa7eecf8b84eb5679a522288f
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/render/markdown.ts` (whole file), `packages/core/src/report.ts` (`Report`,
> `ReportDiffCoverage.threshold`, `BuildReportInput`), `packages/core/src/check.ts` (exports),
> `packages/action/src/run.ts` (`COMMENT_MARKER`, `commentScopeLine`, `MAX_COMMENT_LENGTH`, `FALLBACK_ROWS`,
> `fitMarkdown`), `fixtures/golden/report.md`, `fixtures/render/hostile-paths.json`, the list of committed `report.md`
> goldens, `README.md` ("Example PR comment"), `CHANGELOG.md` (Unreleased headings), `docs/THREAT-MODEL.md` (rows B1,
> B3), `package.json` and the package `build` scripts, the tracked `dist` files, and every test that pins today's
> layout: `markdown.test.ts`, `ac-markdown-order-cap.test.ts`, `ac-setup-render.test.ts`, `exclusions-report.test.ts`,
> `golden.test.ts`, `ac-format-golden.test.ts`, `ac-paths-partial.test.ts`, the tests that compare a render with a
> committed `report.md`, `packages/action/test/{ac-comment-fit,run}.test.ts`, `packages/cli/test/main.test.ts`.
> Also read the earlier attempt's record `pharn/features/pr-comment-redesign/` (PLAN, AC-TESTS, LOOP) as DATA: that run
> stopped at red entry gates before any test or build, and its plan missed the hash-pinned goldens (step 7 below).

The change lives in the renderer. `renderMarkdown()` keeps every section, heading, escaping rule and the footer it has
today and gains three things: an isolated logo slot that renders nothing yet, a one-glance summary table between the
verdict heading and `### Diff coverage`, and a `<details>` collapse for a diff coverage table of more than 25 files.
The footer AC-4 describes (`<sub>pharn-ci <version> · report schema v<n></sub>` as the last line) already exists and
stays byte for byte. Report data, the schema, message codes and text, `fitMarkdown`, the comment marker and the size
limits do not change (SPEC Out of scope).

1. **Logo slot: new `packages/core/src/render/logo.ts`.** One export, `logoMarkup(): string`, returning `""`. Its doc
   comment says it is the one place the header's logo markup comes from, that it renders nothing until the user
   supplies the pharn logo, and that `docs/assets/pharn-ci-logo.svg` is not that logo (SPEC Assumptions). No import,
   no I/O (AGENTS.md rule 1; `purity.test.ts` scans it). A file of its own so adding the logo later changes this file
   only (SPEC Scope). Not re-exported from `packages/core/src/index.ts`.
2. **Header: `markdown.ts`.** Import `logoMarkup` from `./logo.js`. Before the verdict heading:
   `const logo = logoMarkup(); if (logo !== "") out.push(logo, "");`. The heading line stays exactly
   `## ${VERDICT_ICON[verdict]} pharn-ci: ${verdict}` followed by `""`, so with the empty slot the first line is
   unchanged (AC-1; the run, sticky-comment and exclusions tests match it as the first line).
3. **Summary block: `markdown.ts`.** Right after the heading, before `### Diff coverage`, a fixed three-column table
   and a blank line, built by a new private `summaryLines(report: Report): string[]`:

   ```text
   | Verdict | Diff coverage | Agent setup |
   | --- | --- | --- |
   | ❌ fail | 71.43% (threshold 80%) | 8 files |
   ```

   Every cell is a fixed string, an icon from `VERDICT_ICON`, a number through `formatNumber`, or a count. Nothing
   input-derived reaches it (SPEC Constraints), so no path or message can add a cell or a line.
   - Verdict cell: `${VERDICT_ICON[verdict]} ${verdict}`.
   - Diff coverage cell: `report.diffCoverage === null` → `not computed`; `percent === null` → `no coverable lines`;
     otherwise `${formatNumber(percent)}%` then ` (threshold ${formatNumber(threshold)}%)`, or ` (no threshold)` when
     `diffCoverage.threshold === null`. The threshold is `diffCoverage.threshold`, the field the `### Diff coverage`
     line reads today.
   - Agent setup cell: `report.agentSetup.files.length` 0 → `none`, 1 → `1 file`, n → `${n} files`.
   - No cell starts with a back-tick (the F-32 tests pick diff coverage rows by a leading `` | ` ``) and none names
     `report.json` (the truncation test asserts its absence when nothing is cut).
   - Message counts and missing expected tools stay in their own sections (SPEC Assumptions).
4. **Diff coverage collapse: `markdown.ts`.** In the branch that renders the diff coverage table:
   `const collapse = dc.files.length > COLLAPSE_ABOVE;` (the existing constant, 25). When true, push `"<details>"`,
   `` `<summary>Show all ${dc.files.length} changed files</summary>` `` and `""` before the table header, and
   `"</details>"`, `""` after the table's trailing blank line (its `…and N more files` row included), mirroring the
   agent setup collapse. The bold percent line stays above the block; `FULL_REPORT_NOTE` stays after it, outside, so
   the pointer to `report.json` shows when rows are cut. Exactly 25 files render as today. Update the
   `COLLAPSE_ABOVE` doc comment to say it applies to both tables. A shared private helper for the two collapses is
   optional; the agent setup output must stay byte for byte (`ac-setup-render.test.ts` AC-13 matches `"<details>"`
   and `"</details>"` as whole lines).
5. **Unchanged on purpose.** The excluded-files line `<details><summary>Excluded: N files</summary>` (pinned by
   `exclusions-report.test.ts`), the messages section (never collapsed) and its place before `### Agent setup`, the
   agent setup section, `MESSAGE_HINTS`, `code()`, `inlineText()`, `CONTROL_CHARS`, the footer line,
   `RenderMarkdownOptions` and `formatRanges`.
6. **Goldens and snapshot.** The output changes on purpose (AGENTS.md rule 4). Regenerate with only the tests that own
   them: `pnpm vitest run -u packages/core/test/golden.test.ts packages/core/test/markdown.test.ts packages/core/test/ac-format-golden.test.ts packages/core/test/ac-globs-golden.test.ts packages/core/test/exclusions-golden.test.ts packages/core/test/ac-paths-unmatched-check.test.ts`.
   Review the diff: each of the five `report.md` files gains the summary table and nothing else (none lists more than
   25 diff coverage files), the two `markdown.test.ts` snapshots gain it (`not computed` / `none`;
   `no coverable lines` / `1 file`), and **no `report.json` changes** (they are not in `## Files`; a diff there means
   report data changed, which is out of scope and breaks AC-7).
7. **Hash-pinned goldens (correct, not weaken).** Two existing tests pin sha256 hashes of the committed markdown, and
   each earlier intentional render change (F-32, F-16, F-11) updated them with a comment saying why:
   - `packages/core/test/ac-format-golden.test.ts`: `GOLDEN_MD_SHA256` (hash of `fixtures/golden/report.md` without
     the `COVERAGE_PATHS_PARTIALLY_UNMATCHED` bullet and its hint line).
   - `packages/core/test/ac-paths-partial.test.ts`: `GOLDEN_MD_SHA256` and `GOLDEN_COBERTURA_MD_SHA256` (same
     derivation; both equal today and stay equal) and `EXCLUSIONS_MD_SHA256` (hash of the whole
     `fixtures/golden-exclusions/report.md`).

   After step 6, compute each new value with the derivation the test itself uses (a throwaway `node -e` over the
   regenerated file, nothing written), replace only those four constants, and append one sentence to each comment
   block: this feature added the summary table under the verdict heading on purpose, the JSON did not change. Every
   `*_JSON_SHA256` constant stays as it is. No assertion is removed or loosened.
8. **Docs.**
   - `README.md` "Example PR comment": replace the quoted block with the regenerated `fixtures/golden/report.md`,
     each line prefixed `> ` (`>` alone for a blank line), so it shows the summary table, the worst-first row order,
     both messages with their hints, the 8-file inventory and the footer. Nothing else in the README changes.
   - `CHANGELOG.md`: one line under `## [Unreleased]` › `### Changed`: the PR comment, job summary and CLI markdown
     open with a summary table (verdict, diff coverage against the threshold, agent setup file count) under the
     verdict heading, and a diff coverage table of more than 25 files is collapsed in a `<details>` block; report
     data, headings and message text are unchanged.
9. **Bundle and gates.** `pnpm build` (AGENTS.md rule 7). Of what it writes, only `packages/action/dist/index.js` is
   tracked; core and cli `dist` are git-ignored. Then `pnpm test` and `pnpm lint` green. Run `pnpm format` only on
   files in `## Files`, named one by one.

## Applied lessons

- none: the project has no `memory-bank/lessons-learned.md` yet (`check-lessons-index.mjs --verdict` printed
  `NO_CANON` this run), so there are no promoted lessons to apply.

## Steps

- Add `packages/core/src/render/logo.ts` with `logoMarkup(): string` returning `""` and its doc comment.
- In `markdown.ts`: import `logoMarkup` and push it above the heading only when non-empty; add `summaryLines(report)`
  and push it between the heading and `### Diff coverage`; collapse the diff coverage table above 25 files.
- Regenerate the five `report.md` goldens and `markdown.test.ts.snap` with the scoped `vitest run -u` (step 6);
  confirm no `report.json` changed.
- Recompute and replace the four markdown hash constants with a one-sentence reason each (step 7).
- Update the README example and add the CHANGELOG line.
- `pnpm build`, then `pnpm test` and `pnpm lint`.

## Files

- `packages/core/src/render/logo.ts` — new: `logoMarkup(): string`, the one place the header's logo markup comes from; returns `""` in this increment
- `packages/core/src/render/markdown.ts` — logo slot above the verdict heading; summary table between the heading and `### Diff coverage`; diff coverage table collapsed in `<details>` above 25 files
- `fixtures/golden/report.md` — regenerated: gains the summary table
- `fixtures/golden-cobertura/report.md` — regenerated: gains the summary table
- `fixtures/golden-exclusions/report.md` — regenerated: gains the summary table
- `fixtures/golden-multi/report.md` — regenerated: gains the summary table
- `fixtures/coverage-paths/package-relative/report.md` — regenerated: gains the summary table
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots gain the summary table
- `packages/core/test/ac-format-golden.test.ts` — `GOLDEN_MD_SHA256` recomputed for the intentional render change, with a one-sentence reason; no assertion changed
- `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256` and `EXCLUSIONS_MD_SHA256` recomputed, with a one-sentence reason; JSON hashes and assertions unchanged
- `README.md` — "Example PR comment" replaced with the new golden render, quoted
- `CHANGELOG.md` — one line under Unreleased › Changed
- `packages/action/dist/index.js` — rebuilt bundle (core changed)

### Explicitly not touched

- `schema/report.v1.json` — no schema change (SPEC Out of scope)
- `packages/core/src/report.ts` — report data, message codes and text unchanged
- `packages/core/src/index.ts` — `logoMarkup` stays internal to the renderer
- `packages/action/src/run.ts` — `fitMarkdown`, the marker, scope line, limits and fallback rows unchanged; the summary table sits above every table, so the fallback re-renders keep it
- `packages/cli/src/main.ts` — prints `renderMarkdown` output as today
- `fixtures/golden/report.json` — report data unchanged; AC-7 compares against it as committed
- `fixtures/golden-cobertura/report.json` — as above
- `fixtures/golden-exclusions/report.json` — as above
- `fixtures/golden-multi/report.json` — as above
- `fixtures/coverage-paths/package-relative/report.json` — as above
- `fixtures/coverage-paths/package-relative/report-warn.json` — as above
- `fixtures/render/hostile-paths.json` — AC-5 input, read only
- `docs/assets/pharn-ci-logo.svg` — not the logo the user will supply; not linked or embedded
- `docs/THREAT-MODEL.md` — no new parsing, write target or API call; B1 stays true (the summary table holds no input-derived text) and B3 stays true (the verdict heading and messages stay above the tables)
- `packages/core/test/markdown.test.ts` — unchanged; only its snapshot file is regenerated
- `packages/core/test/ac-setup-render.test.ts` — unchanged; its 25/26/60-file inventories have no diff coverage files, so the new collapse adds no `<details>` line before the agent setup one
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 → steps 2 and 3: with the empty slot the first non-empty line is `## ❌ pharn-ci: fail`; the summary table
  before `### Diff coverage` reads `❌ fail`, `71.43% (threshold 80%)` and `8 files` for the golden inputs.
- AC-2 → step 3: `not computed` (`diffCoverage` null), `no coverable lines` (`percent` null), `(no threshold)`
  (`diffCoverage.threshold` null with a percent), `none` (0 files), `1 file` (1 file), each in the summary table
  above `### Diff coverage`.
- AC-3 → steps 3 and 4 plus the unchanged order: heading, summary table, `### Diff coverage`, `### Messages`,
  `### Agent setup`; 30 diff coverage files → `<summary>Show all 30 changed files</summary>`; 30 setup files → the
  existing `<summary>Show all 30 agent setup files</summary>`; message lines outside any block; at 25 of each, no
  `<details>` around either table.
- AC-4 → step 1 and the unchanged footer: the last non-empty line is `<sub>pharn-ci <version> · report schema
  v1</sub>`; the slot returns `""` and no step adds an image or URL.
- AC-5 → step 3 adds only fixed strings and counts, step 5 keeps every escaping rule: the hostile render's summary
  table equals the benign one, every table (summary included) keeps its header's cell count, no `<img` outside code
  spans, and message lines stay inert.
- AC-6 → the summary table sits above every table and `fitMarkdown` cuts table rows before text, so an oversized
  report's comment starts with the marker, scope line and heading, keeps the summary table and every message line,
  and stays at most 65,000 characters.
- AC-7 → nothing in `report.ts`, `check.ts` or the schema changes, and no `report.json` is in `## Files`, so
  `check()` on the golden inputs still deep-equals the committed `fixtures/golden/report.json` and validates.

## Risks & open questions

- **Red run (`pharn/pharn-contracts/ac-tests.md`, "The red run").** A leaf titled `AC-<n>:` that passes before the
  build REDs the run (`ac-test-passes-before-build`, no escape hatch). AC-1, AC-2, AC-3 and AC-6 fail before the build
  on their own (no summary table, no diff coverage collapse). **AC-4, AC-5 and AC-7 already hold on today's code**, so
  each needs a new-behaviour assertion that belongs to its criterion:
  - AC-4: `await import("../src/render/logo.js")` and assert `logoMarkup()` returns `""` (the one place an image
    could enter the header renders none); and for each AC-1/AC-2/AC-3 report, assert the lines before
    `### Diff coverage` are exactly the heading and the summary table (no image line). Both fail before the build.
  - AC-5: assert the hostile render has the summary table between the heading and `### Diff coverage`, showing
    `not computed` and `6 files`, equal line for line to the benign render's; count cells over every table in the
    render, the summary table included, with the backslash rule `markdown.test.ts` uses.
  - AC-7: besides the deep-equal and `expectValidReport`, assert that rendering that same report shows its own values
    in the summary table (`formatNumber(report.diffCoverage.percent)%`, the threshold, the setup count): the new look
    comes from the unchanged data. `/pharn-grill` may judge whether that assertion belongs to AC-7; the alternative
    is a SPEC change, which this stage cannot make.
  One `it` per AC, every target imported inside the test body (`await import(...)`), fixtures read inside the body,
  and no `toMatchSnapshot` / `toMatchFileSnapshot` in AC tests, so step 6's `-u` cannot rewrite their expectations.
  Validate every built report with `expectValidReport` (AGENTS.md rule 3).
- **AC-7's reference file.** The AC-7 test reads `fixtures/golden/report.json` from disk. It is out of the build's
  scope, but `golden.test.ts` rewrites it under `-u` if the report changed; step 6 therefore checks that no
  `report.json` has a diff, and `/pharn-verify` sees any such change as out of scope.
- **AC-6 test shape.** Drive `run(deps)` with in-memory deps modelled on `packages/action/test/ac-comment-fit.test.ts`
  (50 agent setup files with 2,000-character paths push the full render past 65,000), capture the body passed to
  `createComment`, and compare it with `COMMENT_MARKER`, `commentScopeLine(workflow, job)` and `MAX_COMMENT_LENGTH`
  from `../src/run.js`. Take the expected summary-table lines and message lines from `renderMarkdown(report)` of the
  returned report, then assert each appears in the body. Its last line is the truncation note, not the footer; AC-6
  does not ask for the footer.
- **Future logo.** The slot sits above the heading. When the logo arrives, the first line is no longer the heading,
  so AC-1, the exclusions AC-16 test (`headings[0]` equals `lines[0]`), the run tests that match
  `marker\nscope\n## ❌ pharn-ci: fail`, the goldens and the README example change with it. That is a later increment
  (SPEC Out of scope); an inline image inside the heading line is the alternative it can weigh then.
- **Visual check.** Whether the table and collapse look like the reference bots' reports is advisory; no test checks
  GitHub's rendering. The `<details>` block needs the blank line after `<summary>`, as the agent setup collapse has.
