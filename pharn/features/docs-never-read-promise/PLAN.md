---
spec_id: docs-never-read-promise
spec_content_hash: "21c174923c17d531c770dd268f8d6f00f1c1c0de7666d60e3358baf946503ef1"
applied_lessons: none
---

## Approach

> ADVISORY: model work. Documentation only. Nothing under `packages/*/src`, `packages/action/dist`, `action.yml`
> or `schema/` changes.

Two public documents still carry the "never read" promise that v0.4.0 broke:

- `SECURITY.md` line 75, the Data handling row whose Data cell lists "agent setup file paths and kinds". Its
  "Where it goes" cell ends with "Agent setup files are matched by path only and never read."
- `docs/MARKETPLACE.md` line 17, the second Description paragraph. It ends with "It lists these files by kind and
  never reads them."

`README.md`, `docs/LIMITS.md` (the "It is an inventory, not a review" bullet near line 863) and
`docs/THREAT-MODEL.md` rows C4–C6 describe the shipped behaviour correctly, and the new wording follows them:

- The inventory matches files by path and reads none of them.
- Check A7 reads the committed text at `HEAD` (`git cat-file`) of the machine-readable kinds and looks for committed
  secrets. It needs no policy. The Action reads only when the diff comes from local git, so it reads nothing in
  PR-number mode or with a compare-API diff (C4).
- Under an org policy, P02–P06 read the agent settings and MCP JSON (C5) and P07 reads the Markdown instruction files
  (C6).
- That text stays in memory in the job. It is never written to the comment, the summary, the log, an output or the
  report, and it is never sent out of the job. A message carries only a shape id or rule id, the path and a line
  number (C4).

Edit the two docs to say this, add one CHANGELOG line, and add one new doc-test file (mapped in AC-TESTS.md, not
listed here) that pins the new wording and keeps "never read" from coming back.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` returned `NO_CANON`, so this project has no promoted lessons in
  `pharn/memory-bank/lessons-learned.md` to apply.

## Steps

1. **`SECURITY.md`, existing row (AC-1, AC-2).** Leave the Data cell of the "…agent setup file paths and kinds, the
   verdict" row exactly as it is: AC-2's test finds the row by that cell. In its "Where it goes" cell, replace "Agent
   setup files are matched by path only and never read." with two sentences along these lines:
   "The inventory matches agent setup files by path and does not read them. Check A7 reads the committed text of
   the machine-readable kinds at `HEAD` and looks for committed secrets, and policy mode reads the agent settings,
   MCP and instruction files (next row)." The phrases "matched by path", "inventory", "A7", "machine-readable",
   "`HEAD`", "secrets", "policy mode", "settings", "MCP" and "instruction" must all appear, and no "never read" may
   appear in any letter case.
2. **`SECURITY.md`, new row (AC-1, AC-3).** Insert one row directly after the row from step 1. Its Data cell is
   something like "Text of the agent config, settings and instruction files (check A7; policy rules P02–P07)". Its
   "Where it goes" cell says the text is read locally from committed git objects at `HEAD` and held in memory in the
   job. It names when each read happens: A7 only when the diff comes from local git, P02–P07 only under an org policy.
   It says the text never reaches the PR comment, the job summary, the step log, `report.json` or the upload to
   pharn.dev, that a message holds only a shape or rule id, the path and a line number, and that the details are in
   `docs/THREAT-MODEL.md` rows C4, C5 and C6. Its Retention cell is "Not stored." Spell the sentence without the
   phrase "never read" (for example "never reaches" or "is never written to") so AC-1 holds. Keep the table's three
   columns, and use no `|` inside a cell.
3. **`docs/MARKETPLACE.md` (AC-4).** In the second Description paragraph, change "It lists these files by kind and
   never reads them." to "It lists these files by kind." Change nothing else: the three Description paragraphs, the
   one-line description that equals `action.yml`, the two categories and the quick start pin are all checked by
   `ac-release-docs.test.ts`, `ac-upload-docs.test.ts` and `ac-release040-doc-pins.test.ts`.
4. **`CHANGELOG.md`.** Add one bullet under `## [Unreleased]` → `### Security`. Use no new `###` heading:
   `ac-release030-changelog-shape.test.ts` requires the live Unreleased headings to be exactly Added, Changed and
   Security. The bullet says something like: "`SECURITY.md` and the Marketplace listing text no longer say agent setup
   files are never read. The Data handling table now says check A7 reads the machine-readable agent config files at
   `HEAD` for committed secrets and policy mode reads the settings, MCP and instruction files, and a new row says
   where that text goes (it stays in the job). Documentation only." Do not start it with any prefix that another
   test filters on, such as "- Org policy rule P07 reads the committed text…".
