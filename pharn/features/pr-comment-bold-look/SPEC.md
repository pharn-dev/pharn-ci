---
spec_id: pr-comment-bold-look
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

The pharn-ci report in a pull request comment still looks plain next to the reports that review bots such
as CodeRabbit and Greptile post. A first step added a summary table under the verdict heading and a
compact footer; the user now wants a bolder, fuller layout in the same style: a branded header block that
reads at a glance, emoji section headings that carry counts, the long per-file detail collapsed by
default, and a richer footer. The header must stay ready to carry the pharn logo, which the user will
supply later; until then it carries no image. The report data does not change: only how
`renderMarkdown()` presents it, which is the same markdown the sticky PR comment, the job summary and the
CLI show. Tests that pin today's headings and layout are corrected to the new intended layout.

## Scope

**In scope:**

- A branded header block at the top of the rendered markdown: the existing empty logo slot, then one
  heading that carries the brand and the verdict (`## 🛡️ pharn-ci · <verdict icon> <verdict label>`),
  then a one-line overview sentence built only from fixed words and numbers or counts from the report,
  then the existing summary table, whose verdict cell shows the same icon and label.
- Emoji section headings with counts: `### 🧪 Diff coverage`, `### 💬 Messages (<N>)` and
  `### 🤖 Agent setup (<N files | 1 file | no files>)`, in that order, as today.
- Per-file detail collapsed: the diff coverage file table and the agent setup file table always sit inside
  a `<details>` block whose `<summary>` names what it holds and how many; the diff coverage table's block
  is open exactly when the report carries a `DIFF_COVERAGE_BELOW_THRESHOLD` message. The coverage headline
  line, the `Agent setup: N files · <tools>` line and the `Missing:` line stay visible outside the blocks.
  The excluded-files block stays as it is today. Messages are never collapsed.
- A richer footer: a thematic break (`---`) set apart by empty lines, then one `<sub>` line naming
  pharn-ci with the tool version, the report schema version and, when the report records it, the coverage
  format.
- Golden files and snapshots regenerated because the output changes on purpose; hash-pinned golden
  constants recomputed with the reason written next to them; existing tests that pin the old headings or
  layout corrected to the new layout (never weakened); the README example PR comment updated; a CHANGELOG
  line under Unreleased; `packages/action/dist` rebuilt.

**Out of scope (non-goals):**

- Shipping, embedding or linking any logo image now, including `docs/assets/pharn-ci-logo.svg`, and any
  remote image or URL in the rendered markdown.
- Any change to `schema/report.v1.json`, to Report v1 data or `report.json` output, or to message codes,
  message text or hints.
- A confidence score, an AI-written or free-text summary, per-file prose, diagrams, or links to commits,
  runs or the repository.
- Changes to the sticky comment marker, its scope line, how the Action finds its comment, the comment and
  summary size limits, or the fallback row counts.
- A config key, Action input or CLI flag to choose between the old and the new look.
- New verdict semantics or exit codes.

## Acceptance Criteria

- **AC-1** Given the report built from the `fixtures/golden` inputs (verdict `fail`, 71.43% of changed
  lines covered, 5 of 7, threshold 80%, 8 agent setup files, 2 messages, coverage format `lcov`) When
  `renderMarkdown()` renders it Then its first three non-empty lines are, in order,
  `## 🛡️ pharn-ci · ❌ Fail`, then
  `Diff coverage of this change is 71.43% against a threshold of 80%; 8 agent setup files found.`, then
  `| Verdict | Diff coverage | Agent setup |`, and the summary table's value row is
  `| ❌ Fail | 71.43% (threshold 80%) | 8 files |`, all before the `### 🧪 Diff coverage` line
  - verify: unit
- **AC-2** Given reports that validate against `schema/report.v1.json` with verdict `pass`, verdict `warn`,
  diff coverage not computed (`diffCoverage` null), no coverable changed lines (`percent` null), no
  threshold (`threshold` null), 0 agent setup files and 1 agent setup file When `renderMarkdown()` renders
  each Then the heading is `## 🛡️ pharn-ci · ✅ Pass` and `## 🛡️ pharn-ci · ⚠️ Warn` for the first two,
  and the overview sentence starts `Diff coverage was not computed;`,
  starts `This change adds no coverable lines;`, contains `, with no threshold set;`, ends
  `; no agent setup files found.` and ends `; 1 agent setup file found.` respectively
  - verify: unit
- **AC-3** Given the golden report of AC-1, a valid report with no messages, and valid reports with 0 and
  with 1 agent setup file When `renderMarkdown()` renders each Then the golden rendering contains the lines
  `### 🧪 Diff coverage`, `### 💬 Messages (2)` and `### 🤖 Agent setup (8 files)` in that order and no
  other `##` or `###` heading besides the header heading; the report with no messages has no line starting
  `### 💬 Messages`; and the agent setup headings read `### 🤖 Agent setup (no files)` and
  `### 🤖 Agent setup (1 file)`
  - verify: unit
- **AC-4** Given the golden report of AC-1 and a valid passing report (no `DIFF_COVERAGE_BELOW_THRESHOLD`
  message) with 3 diff coverage files and 2 agent setup files When `renderMarkdown()` renders each Then in
  the golden rendering the diff coverage table's header row sits inside a block opened by
  `<details open>` with `<summary>Changed files (3)</summary>`, and the agent setup table's header row sits
  inside a block opened by `<details>` (not open) with `<summary>Agent setup files (8)</summary>`; in the
  passing rendering the diff coverage table sits inside a block opened by `<details>` (not open) with
  `<summary>Changed files (3)</summary>`; and in both, the coverage headline line (the one containing
  `of changed lines covered`), the line starting `Agent setup: ` and every message line sit outside any
  `<details>` block
  - verify: unit
