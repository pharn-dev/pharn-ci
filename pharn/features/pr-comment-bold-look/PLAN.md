---
spec_id: pr-comment-bold-look
spec_content_hash: d94a11a5a085725de92fa94b6894bbb319186ac5fb7c026f1cb09944aeb90df2
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/render/markdown.ts` and `logo.ts` (whole files), `packages/core/src/report.ts`
> (`Report`, `ReportDiffCoverage.format`, `BuildReportInput`, the message builders), `CoverageFormat` in
> `packages/core/src/coverage/types.ts`, the `format` enum in `schema/report.v1.json`, `packages/action/src/run.ts`
> (`COMMENT_MARKER`, `MAX_COMMENT_LENGTH`, `FALLBACK_ROWS`, `fitMarkdown`), `fixtures/golden/report.md`,
> `fixtures/render/hostile-paths.json`, the tracked `report.md` goldens and `.snap` file, `README.md` ("Example PR
> comment"), `CHANGELOG.md` (Unreleased), `docs/THREAT-MODEL.md` (B1, B3), root `package.json` scripts, and every test
> that matches today's headings, heading text, collapse rule or footer (the grep list in "Existing tests corrected"
> below). The previous increment's record `pharn/features/pr-comment-redesign-2/` (PLAN, AC-TESTS) was read as DATA for
> its file list and the hash-pinned goldens.

The change lives in the renderer, `renderMarkdown()` in `packages/core/src/render/markdown.ts`. Report data, the
schema, message codes and text, `fitMarkdown`, the comment marker, scope line and size limits stay as they are (SPEC
Out of scope). Everything new in the output is a fixed word, an icon, a number, a count, or a value from a fixed enum
(verdict, coverage format) or the tool version (SPEC Constraints). No path or message text reaches it.

### Renderer (`packages/core/src/render/markdown.ts`)

1. **Fixed maps.** Next to `VERDICT_ICON`, add `VERDICT_LABEL = { pass: "Pass", warn: "Warn", fail: "Fail" } as const`
   and `BRAND = "🛡️"`. Add `COVERAGE_FORMAT_LABEL: Record<CoverageFormat, string> = { lcov: "lcov", cobertura:
   "cobertura" }`, typed from `CoverageFormat` (import the type from `../coverage/types.js`). The footer reads the
   format through `Object.hasOwn`, as `renderMessage` reads hints, so a value outside the enum from another producer
   renders nothing. Remove `COLLAPSE_ABOVE`, which is no longer used.
2. **Header block.** The logo slot stays where it is (`logoMarkup()` from `./logo.js`, pushed only when non-empty;
   `logo.ts` unchanged). Then, in order, each followed by `""`:
   - the heading `` `## ${BRAND} pharn-ci · ${VERDICT_ICON[v]} ${VERDICT_LABEL[v]}` ``;
   - the overview sentence from a new private `overviewLine(report)`;
   - the summary table from `summaryLines(report)`. Its only change is the verdict cell, which becomes
     `${VERDICT_ICON[v]} ${VERDICT_LABEL[v]}`. The coverage cell and the setup cell (`none`, `1 file`, `N files`) stay
     as they are.

   `overviewLine` uses the SPEC Assumptions' fixed templates. The first part is:
   - `diffCoverage === null` → `Diff coverage was not computed`;
   - `percent === null` → `This change adds no coverable lines`;
   - `threshold === null` → `` `Diff coverage of this change is ${formatNumber(p)}%, with no threshold set` ``;
   - otherwise `` `Diff coverage of this change is ${formatNumber(p)}% against a threshold of ${formatNumber(t)}%` ``.

   Then `; ` and the setup part, by `agentSetup.files.length`: `no agent setup files found.` (0),
   `1 agent setup file found.` (1) or `` `${n} agent setup files found.` ``. The threshold is `diffCoverage.threshold`,
   the field the headline and the table already read. AC-1's golden sentence follows from this:
   `Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.`
