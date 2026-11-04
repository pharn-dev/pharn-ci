---
spec_id: pr-comment-redesign
spec_content_hash: f1652b61150a69b37bcac159a8f855c19c2b3d83532cc20d6ee3ee001b0b7f7f
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/render/markdown.ts` (whole file), `packages/core/src/report.ts`
> (`BuildReportInput`), `packages/action/src/run.ts` (constants, `run()` comment and summary path, `fitMarkdown`),
> `schema/report.v1.json` (`tool`), `fixtures/golden/report.md`, `fixtures/render/hostile-paths.json`, the list of
> committed `report.md` goldens and the markdown snapshot, `README.md` ("Example PR comment"), `CHANGELOG.md`
> (Unreleased headings), `docs/THREAT-MODEL.md` (rows B1, B3), `package.json`, `packages/action/package.json`
> (`build`), and the render tests that pin today's layout: `markdown.test.ts`, `ac-setup-render.test.ts`,
> `ac-markdown-order-cap.test.ts`, `exclusions-report.test.ts`, `golden.test.ts`,
> `packages/action/test/ac-comment-fit.test.ts`, `packages/action/test/run.test.ts`, `packages/cli/test/main.test.ts`.
> Conventions taken from `pharn/features/require-agent-setup/{PLAN,AC-TESTS}.md` and
> `pharn/features/agent-setup-inventory/PLAN.md`.

The change lives in the renderer only. `renderMarkdown()` keeps every section, heading and escaping rule it has today
and gains three things: an isolated (empty) logo slot above the verdict heading, a one-glance summary table between the
verdict heading and `### Diff coverage`, and a `<details>` collapse for the diff coverage table above 25 files. The
footer that AC-4 describes (`<sub>pharn-ci <version> · report schema v<n></sub>` as the last line) already exists and
stays byte-for-byte. Report data, the schema, message codes and text, `fitMarkdown` and the comment marker do not
change (SPEC Out of scope).

1. **Logo slot — new `packages/core/src/render/logo.ts`.** One export, `logoMarkup(): string`, which returns `""`.
   Its doc comment says it is the one place the header's logo markup comes from, that it renders nothing until the
   user supplies the pharn logo, and that `docs/assets/pharn-ci-logo.svg` is not that logo (SPEC Assumptions). Pure:
   no import, no I/O (AGENTS.md rule 1). A separate file so adding the logo later changes this file only (SPEC
   Scope). Not re-exported from `packages/core/src/index.ts`; the renderer is its only caller.
2. **Header — `packages/core/src/render/markdown.ts`.** `renderMarkdown` imports `logoMarkup` from `./logo.js`.
   Before the verdict heading: `const logo = logoMarkup(); if (logo !== "") out.push(logo, "");`. The heading line
   stays exactly `## ${VERDICT_ICON[verdict]} pharn-ci: ${verdict}` followed by `""`, so with today's empty slot the
   first non-empty line is unchanged (AC-1, SPEC Assumptions: the run tests and the sticky-comment tests match
   `${COMMENT_MARKER}\n${SCOPE}\n## ❌ pharn-ci: fail`).
3. **Summary block — `markdown.ts`.** Right after the heading, before `### Diff coverage`, a fixed three-column
   table, then a blank line:

   ```text
   | Verdict | Diff coverage | Agent setup |
   | --- | --- | --- |
   | ❌ fail | 71.43% (threshold 80%) | 8 files |
   ```

   Built by a new private `summaryLines(report): string[]` helper. Every cell is a fixed string, a number through
   `formatNumber`, or a count; nothing input-derived (SPEC Constraints), so no escaping is needed and no path can add
   a cell or a line to it.
   - Verdict cell: `${VERDICT_ICON[verdict]} ${verdict}`.
   - Diff coverage cell: `report.diffCoverage === null` → `not computed`; `percent === null` → `no coverable lines`;
     otherwise `${formatNumber(percent)}%` followed by ` (threshold ${formatNumber(threshold)}%)` or, when
     `diffCoverage.threshold === null`, ` (no threshold)`. The threshold read is `diffCoverage.threshold`, the same
     field the `### Diff coverage` line uses today.
   - Agent setup cell: `report.agentSetup.files.length` → `0` → `none`, `1` → `1 file`, `n` → `${n} files`.
   - Message counts and missing expected tools stay in their sections (SPEC Assumptions).
