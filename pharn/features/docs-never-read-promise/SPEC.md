---
spec_id: docs-never-read-promise
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
---

## Intent

Two public documents promise something pharn-ci stopped doing in v0.4.0. The privacy disclosure (`SECURITY.md`,
Data handling table, the row on agent setup file paths and kinds) says agent setup files "are matched by path only and
never read", and the GitHub Marketplace listing text (`docs/MARKETPLACE.md`, Description) says pharn-ci lists these
files by kind "and never reads them". Since v0.4.0, every run with a local diff reads the machine-readable agent config
files at HEAD for check A7 (committed secrets), with no policy involved, and under an org policy it also reads the agent
settings and MCP JSON (P02–P06) and the Markdown instruction files (P07). `README.md`, `docs/LIMITS.md` and
`docs/THREAT-MODEL.md` (rows C4–C6) already say so correctly. A security reviewer or a buyer reading the disclosure or
the listing is told the opposite of what the product does: a broken promise, reported as review BLOCKER 3 (A7-F1). The
user wants the two documents to say what pharn-ci actually reads and where that text goes, and a test that keeps the
"never read" promise from coming back.

## Scope

**In scope:**

- `SECURITY.md`: rewrite the agent setup sentence of the Data handling row so it says the files are matched by path for
  the inventory, check A7 reads the machine-readable kinds at HEAD for committed secrets, and policy mode reads the
  agent settings, MCP and instruction files.
- `SECURITY.md`: add a Data handling row for the text of the agent config, settings and instruction files, saying where
  it goes (it stays in the job and never reaches the PR comment, the job summary, the step log, `report.json` or the
  upload), with a pointer to `docs/THREAT-MODEL.md` rows C4–C6.
- `docs/MARKETPLACE.md`: drop "and never reads them" from the inventory sentence of the Description.
- Doc tests that fail if either file again says the files are never read, and that check the new wording.
- A `CHANGELOG.md` line under Unreleased.

**Out of scope (non-goals):**

- Any change to what pharn-ci reads or when: no change under `packages/*/src`, `packages/action/dist`, `action.yml` or
  `schema/`.
- Editing the live GitHub Marketplace listing; the maintainer copies the text from `docs/MARKETPLACE.md`.
- `README.md`, `docs/LIMITS.md` and `docs/THREAT-MODEL.md`, which already describe the reads correctly.
- Other `SECURITY.md` discrepancies, such as the Data handling table having no row for the pharn.dev upload that the
  Security surface section describes; that is a separate finding.

## Acceptance Criteria

- **AC-1** Given the repository's `SECURITY.md` When its text is read Then it contains no "never read" phrase in any
  letter case (which also covers "never reads")
  - verify: unit
- **AC-2** Given the `SECURITY.md` Data handling table When the row whose Data cell names agent setup file paths and
  kinds is read Then its text says the files are matched by path for the inventory, names check A7 as reading the
  machine-readable kinds at HEAD for committed secrets, and names policy mode as reading the agent settings, MCP and
  instruction files
  - verify: unit
- **AC-3** Given the `SECURITY.md` Data handling table When its rows are read Then one row's Data cell names the text
  of the agent config, settings and instruction files, and that row's text says the text never reaches the PR comment,
  the job summary, the step log, `report.json` or the upload, and names THREAT-MODEL rows C4, C5 and C6
  - verify: unit
- **AC-4** Given the repository's `docs/MARKETPLACE.md` When its text is read Then it contains no "never read" phrase
  in any letter case, and its Description still says pharn-ci lists the agent setup files by kind
  - verify: unit

## Constraints

- The wording must agree with `README.md`, `docs/LIMITS.md` and `docs/THREAT-MODEL.md` rows C4–C6; where they differ,
  those documents describe the shipped behaviour.
- `docs/MARKETPLACE.md` keeps the shape the existing release-docs tests check: name, one-line description equal to
  `action.yml`, exactly three Description paragraphs, two categories, and the quick start.
- No existing test is weakened, skipped or deleted (AGENTS.md rule 4).
- `CHANGELOG.md` gets one line under Unreleased for this user-visible change (AGENTS.md, Repo protection).
- Documentation only: no change to the report schema, message codes, inputs or outputs.

## Assumptions

- The line numbers the review gave have drifted (the correct README passages are now near lines 416 and 485, the
  LIMITS passage near lines 835–841); the content they point at is unchanged and is what counts.
- The tests extend the existing doc tests the review names (`packages/core/test/ac-secrets-docs.test.ts` and
  `packages/core/test/ac-release-docs.test.ts`); the plan decides the exact place.
- "The upload" means the optional upload of the redacted `report.json` and `meta.json` to pharn.dev that the
  `SECURITY.md` Security surface section describes; the agent file text does not reach it because it never reaches
  `report.json`.
- No `docs/THREAT-MODEL.md` change is needed: the change adds no parsing, no write location and no GitHub API call.
- The project's test runner is vitest through the root `package.json` `test` script, so the criteria can run at unit
  level.