- **AC-5** Given the golden report of AC-1, a valid report with `diffCoverage` null, and a valid report
  whose diff coverage has no `format` field When `renderMarkdown()` renders each Then the last two
  non-empty lines are `---` and then a `<sub>` line, with an empty line right before the `---` line; that
  `<sub>` line is `<sub>pharn-ci 0.1.0 · report schema v1 · coverage format lcov</sub>` for the golden
  report and `<sub>pharn-ci 0.1.0 · report schema v1</sub>` for the other two (each built with tool
  version `0.1.0`); and none of the renderings of AC-1 to AC-5 contains `<img`, `![`, `http://` or
  `https://`
  - verify: unit
- **AC-6** Given the report built from `fixtures/render/hostile-paths.json` (paths and message text
  carrying markdown, HTML, line breaks, pipes, backticks and `@` mentions) When `renderMarkdown()` renders
  it Then no `<img` appears outside a code span, every table row has the same number of cells as its
  header row, every `<summary>` line and the heading, overview and footer lines contain no path or message
  text from the input, and no message line contains a live link (`](`), an unescaped markdown character,
  a live `@` mention, `://` or `www.`
  - verify: unit
- **AC-7** Given the `fixtures/golden` inputs When `check()` builds the report and `renderMarkdown()`
  renders it Then the report is deep-equal to `fixtures/golden/report.json` as committed before this
  increment and validates against `schema/report.v1.json`, and every message line and hint line of the
  rendering equals the corresponding line of `fixtures/golden/report.md` as committed before this
  increment
  - verify: unit
- **AC-8** Given a valid report whose full rendering is longer than the Action's 65,000-character comment
  limit because of its tables When the Action fits it into the sticky comment (`fitMarkdown` with the
  comment marker and scope line as prefix) Then the returned body is at most 65,000 characters, starts
  with the comment marker, the scope line and then `## 🛡️ pharn-ci · `, and still contains the overview
  sentence, the summary table's value row and every message line of the report
  - verify: integration
- **AC-9** Given the CLI fake dependencies with coverage meeting the threshold (as in the existing CLI
  test that expects exit 0) When `main()` runs `check` with markdown output Then it exits 0 and its
  output contains `## 🛡️ pharn-ci · ✅ Pass` and `### 🧪 Diff coverage`
  - verify: integration

## Constraints

- `schema/report.v1.json` is unchanged and `report.json` output is unchanged; the renderer only presents
  existing report fields. Message codes, message text and hints are stable (AGENTS.md rule 2).
- `packages/core/src` stays pure: no I/O, no clock, no randomness, no network (AGENTS.md rule 1).
- Every input-derived string the renderer shows goes through the existing escaping (`code()` for paths,
  `inlineText()` for message text). The heading, overview sentence, summary table, section headings,
  `<summary>` lines and footer carry only fixed words, icons, numbers, counts and values from fixed enums
  (verdict, coverage format) or the tool version.
- The Action keeps finding its sticky comment by the marker and scope line, never by the heading text,
  and `fitMarkdown` keeps the header block, the summary and every message when it drops table rows:
  messages stay before the agent setup inventory.
- The same markdown serves the PR comment, the job summary and the CLI; it uses only GitHub-flavored
  markdown and the HTML GitHub renders there (`<details>`, `<details open>`, `<summary>`, `<sub>`).
- No new dependency, no network call, no telemetry (AGENTS.md rules 5 and 6).
- Golden files change only because of this intentional output change; existing tests are corrected to the
  new layout and never weakened; reports produced in tests are validated with `expectValidReport`
  (AGENTS.md rules 3 and 4).
- `packages/action/dist` is rebuilt and committed, since core changes (AGENTS.md rule 7).

## Assumptions

- The verdict label in the heading and the summary table is a fixed map: `pass` → `Pass`, `warn` → `Warn`,
  `fail` → `Fail`; the brand mark is the fixed emoji `🛡️`. The lowercase verdict stays the value in
  `report.json` and in the Action's `verdict` output.
- The overview sentence uses fixed templates: `Diff coverage of this change is X% against a threshold of
  Y%`, `Diff coverage of this change is X%, with no threshold set`, `Diff coverage was not computed` or
  `This change adds no coverable lines`, then `; ` and `N agent setup files found.`,
  `1 agent setup file found.` or `no agent setup files found.`
- "Open on a failing verdict" is read as open exactly when the report carries a
  `DIFF_COVERAGE_BELOW_THRESHOLD` message, because a `fail` verdict can come from causes the file table
  does not explain; the hint for that message ("listed in the table above") then points at an open table.
- The per-file tables are collapsed at every size; the earlier 25-file threshold no longer decides
  collapsing. Tests that asserted no `<details>` at 25 files or fewer are corrected to this rule.
- The excluded-files block keeps its exact text (`<details><summary>Excluded: N files</summary>`) and the
  `Agent setup: N files · <tools>` and `Missing:` lines keep theirs, since they already read well and
  other tests match them.
- The Messages section is still omitted when there are no messages, so `Messages (0)` never appears.
- The footer's coverage format comes from the optional `diffCoverage.format` field; Report v1 records no
  base or head ref or commit, so the footer cannot show one.
- The CodeRabbit and Greptile traits come from the orchestrator's notes on their public docs, unverified;
  none of their text or branding is copied.
- The logo slot stays empty and isolated in one place in the renderer; that is checked by review of the
  PLAN and code, not by a criterion, since no public output shows it while it is empty.
- The README example, the CHANGELOG line and the rebuilt dist are checked by review and by CI's dist check,
  not by acceptance criteria.
- `package.json` has a `test` script (`vitest run`), so PHARN's gate discovery finds the runner; no
  criterion needs an end-to-end runner.