5. **Run the gates.** Run `pnpm vitest run` on the new AC test file and on the existing doc tests that read these
   files (`ac-release-docs`, `ac-upload-docs`, `ac-release040-doc-pins`, `ac-secrets-docs`,
   `ac-release030-changelog-shape`, `ac-ti03b1-docs`), then run `pnpm lint`. Neither markdown file is part of the
   build, so `packages/action/dist` stays unchanged.

## Files

- `SECURITY.md` — reword the agent setup sentence of the Data handling row, and add one row for the text of the agent config, settings and instruction files and where it goes
- `docs/MARKETPLACE.md` — drop "and never reads them" from the inventory sentence of the Description
- `CHANGELOG.md` — one Security bullet under Unreleased for the corrected disclosure

### Explicitly not touched

- `README.md` — already correct (Secrets in agent configs, Policy mode rules)
- `docs/LIMITS.md` — already correct (the "It is an inventory, not a review" bullet)
- `docs/THREAT-MODEL.md` — already correct (rows C4–C6); the change adds no parsing, write location or API call
- `packages/core/test/ac-secrets-docs.test.ts` — existing test, reused unchanged (AGENTS.md rule 4)
- `packages/core/test/ac-release-docs.test.ts` — existing test, reused unchanged; it keeps checking the listing's shape
- `packages/action/dist/index.js` — no code change, so no rebuild
- `action.yml` — out of scope
- `schema/report.v1.json` — out of scope

## Acceptance mapping

- AC-1 (no "never read" in `SECURITY.md`, any case) → step 1 removes the only occurrence (line 75), and step 2's new
  row is written without the phrase.
- AC-2 (the paths-and-kinds row says matched by path for the inventory, A7 reads the machine-readable kinds at HEAD
  for committed secrets, and policy mode reads the settings, MCP and instruction files) → step 1. The Data cell is
  unchanged, so the test can find the row.
- AC-3 (a row for the text of the agent config, settings and instruction files that never reaches the comment,
  summary, step log, `report.json` or upload, and names C4, C5 and C6) → step 2.
- AC-4 (no "never read" in `docs/MARKETPLACE.md`, and the Description still says it lists the files by kind) →
  step 3.

## Risks & open questions

- **Test placement differs from the SPEC's assumption.** The SPEC assumes the tests extend
  `ac-secrets-docs.test.ts` and `ac-release-docs.test.ts`, and lets the plan decide. The plan maps them to one new
  file instead (see AC-TESTS.md), for two reasons. `/pharn-test` rewrites the file it is mapped to. And
  `/pharn-regress` would treat that file as the feature's own and drop it from the regression comparison. A mapped
  existing test would therefore be rewritten and its old assertions taken out of regression, against AGENTS.md
  rule 4. The two existing tests stay unchanged and keep running.
- **Wording drift.** The tests check for key phrases, not exact sentences, so a later rewording that keeps the facts
  still passes. A rewording that drops "A7", "machine-readable" or the C4–C6 pointer fails on purpose.
- **Marketplace sentence is minimal.** The SPEC only asks to drop "and never reads them". The listing then says
  nothing about A7 or policy reads, and the README and `SECURITY.md` cover those. Adding more to the listing would go
  beyond the approved scope.
- **The table has no upload row** (the Security surface section describes the upload, the Data handling table
  doesn't). This is a separate finding and out of scope. The new row still names "the upload" as a place the text
  never reaches, as AC-3 requires.
- **Unrelated working-tree changes.** `packages/core/src/render/markdown.ts`, four golden `report.md` files and
  `packages/action/dist/index.js` already have changes that are not part of this feature. The build must not touch or
  commit them as part of this feature.