4. **Diff coverage collapse — `markdown.ts`.** In the `### Diff coverage` branch that renders the table:
   `const collapse = dc.files.length > COLLAPSE_ABOVE;` (the existing constant, 25). When true, push `"<details>"`,
   `` `<summary>Show all ${dc.files.length} changed files</summary>` `` and `""` before the table header, and `""`,
   `"</details>"`, `""` after the table (its `…and N more files` row included), mirroring the agent setup collapse
   exactly. The bold percent line stays above, outside the block; `FULL_REPORT_NOTE` stays after the block, outside
   it, so the pointer to `report.json` is visible when rows are cut. Exactly 25 files render as today (no block).
   A small private helper shared by the two table collapses (open lines, close lines) is optional; if added, the
   agent setup output must stay byte-for-byte (`ac-setup-render.test.ts` AC-13 matches `"<details>"` and
   `"</details>"` as whole lines).
5. **Unchanged on purpose.** The excluded-files `<details>` line (`<details><summary>Excluded: N files</summary>`,
   pinned by `exclusions-report.test.ts` and `exclusions-golden.test.ts`), the messages section (never collapsed),
   its position before `### Agent setup`, the agent setup section, `MESSAGE_HINTS`, `code()`, `inlineText()`, the
   control-character rule, and the footer line. `RenderMarkdownOptions` and `formatRanges` keep their signatures.
6. **Goldens and snapshot.** The output changes on purpose, so regenerate the committed markdown goldens and the
   inline snapshot (AGENTS.md rule 4) by running only the tests that own them with `-u`:
   `pnpm vitest run -u packages/core/test/golden.test.ts packages/core/test/markdown.test.ts packages/core/test/ac-format-golden.test.ts packages/core/test/ac-globs-golden.test.ts packages/core/test/exclusions-golden.test.ts packages/core/test/ac-paths-unmatched-check.test.ts`.
   Then review the diff: each `report.md` gains the summary table and nothing else (none of the goldens lists more than
   25 diff coverage files), and every `report.json` beside them must show **no** diff (they are not in `## Files`;
   report data does not change). The two `markdown.test.ts` snapshots gain the summary table (`not computed` / `none`
   and `no coverable lines` / `1 file`).
7. **Docs.**
   - `README.md` "Example PR comment": replace the quoted block with the current golden render
     (`fixtures/golden/report.md` after step 6) quoted line by line with `> `, so the example shows the summary
     table, the real row order (worst coverage first), both messages with their hints, the 8-file inventory and the
     footer. Nothing else in the README changes.
   - `CHANGELOG.md`: one line under `## [Unreleased]` › `### Changed`: the PR comment, job summary and CLI markdown
     open with a summary table (verdict, diff coverage against the threshold, agent setup file count) under the
     verdict heading, and a diff coverage table of more than 25 files is collapsed in a `<details>` block; report data,
     headings and message text are unchanged.
8. **Bundle.** Rebuild `packages/action/dist/index.js` with `pnpm --filter @pharn-ci/action build` (AGENTS.md rule
   7), as the previous runs did; it writes only the committed bundle. Then `pnpm test` and `pnpm lint` stay green.

## Applied lessons

- none — the project has no `memory-bank/lessons-learned.md` yet (`check-lessons-index.mjs --verdict` printed
  `NO_CANON` this run), so there are no promoted lessons to apply.

## Steps

- Add `packages/core/src/render/logo.ts` with `logoMarkup(): string` returning `""` and its doc comment.
- In `markdown.ts`: import `logoMarkup`; push it above the heading only when non-empty; add `summaryLines(report)` and
  push it between the heading and `### Diff coverage`; collapse the diff coverage table above 25 files.
