---
spec_id: pr-comment-redesign-2
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

The pharn-ci report that lands in a pull request looks plain next to the reports that review bots such as
CodeRabbit and Greptile post. Today the sticky comment (and the same markdown in the job summary and the
CLI output) is a bare verdict heading followed by a diff coverage table, a message list and an agent setup
table, with nothing that reads at a glance. The user wants a better look modelled on those reports: a
branded header at the top, a one-glance summary of the result, the existing detail sections kept but
tidier and collapsed where they are long, and a compact footer. The header must be ready to carry the
pharn logo, which the user will supply at the end; until then it carries no image. The report data does
not change; only how `renderMarkdown()` presents it.

## Scope

**In scope:**

- A branded header at the top of the rendered markdown, naming pharn-ci and showing the verdict with its
  icon.
- One isolated place in the renderer that produces the header's logo markup. It produces no image in this
  increment, so adding the user's logo later is a change to that one place only.
- A one-glance summary block right below the header and before any detail section, showing the verdict,
  the diff coverage percent against the threshold, and the number of agent setup files found.
- The existing detail sections (diff coverage table, excluded files, messages with their hints, agent setup
  inventory with its tool summary and missing-tools line) kept with their content and in their current
  order, so messages still come before the agent setup inventory.
- Long tables collapsed in a `<details>` block whose `<summary>` names the count: the diff coverage table
  when it lists more than 25 files (new), the agent setup table when it lists more than 25 files (as today)
  and the excluded-files list (as today). Messages are never collapsed.
- A compact footer as the last line, naming pharn-ci with the tool version and the report schema version.
- Golden files and snapshots regenerated because the output changes on purpose, existing tests whose
  layout assertions the redesign makes wrong corrected (not weakened), the README "Example PR comment"
  updated to the new look, a CHANGELOG line under Unreleased, and `packages/action/dist` rebuilt.

**Out of scope (non-goals):**

- Shipping, embedding or linking any logo image now, including the existing
  `docs/assets/pharn-ci-logo.svg`, and any remote image URL.
- Any change to `schema/report.v1.json`, to the Report v1 data, or to message codes, message text or hints.
- New verdict semantics, a score, an AI-written summary, per-file prose, or diagrams.
- Changes to the sticky comment marker, its scope line, the comment and summary size limits, the fallback
  row counts, or the JSON output format.
- A config key, Action input or CLI flag to choose between the old and the new look.

## Acceptance Criteria

- **AC-1** Given the report built from the `fixtures/golden` inputs (verdict `fail`, 71.43% of changed
  lines covered, 5 of 7, threshold 80%, 8 agent setup files) When `renderMarkdown()` renders it Then the
  first non-empty line of the returned text is `## ❌ pharn-ci: fail`, and between that line and the
  `### Diff coverage` line the text contains a summary block showing `fail`, `71.43%`, `80%` and `8 files`
  - verify: unit
- **AC-2** Given reports that validate against `schema/report.v1.json` whose diff coverage is not computed
  (`diffCoverage` null), has no coverable changed lines (`percent` null), has no threshold (`threshold`
  null), and that have 0 and 1 agent setup files When `renderMarkdown()` renders each Then the summary
  block above `### Diff coverage` shows `not computed`, `no coverable lines`, `no threshold`, `none` and
  `1 file` respectively
  - verify: unit
- **AC-3** Given a valid report with at least one message, 30 diff coverage files and 30 agent setup files
  When `renderMarkdown()` renders it Then the lines appear in this order: the verdict header, the summary
  block, `### Diff coverage`, `### Messages`, `### Agent setup`; the diff coverage table and the agent
  setup table each sit inside a `<details>` block whose `<summary>` contains `30`; no message line sits
  inside a `<details>` block; and the same report cut to 25 files of each kind renders neither table
  inside a `<details>` block
  - verify: unit
- **AC-4** Given the reports of AC-1, AC-2 and AC-3 When `renderMarkdown()` renders each Then the last
  non-empty line is a
  `<sub>` line containing `pharn-ci` followed by the report's tool version and `report schema v1`, and the
  text contains no `<img` tag, no markdown image (`![`), and no `http://` or `https://`
  - verify: unit
- **AC-5** Given the report built from `fixtures/render/hostile-paths.json` (paths and message text carrying
  markdown, HTML, line breaks, pipes, backticks and `@` mentions) When `renderMarkdown()` renders it Then
  no `<img` appears outside a code span, every table row has the same number of cells as its header row,
  and no message line contains a live link (`](`), an unescaped markdown character, a live `@` mention,
  `://` or `www.`
  - verify: unit
- **AC-6** Given a valid report whose full rendering is longer than the Action's 65,000-character comment
  limit because of its tables When the Action fits it into the sticky comment (`fitMarkdown` with the
  comment marker and scope line as prefix) Then the returned body is at most 65,000 characters, starts
  with the comment marker and the scope line followed by the verdict header, and still contains the
  summary block and every message line of the report
  - verify: integration
- **AC-7** Given the `fixtures/golden` inputs When `check()` builds the report Then the returned report is
  deep-equal to `fixtures/golden/report.json` as committed before this increment and validates against
  `schema/report.v1.json`
  - verify: unit

## Constraints

- `schema/report.v1.json` is unchanged; the renderer only presents existing report fields. Message codes
  and message text are stable API (AGENTS.md rule 2).
- `packages/core/src` stays pure: no I/O, no clock, no randomness, no network (AGENTS.md rule 1).
- Every input-derived string shown in a new place (summary block, `<summary>` lines) goes through the
  existing escaping (`code()` for paths, `inlineText()` for message text); otherwise only fixed strings and
  numbers from the report appear.
- The rendered text keeps fitting the Action's limits through `fitMarkdown`: messages stay before the agent
  setup inventory, so dropping rows never drops the reason for the verdict.
- The same markdown serves the PR comment, the job summary and the CLI; it uses only GitHub-flavored
  markdown and the HTML GitHub already renders there (`<details>`, `<summary>`, `<sub>`).
- No new dependency, no network call, no telemetry (AGENTS.md rules 5 and 6).
- Golden files change only because of this intentional output change, existing tests are corrected and
  never weakened, and reports produced in tests are validated with `expectValidReport` (AGENTS.md rules 3
  and 4).
- `packages/action/dist` is rebuilt and committed, since core changes (AGENTS.md rule 7).

## Assumptions

- The verdict heading keeps the exact text `## <icon> pharn-ci: <verdict>` and the section headings keep
  `### Diff coverage`, `### Messages` and `### Agent setup`, as does the `Agent setup: N files · …` line,
  so the CLI and Action tests and anyone matching the comment text keep working; the redesign adds around
  them rather than renaming them.
- The CodeRabbit and Greptile traits used here (branded header, glance block, tables, collapsed long lists,
  compact footer) come from the orchestrator's notes on their public docs, unverified; none of their text
  or branding is copied.
- The existing `docs/assets/pharn-ci-logo.svg` (used by the README) is not taken as the logo the user will
  supply, so the header stays text-only and the logo slot stays empty in this increment.
- "Collapsible where long" reuses the existing 25-file threshold for the diff coverage table too; messages
  are never collapsed because they carry the reason for the verdict.
- The summary block shows only the verdict, diff coverage against the threshold and the agent setup file
  count; message counts and missing expected tools stay in their own sections.
- The logo slot being one isolated place in the renderer is checked by review of the PLAN and the code,
  not by an acceptance criterion, since no public output shows it while it is empty.
- `package.json` has a `test` script (`vitest run`), so PHARN's gate discovery finds the runner; no
  criterion needs an end-to-end runner.