3. **Section headings.**
   - `### 🧪 Diff coverage`.
   - `` `### 💬 Messages (${report.messages.length})` ``. The section is still omitted when there are no messages.
   - `` `### 🤖 Agent setup (${n === 0 ? "no files" : n === 1 ? "1 file" : `${n} files`})` ``.

   The order stays Diff coverage, Messages, Agent setup, so messages still come before the inventory (SPEC Constraints,
   THREAT-MODEL B3).
4. **Diff coverage `<details>`.** In the branch that renders the file table, the bold headline line stays outside and
   above. Then push:
   - the opening tag: `"<details open>"` when `report.messages.some((m) => m.code === "DIFF_COVERAGE_BELOW_THRESHOLD")`,
     else `"<details>"`;
   - `` `<summary>Changed files (${dc.files.length})</summary>` `` and `""`;
   - the table, its `…and N more files` row and its trailing `""`;
   - `"</details>"` and `""`.

   `FULL_REPORT_NOTE` stays after the block, outside it. The excluded-files block is unchanged.
5. **Agent setup `<details>`.** The `Agent setup: N files · <tools>` line and the `Missing:` line stay outside and above.
   The table always sits inside a block: `"<details>"` (never open), then
   `` `<summary>Agent setup files (${setup.length})</summary>` ``, `""`, the table with its `…and N more files` row,
   `""`, `"</details>"`, `""`. The 0-file branch (`_No agent setup files found._` plus the `Missing:` line) has no table
   and no block. Both summary counts are totals, not the rows shown after `maxRows`.
6. **Footer.** After the last section, which already ends in `""`, push `"---"`, `""`, then
   `` `<sub>pharn-ci ${report.tool.version} · report schema v${report.schemaVersion}${fmt}</sub>` ``. `fmt` is
   `` ` · coverage format ${COVERAGE_FORMAT_LABEL[f]}` `` when `report.diffCoverage?.format` is an own key of the map,
   else `""`. The line before `---` is always empty, so `---` is a thematic break and never a setext underline.
7. **Unchanged on purpose.** `MESSAGE_HINTS` (its "listed in the table above" hint now points at an open table, because
   the block is open exactly when that message is present), `renderMessage`, `code()`, `inlineText()`, `CONTROL_CHARS`,
   `byCoverage`, `uncoveredCell`, `formatRanges`, `RenderMarkdownOptions` and the `maxRows` default.

### Goldens and snapshots

8. **Regenerate.** The output changes on purpose (AGENTS.md rule 4). Correct the tests first (steps 10 and 11): some
   assert before their file snapshot is written, notably `ac-format-golden.test.ts` AC-13, whose lcov/Cobertura
   equality would stop the Cobertura golden from being written. Then regenerate with only the tests that own the files:
   `pnpm vitest run -u packages/core/test/golden.test.ts packages/core/test/markdown.test.ts packages/core/test/ac-format-golden.test.ts packages/core/test/ac-globs-golden.test.ts packages/core/test/exclusions-golden.test.ts packages/core/test/ac-paths-unmatched-check.test.ts`.

   Review the diff:
   - Each of the five `report.md` files changes only in the header block, the section headings, the `<details>`
     wrapping and the footer.
   - Both `markdown.test.ts` snapshots change the same way.
   - **No `report.json` changes.** None is in `## Files`; a diff there means report data changed, which breaks AC-7.
   - The golden and golden-cobertura markdown now differ in exactly one line, the footer's coverage format.
9. **Hash-pinned goldens (correct, not weaken).** Each earlier intentional render change (F-32, F-16, F-11,
   pr-comment-redesign-2) updated these constants with a comment saying why:
   - `packages/core/test/ac-format-golden.test.ts`: `GOLDEN_MD_SHA256`.
   - `packages/core/test/ac-paths-partial.test.ts`: `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256` and
     `EXCLUSIONS_MD_SHA256`.

   After step 8, compute each new value with the derivation the test itself uses: drop the partial-mismatch bullet and
   its hint line, or hash the whole file for exclusions. Use a throwaway `node -e` that writes nothing. Replace only
   those four constants. `GOLDEN_MD_SHA256` and `GOLDEN_COBERTURA_MD_SHA256` were equal and now differ, by the footer's
   format. Append one sentence to each comment block saying that pr-comment-bold-look changed the header, section
   headings, collapsing and footer on purpose, that the two golden markdown hashes now differ only by the footer's
   coverage format, and that the JSON did not change. Every `*_JSON_SHA256` stays. No assertion is removed or loosened.