- Regenerate the five `report.md` goldens and `markdown.test.ts.snap` with the scoped `vitest run -u` (step 6);
  confirm no `report.json` changed.
- Update the README example and add the CHANGELOG line.
- Run `pnpm --filter @pharn-ci/action build`, then `pnpm test` and `pnpm lint`.

## Files

- `packages/core/src/render/logo.ts` — new: `logoMarkup(): string`, the one place the header's logo markup comes from; returns `""` today
- `packages/core/src/render/markdown.ts` — logo slot above the verdict heading; summary table between the heading and `### Diff coverage`; diff coverage table collapsed in `<details>` above 25 files
- `fixtures/golden/report.md` — regenerated: gains the summary table
- `fixtures/golden-cobertura/report.md` — regenerated: gains the summary table
- `fixtures/golden-exclusions/report.md` — regenerated: gains the summary table
- `fixtures/golden-multi/report.md` — regenerated: gains the summary table
- `fixtures/coverage-paths/package-relative/report.md` — regenerated: gains the summary table
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots gain the summary table
- `README.md` — "Example PR comment" replaced with the new golden render, quoted
- `CHANGELOG.md` — one line under Unreleased › Changed
- `packages/action/dist/index.js` — rebuilt bundle (core changed)

### Explicitly not touched

- `schema/report.v1.json` — no schema change (SPEC Out of scope)
- `packages/core/src/report.ts` — report data, message codes and text unchanged
- `packages/core/src/index.ts` — `logoMarkup` is internal to the renderer; no new public export
- `packages/action/src/run.ts` — `fitMarkdown`, the marker, scope line and size limits unchanged; it already keeps everything above the tables
- `packages/cli/src/main.ts` — prints `renderMarkdown` output as today
- `fixtures/golden/report.json` — report data unchanged; must show no diff after `-u`
- `fixtures/golden-cobertura/report.json` — as above
- `fixtures/golden-exclusions/report.json` — as above
- `fixtures/golden-multi/report.json` — as above
- `fixtures/coverage-paths/package-relative/report.json` — as above
- `fixtures/coverage-paths/package-relative/report-warn.json` — as above
- `docs/assets/pharn-ci-logo.svg` — not the logo the user means to supply; not linked or embedded
- `docs/THREAT-MODEL.md` — no new parsing, write target or API call; row B1 stays true (the summary table holds no input-derived text) and B3 stays true (the verdict heading stays)
- `packages/core/test/markdown.test.ts` — unchanged; only its snapshot file is regenerated
- `packages/core/test/ac-setup-render.test.ts` — unchanged; its 25/26/60-file inventories have no diff coverage files, so the new collapse never adds a `<details>` line before the agent setup one
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 → steps 2 and 3: with the empty logo slot the first non-empty line is `## ❌ pharn-ci: fail`; the summary table
  that follows, before `### Diff coverage`, reads `❌ fail`, `71.43% (threshold 80%)` and `8 files` for the golden
  inputs.
- AC-2 → step 3: `not computed` (`diffCoverage` null), `no coverable lines` (`percent` null), `(no threshold)`
  (`diffCoverage.threshold` null with a percent), `none` (0 files), `1 file` (1 file), each in the summary table
  above `### Diff coverage`.
- AC-3 → steps 3 and 4 plus the unchanged order: heading, summary table, `### Diff coverage`, `### Messages`,
  `### Agent setup`; 30 diff coverage files → `<details>` with `<summary>Show all 30 changed files</summary>`; 30
  setup files → the existing `<summary>Show all 30 agent setup files</summary>`; messages stay outside any block; at
  25 of each, no `<details>` around either table.
- AC-4 → step 1 and the unchanged footer: the last non-empty line is `<sub>pharn-ci <version> · report schema
  v1</sub>`; the renderer adds no image or URL anywhere, and the logo slot returns `""`.
