---
spec_id: pr-comment-verdict-callout
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

The pharn-ci report that appears as a sticky pull request comment, a job summary and CLI markdown output
opens with the pharn logo, the verdict heading and a plain one-line overview sentence. The user compared it
with CodeRabbit's comment, which opens with a GitHub alert block that renders as a coloured, framed box, and
wants pharn-ci's verdict to stand out the same way: the overview is shown as a GitHub alert (callout) whose
type follows the verdict, `> [!CAUTION]` for fail, `> [!WARNING]` for warn and `> [!TIP]` for pass. The
detail sections stay collapsed in `<details>` exactly as they are now.

## Scope

**In scope:**

- The bare overview sentence line under the heading is replaced by a two-line GitHub alert block: a first
  line that is exactly `> [!CAUTION]`, `> [!WARNING]` or `> [!TIP]`, chosen strictly by the report's
  verdict (fail, warn, pass), and a second line `> **<Label>** · <overview sentence>`, where `<Label>` is
  the verdict label already used in the heading (`Fail`, `Warn`, `Pass`) and `<overview sentence>` is the
  sentence the renderer shows today, unchanged in wording and numbers. One empty line follows the block.
- The same callout in every rendering: PR comment, job summary and CLI markdown output.
- Everything else in the rendering kept as it is: the logo line, the heading, the summary table, the
  section headings, the `<details>` blocks (including which one is open), the messages section (never
  collapsed) and the footer.
- Existing tests that pin the bare overview sentence as its own line (among them the
  `ac-comment-bold-*` and `ac-header-logo-*` tests and the Action run tests) corrected to the new shape,
  never weakened; golden markdown files, the markdown snapshot and the hash-pinned golden constants
  regenerated because the output changes on purpose; the README example PR comment updated; a CHANGELOG
  line under Unreleased; `packages/action/dist` rebuilt.

**Out of scope (non-goals):**

- Any input-derived text inside the callout (paths, message text, config values, refs, tool names).
- Alert types other than the three named (`[!NOTE]`, `[!IMPORTANT]`), a second callout anywhere, or
  callouts around messages or sections.
- Changing the overview sentence's wording or numbers, the heading text, the logo line, the summary
  table, the section headings, the `<details>` blocks or the footer.
- Any change to `schema/report.v1.json`, to Report v1 data or `report.json` output, or to message codes,
  message text or hints.
- Changes to the sticky comment marker, its scope line, how the Action finds its comment, the size limits
  or the fallback row counts.
- A config key, Action input or CLI flag to turn the callout off or choose its type.

## Acceptance Criteria

- **AC-1** Given each committed golden markdown file `fixtures/golden/report.md`,
  `fixtures/golden-multi/report.md`, `fixtures/golden-cobertura/report.md`,
  `fixtures/golden-exclusions/report.md` and `fixtures/coverage-paths/package-relative/report.md` as it is
  before this increment, and the report the existing tests build from that file's inputs When
  `renderMarkdown()` renders that report Then the rendering equals the committed file with its fifth line
  (the bare overview sentence) replaced by two lines: `> [!CAUTION]` when the heading on its third line
  ends `❌ Fail` or `> [!TIP]` when it ends `✅ Pass`, followed by `> **Fail** · ` or `> **Pass** · `
  and that fifth line's text unchanged
  - verify: unit
- **AC-2** Given three reports that validate against `schema/report.v1.json` — verdict `pass` with diff
  coverage 100% against a threshold of 80% and 1 agent setup file, verdict `warn` with `diffCoverage` null
  and no agent setup files, and verdict `fail` with diff coverage of 2 of 4 lines and no threshold set and
  2 agent setup files When `renderMarkdown()` renders each Then the lines right after the heading and one
  empty line are, in order, `> [!TIP]` and
  `> **Pass** · Diff coverage of this change is 100% against a threshold of 80%; 1 agent setup file found.`;
  `> [!WARNING]` and `> **Warn** · Diff coverage was not computed; no agent setup files found.`; and
  `> [!CAUTION]` and
  `> **Fail** · Diff coverage of this change is 50%, with no threshold set; 2 agent setup files found.`;
  each followed by one empty line and then `| Verdict | Diff coverage | Agent setup |`
  - verify: unit
- **AC-3** Given a valid report whose diff coverage has no coverable lines (`percent` null) When
  `renderMarkdown()` renders it Then the callout's second line starts
  `> **<Label>** · This change adds no coverable lines; ` where `<Label>` is the report's verdict label
  - verify: unit