### Existing tests corrected to the new layout (never weakened, AGENTS.md rule 4)

10. **Tests that pin today's layout.** Found by grep this run for `### Diff coverage`, `### Messages`,
    `### Agent setup`, `pharn-ci: `, `<details>`, the 25-file rule and the lcov/Cobertura render equality. Each keeps
    its `it` title (the docs cite some) unless the title states the old rule, and asserts at least what it did before:
    - `packages/core/test/markdown.test.ts`:
      - the hostile test's `## ` heading list becomes `["## 🛡️ pharn-ci · ❌ Fail"]`;
      - the "says what agent setup is missing" test expects `### 🤖 Agent setup (no files)` as its section line.
    - `packages/core/test/ac-format-golden.test.ts` AC-13: `renderMarkdown(cobertura)` equals `renderMarkdown(lcov)`
      on every line except the last non-empty one. Those two lines are asserted exactly:
      `<sub>pharn-ci 0.1.0 · report schema v1 · coverage format cobertura</sub>` and `… lcov</sub>`.
    - `packages/core/test/ac-setup-render.test.ts`:
      - AC-11: the section is found by the new heading. Between the summary line and the table header there are only
        blank lines, `<details>` and `<summary>Agent setup files (8)</summary>`.
      - AC-13: the title becomes "collapses the table in a details block at every size and keeps the 50-row limit".
        At 25 files the table is now inside `<details>`, with a `<summary>` line naming `25`. The 26-file and 60-file
        assertions stay as they are.
    - `packages/core/test/ac-setup-expect-render.test.ts`: the section start is the line starting
      `### 🤖 Agent setup (`.
    - `packages/core/test/ac-markdown-order-cap.test.ts`: Messages and Agent setup are found by the lines starting
      `### 💬 Messages (` and `### 🤖 Agent setup (`. Both are still asserted present, and in that order.
    - `packages/core/test/exclusions-report.test.ts` AC-15: the `indexOf` anchors become `### 🧪 Diff coverage` and
      `### 🤖 Agent setup (`. Today `"### Diff coverage"` would silently return -1. Add an assertion that both anchors
      are found, so the order checks cannot pass on -1.
    - `packages/core/test/ac-comment-look-header.test.ts` (pr-comment-redesign-2 AC-1):
      - the first line becomes `## 🛡️ pharn-ci · ❌ Fail`;
      - the section anchor becomes `### 🧪 Diff coverage`;
      - the block must show `Fail` (was `fail`), `71.43%`, `80%` and `8 files`.
    - `packages/core/test/ac-comment-look-summary.test.ts` (AC-2): the heading regex becomes
      `/^## 🛡️ pharn-ci · \S+ (Pass|Warn|Fail)$/` and the section anchor changes. The five shown values stay.
    - `packages/core/test/ac-comment-look-collapse.test.ts` (AC-3):
      - the title says the file tables are collapsed at 30 and at 25 files;
      - `detailsBlocks` recognizes `<details>` and `<details open>`;
      - sections are found by the new headings;
      - the heading becomes `## 🛡️ pharn-ci · ❌ Fail`;
      - at 25 files, both tables now sit inside a block whose `<summary>` names `25`;
      - the order, the 30-file `<summary>` counts and "no message line inside `<details>`" stay.
    - `packages/core/test/ac-comment-look-footer.test.ts` (AC-4):
      - heading regex as above, section anchor changed;
      - above Diff coverage, the first non-empty line after the heading is the overview sentence (starts
        `Diff coverage ` or `This change `, ends `found.`), and every later line is a table row;
      - the footer and no-image assertions stay.
    - `packages/core/test/ac-comment-look-hostile.test.ts` (AC-5): the section anchors change (Messages through
      Agent setup are found by their line prefixes). The block above Diff coverage, overview sentence included, still
      equals the benign rendering's.
    - `packages/core/test/ac-comment-look-data.test.ts` (AC-7): the section anchor becomes `### 🧪 Diff coverage`.
    - `packages/action/test/ac-comment-look-fit.test.ts` (AC-6): the heading constant becomes
      `## 🛡️ pharn-ci · ❌ Fail` and the three section anchors change. The summary block it checks now includes the
      overview sentence.
    - `packages/action/test/ac-comment-fit.test.ts` AC-2 and `packages/action/test/ac-summary-fit.test.ts` AC-3: the
      `pharn-ci: ${verdict}` substring becomes the full heading, built with a local fixed map
      (`{ pass: "✅ Pass", warn: "⚠️ Warn", fail: "❌ Fail" }`): `` `## 🛡️ pharn-ci · ${HEADING[verdict]}` ``.
    - `packages/action/test/run.test.ts`: the body and summary assertions that match `pharn-ci: fail`,
      `pharn-ci: pass` or `pharn-ci: ${verdict}` (lines 18, 20, 139, 159, 194, 274 today) match the new heading the
      same way. The prefix checks keep `${COMMENT_MARKER}\n${SCOPE}\n` in front. The fake earlier comments (the
      `forged` body, the sticky-comment fixtures) are someone else's old text and stay as they are.
    - `packages/cli/test/main.test.ts`: `## ✅ pharn-ci: pass` becomes `## 🛡️ pharn-ci · ✅ Pass`.