- AC-5 → step 3 adds only fixed strings and counts, and step 5 keeps every escaping rule: the hostile render keeps
  equal cell counts per table (the summary table included), no `<img` outside code spans, and inert message lines.
- AC-6 → the summary table sits above every table and `fitMarkdown` only cuts table rows before it cuts text, so an
  oversized report's comment still starts with the marker and scope line and keeps the heading, the summary table and
  every message line, at most 65,000 characters.

## Risks & open questions

- **Red run (for `/pharn-test`, `pharn/pharn-contracts/ac-tests.md`, "The red run").** A leaf titled `AC-<n>:` that
  PASSES before the build REDs the run (`ac-test-passes-before-build`, no escape hatch). AC-1, AC-2, AC-3 and AC-6
  fail before the build on their own (no summary table, no diff coverage collapse). **AC-4 and AC-5 already hold
  today** (the footer exists; the escaping is unchanged). Each needs a new-behaviour assertion that belongs to its
  criterion:
  - AC-4: import `logoMarkup` from `../src/render/logo.js` inside the test body and assert it returns `""` (the one
    place an `<img` could enter the header renders nothing). The module does not exist before the build. Also run
    the AC-4 assertions over at least one report that has the summary table and both collapses (the AC-3 shape), so
    the last-line check covers the new layout.
  - AC-5: assert the hostile render's summary table is present between the heading and `### Diff coverage`, shows
    `not computed` and `6 files`, and equals the benign render's summary table line for line (no input reaches it).
    Count cells over every table in the render, the summary table included, with the backslash rule
    `markdown.test.ts` uses.
  Write **one `it` per AC**, import every target **inside the test body** (`await import(...)`), read fixtures inside
  the body, and use no `toMatchSnapshot` / `toMatchFileSnapshot` in AC tests, so step 6's `-u` cannot rewrite their
  expectations. Validate every built report with `expectValidReport` (AGENTS.md rule 3).
- **AC-4 "any valid report" vs. paths.** A path is rendered literally inside a code span, so a report whose agent
  setup path contains `https://` (the hostile fixture's `x\| @octocat [click](https://evil.example) |/CLAUDE.md`)
  renders `https://` inside a code span, where GitHub neither links nor loads it. This plan does not change `code()`:
  the SPEC's AC-5 already scopes HTML to "outside code spans" and asks for escaping "exactly as before". The AC-4
  test should therefore assert over reports whose paths and message inputs carry no URL (golden, the AC-2 edge
  reports, the AC-3 30-file report) and leave hostile input to AC-5. Flag for `/pharn-grill`.
- **AC-6 test shape.** Drive `run(deps)` with in-memory deps modelled on `packages/action/test/ac-comment-fit.test.ts`
  (50 agent setup files with 2,000-character paths push the full render past 65,000), capture the body passed to
  `createComment`, and compare it with `COMMENT_MARKER`, `commentScopeLine(workflow, job)` and `MAX_COMMENT_LENGTH`
  imported from `../src/run.js`. Take the expected summary-table lines and message lines from
  `renderMarkdown(report)` of the returned report (lines between the heading and `### Diff coverage`; lines under
  `### Messages`), then assert each appears in the body. Its last line is the truncation note, not the footer; AC-6
  does not ask for the footer.
- **Snapshot regeneration scope.** Step 6 names the six test files that own markdown snapshots instead of a bare
  `pnpm test -u`, so no unrelated snapshot is rewritten. A `report.json` diff after it means the build changed report
  data and is out of scope.
- **Visual check.** Whether the table and the collapse look like the reference bots' reports is advisory; no test
  checks GitHub's rendering. The `<details>` block needs the blank line after `<summary>` (as the agent setup collapse
  has) for GitHub to render the table inside it.
- **Logo follow-up.** When the logo arrives, `logoMarkup()` returns its markup and AC-4's no-`<img` clause, the
  goldens and the README example change with it; that is a later, separate increment (SPEC Out of scope).