- **AC-4** Given the reports built from `fixtures/render/hostile-paths.json` (a missing coverage file and an
  unavailable diff, as in the existing hostile rendering test) When `renderMarkdown()` renders each Then
  exactly two lines of the rendering start with `>`, the first of them is `> [!CAUTION]`, `> [!WARNING]` or
  `> [!TIP]` matching the verdict, and the second matches
  `^> \*\*(Pass|Warn|Fail)\*\* · [A-Za-z0-9 .,;%]+$`
  - verify: unit
- **AC-5** Given the golden inputs of `fixtures/golden` When `check()` builds the report Then it is
  deep-equal to `fixtures/golden/report.json` as committed before this increment and validates against
  `schema/report.v1.json`
  - verify: unit
- **AC-6** Given the golden report with verdict `fail` and enough added rows that its full rendering is
  longer than the Action's 65,000-character comment limit When the Action fits it into the sticky comment
  (`fitMarkdown` with the comment marker and scope line as prefix) Then the returned body is at most
  65,000 characters, starts with the comment marker, the scope line, the fixed logo line, an empty line,
  `## 🛡️ pharn-ci · ❌ Fail`, an empty line and `> [!CAUTION]`, and still contains the callout's second
  line, the summary table's value row and every message line of the report
  - verify: integration
- **AC-7** Given the Action's test harness on a pull request whose coverage is below the threshold (as in
  the existing run test that posts a failing comment) When the Action runs Then the comment it posts
  contains the line `## 🛡️ pharn-ci · ❌ Fail` followed by an empty line, `> [!CAUTION]` and a line
  starting `> **Fail** · Diff coverage of this change is `
  - verify: integration
- **AC-8** Given the CLI fake dependencies with coverage meeting the threshold (as in the existing CLI test
  that expects exit 0) When `main()` runs `check` with markdown output Then it exits 0 and its output
  contains the line `## 🛡️ pharn-ci · ✅ Pass` followed by an empty line, `> [!TIP]` and a line starting
  `> **Pass** · `
  - verify: integration

## Constraints

- `schema/report.v1.json` is unchanged and `report.json` output is unchanged; message codes, message text
  and hints are stable (AGENTS.md rule 2).
- `packages/core/src` stays pure: no I/O, clock or randomness (AGENTS.md rule 1).
- The callout carries only fixed words, the verdict label, numbers and counts: nothing input-derived, so
  no escaping question arises.
- GitHub alert syntax: the first line of the block is exactly the alert marker (`> [!CAUTION]`,
  `> [!WARNING]` or `> [!TIP]`) with nothing after it, every content line starts `> `, and the block is
  at the top level of the markdown, not nested in a list, quote or `<details>`.
- The Action keeps finding its sticky comment by the marker and scope line, and `fitMarkdown` keeps the
  marker, the scope line, the logo line, the heading, the callout, the summary table's value row and every
  message within the 65,000-character limit.
- Golden files change only because of this intentional output change; existing tests are corrected and
  never weakened; reports produced in tests are validated with `expectValidReport` (AGENTS.md rules 3
  and 4). No new dependency, no network call, no telemetry (AGENTS.md rules 5 and 6).
- `packages/action/dist` is rebuilt and committed, since core changes (AGENTS.md rule 7).

## Assumptions

- The callout replaces the bare overview line rather than repeating it: the orchestrator notes say the
  sentence "moves into the callout", and showing it twice adds nothing.
- The callout's content line carries the verdict label in bold (`**Fail**`) but no verdict emoji, since
  GitHub draws its own icon and title ("Caution", "Warning", "Tip") on the alert and the heading above
  already shows the emoji.
- The summary table stays under the callout: the user asked only for the callout, and the orchestrator
  notes keep the table unless there is a clear reason to drop it.
- The mapping is by `report.verdict` alone: a pass report that carries warning-level messages still gets
  `[!TIP]`.
- GitHub renders alert blocks in PR comments; in an Actions job summary and in a terminal the same lines
  may show as a plain blockquote with the marker text, which is acceptable because the content line still
  carries the label and sentence.
- The README example comment is shown inside a quote or code block, where an alert does not render as a
  coloured box; updating its text to the new lines is enough.
- `docs/THREAT-MODEL.md` is not updated: the change adds no parsing of untrusted input, no new place the
  Action writes and no new GitHub API call, and nothing input-derived enters the callout.
- The README example, the CHANGELOG line, the regenerated snapshot and hash-pinned constants and the
  rebuilt dist are checked by review and by CI's dist check, not by acceptance criteria.
- `package.json` has a `test` script (`vitest run`), so PHARN's gate discovery finds the runner; no
  criterion needs an end-to-end runner.