11. **Not touched, checked this run.** `ac-paths-hostile.test.ts` compares headings between two renders,
    `exclusions-golden.test.ts` matches the unchanged excluded block, and the byte-for-byte golden comparisons in
    `ac-agnostic-report`, `ac-globs-golden`, `ac-stream-check`, `ac-test-files-deleted-render` and
    `ac-setup-expect-render` read the regenerated files. All of them pass once the goldens are regenerated.

### Docs and bundle

12. `README.md` "Example PR comment": replace the quoted block with the regenerated `fixtures/golden/report.md`, each line
    prefixed `> ` (`>` alone for a blank line). Nothing else in the README changes.
13. `CHANGELOG.md`, Unreleased › Changed: replace the line pr-comment-redesign-2 added. It is unreleased, and it now
    says "headings … are unchanged" and "more than 25 files", which this change makes false. The new line says the PR
    comment, job summary and CLI markdown:
    - open with a branded header (verdict heading, a one-line overview, a summary table);
    - use emoji section headings with counts;
    - collapse the changed-files and agent-setup tables in `<details>` blocks, the changed-files one open when diff
      coverage is below the threshold;
    - end with a footer naming the tool version, report schema and coverage format;
    - keep report data and message text unchanged.
14. `pnpm build` (AGENTS.md rule 7). Of what it writes, only `packages/action/dist/index.js` is tracked. Then run
    `pnpm test` and `pnpm lint` and get them green. Run `pnpm format` only on files in `## Files`, named one by one.

## Applied lessons

- none: the project has no `memory-bank/lessons-learned.md` yet (`check-lessons-index.mjs --verdict` printed
  `NO_CANON` this run), so there are no promoted lessons to apply.

## Steps

- In `markdown.ts`:
  - add `VERDICT_LABEL`, `BRAND` and `COVERAGE_FORMAT_LABEL`, and remove `COLLAPSE_ABOVE`;
  - render the new heading, `overviewLine()` and the summary table with the capitalized verdict cell;
  - add the counted emoji section headings;
  - always wrap both file tables in `<details>`, the diff one open on `DIFF_COVERAGE_BELOW_THRESHOLD`;
  - add the `---` footer with the optional coverage format.
- Correct the existing tests listed in step 10, `ac-format-golden.test.ts` AC-13 first.
- Regenerate the five `report.md` goldens and `markdown.test.ts.snap` with the scoped `vitest run -u` (step 8). Review
  the diff and confirm no `report.json` changed.
- Recompute and replace the four markdown hash constants, each with a one-sentence reason (step 9).
- Update the README example and replace the CHANGELOG line.
- Run `pnpm build`, then `pnpm test` and `pnpm lint`.

## Files

- `packages/core/src/render/markdown.ts` — branded heading, overview sentence, capitalized verdict cell, counted emoji section headings, both file tables always in `<details>` (diff open on `DIFF_COVERAGE_BELOW_THRESHOLD`), `---` footer with coverage format
- `fixtures/golden/report.md` — regenerated: new look
- `fixtures/golden-cobertura/report.md` — regenerated: new look, footer names cobertura
- `fixtures/golden-exclusions/report.md` — regenerated: new look
- `fixtures/golden-multi/report.md` — regenerated: new look
- `fixtures/coverage-paths/package-relative/report.md` — regenerated: new look
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots in the new look
- `packages/core/test/markdown.test.ts` — the heading and agent setup section line corrected to the new layout
- `packages/core/test/ac-format-golden.test.ts` — AC-13 render equality corrected to all lines but the footer, with both footers asserted; `GOLDEN_MD_SHA256` recomputed with a reason
- `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256` recomputed with a reason; JSON hashes and assertions unchanged
- `packages/core/test/ac-setup-render.test.ts` — AC-11 section and between-lines corrected; AC-13 corrected to collapse at every size
- `packages/core/test/ac-setup-expect-render.test.ts` — agent setup section found by its new heading
- `packages/core/test/ac-markdown-order-cap.test.ts` — Messages and Agent setup found by their new headings
- `packages/core/test/exclusions-report.test.ts` — section anchors corrected and asserted found
- `packages/core/test/ac-comment-look-header.test.ts` — heading, section anchor and `Fail` corrected
- `packages/core/test/ac-comment-look-summary.test.ts` — heading regex and section anchor corrected
- `packages/core/test/ac-comment-look-collapse.test.ts` — collapse at 25 too, `<details open>` recognized, new headings
- `packages/core/test/ac-comment-look-footer.test.ts` — heading regex, section anchor, overview line above the table
- `packages/core/test/ac-comment-look-hostile.test.ts` — section anchors corrected
- `packages/core/test/ac-comment-look-data.test.ts` — section anchor corrected
- `packages/action/test/ac-comment-look-fit.test.ts` — heading constant and section anchors corrected
- `packages/action/test/ac-comment-fit.test.ts` — verdict substring corrected to the full new heading
- `packages/action/test/ac-summary-fit.test.ts` — verdict substring corrected to the full new heading
- `packages/action/test/run.test.ts` — body and summary heading assertions corrected to the new heading
- `packages/cli/test/main.test.ts` — the exit-0 test's heading corrected to the new heading
- `README.md` — "Example PR comment" replaced with the new golden render, quoted
- `CHANGELOG.md` — the Unreleased › Changed comment-look line replaced with one describing the new look
- `packages/action/dist/index.js` — rebuilt bundle (core changed)

### Explicitly not touched

- `packages/core/src/render/logo.ts` — the logo slot stays empty and isolated; reused as is
- `schema/report.v1.json` — no schema change (SPEC Out of scope)
- `packages/core/src/report.ts` — report data, message codes and text unchanged
- `packages/core/src/coverage/types.ts` — `CoverageFormat` is only imported as a type
- `packages/action/src/run.ts` — `fitMarkdown`, marker, scope line, limits and fallback rows unchanged; the header block sits above every table, so every fallback re-render keeps it
- `packages/cli/src/main.ts` — prints `renderMarkdown` output as today
- `fixtures/golden/report.json` — report data unchanged; AC-7 compares against it as committed
- `fixtures/golden-cobertura/report.json` — as above
- `fixtures/golden-exclusions/report.json` — as above
- `fixtures/golden-multi/report.json` — as above
- `fixtures/coverage-paths/package-relative/report.json` — as above
- `fixtures/render/hostile-paths.json` — AC-6 input, read only
- `docs/assets/pharn-ci-logo.svg` — not the user's logo; never linked or embedded
- `docs/THREAT-MODEL.md` — no new parsing, write target or API call; B1 and B3 stay true and their cited test titles are kept
- `packages/action/test/ac-sticky-comment-scope.test.ts` — its old-heading bodies are earlier comments the Action finds by marker and scope, not by heading
- `packages/action/test/ac-sticky-comment-legacy.test.ts` — as above

## Acceptance mapping

- AC-1 → steps 2 and 4. With the empty logo slot, the first three non-empty lines are the heading, the overview
  sentence and the table header. The value row is `| ❌ Fail | 71.43% (threshold 80%) | 8 files |`, and all of it sits
  above `### 🧪 Diff coverage`.
- AC-2 → step 2. `VERDICT_LABEL` gives the `Pass` and `Warn` headings, and the `overviewLine` templates give each
  sentence start and end. A `warn` report comes from `buildReport` with `changedConfigPaths` (a warn message).
- AC-3 → step 3. The counted headings, in the old order. No other `##`/`###` line is added. Messages are omitted at 0.
- AC-4 → steps 4 and 5. `<details open>` exactly with `DIFF_COVERAGE_BELOW_THRESHOLD`, a `<summary>` with the total
  count, the headline, `Agent setup:` and `Missing:` lines outside, and messages in their own section, outside any block.
- AC-5 → step 6. A blank line, `---`, then the `<sub>` line, with the coverage format only when `diffCoverage.format` is
  set. Nothing adds an image or a URL.
- AC-6 → steps 2 to 6. Every new string is fixed or enum- or count-derived, and paths and messages keep `code()` and
  `inlineText()`. The new `<details>` lines are whole lines outside tables, so table rows keep their cell counts.
- AC-7 → no report-data change. `report.ts` and the schema are untouched, and message and hint lines are rendered by the
  unchanged `renderMessage`.
- AC-8 → `fitMarkdown` is unchanged. The header block and messages come before the agent setup table, the first thing
  `FALLBACK_ROWS` shrinks.
- AC-9 → the CLI prints `renderMarkdown` output, so a passing run shows `## 🛡️ pharn-ci · ✅ Pass` and
  `### 🧪 Diff coverage`.

## Risks & open questions

- **Another feature's AC tests are edited.**
  - The six `ac-comment-look-*` files, `ac-setup-render`, `ac-setup-expect-render`, `ac-markdown-order-cap`,
    `ac-format-golden`, `ac-paths-partial`, `ac-comment-fit` and `ac-summary-fit` are earlier features' AC tests. The
    SPEC asks for them to be corrected to the new layout, as F-32, F-16, F-11 and pr-comment-redesign-2 did with the
    hash constants.
  - Their `AC-<n>:` title prefixes stay. Their features' `AC-TESTS.lock.json` files are not this feature's gate.
  - A reviewer should check that each correction asserts at least as much as before. The exclusions-report anchors
    gain a found-check; ac-format-golden AC-13 gains exact footers.
- **CHANGELOG line replaced, not only added.** The SPEC says "a CHANGELOG line under Unreleased". The existing unreleased
  line becomes false ("headings … unchanged", "more than 25 files"), so the plan replaces it. A reviewer may prefer to
  keep both lines.
- **Golden and Cobertura goldens now differ.** Before, their markdown was identical, which ac-format-golden AC-13 and
  ac-paths-partial relied on. Both are corrected (steps 9 and 10).
- **Emoji bytes.** `🛡️` and `⚠️` carry U+FE0F. Tests and goldens must use the same code points as `markdown.ts`, so
  copy them from one source.
- **`<details open>` in the README blockquote.** GitHub renders HTML blocks inside blockquotes. The README example is
  checked by review only (SPEC Assumptions).
