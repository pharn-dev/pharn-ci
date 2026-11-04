---
spec_id: pr-comment-logo
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

The pharn-ci report that appears as a sticky pull request comment, a job summary and CLI markdown output
already has a branded header block with an empty logo slot, kept empty until the user supplied the pharn
logo. The user has now supplied it: `docs/assets/pharn-logo.svg` is committed. The user wants the header
to show that logo as a small image above the heading, loaded from the repository's public raw URL
`https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg`, so the comment
carries the pharn brand the way review bots carry theirs. Earlier tests that forbid any image or URL in
the rendering, and that expect the heading on the first line, must be corrected so that exactly this one
fixed logo line is allowed at the top while every other image and URL stays forbidden.

## Scope

**In scope:**

- The logo slot renders one fixed line: a small HTML `<img>` whose `src` is exactly
  `https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg`, with a fixed alt
  text and a fixed width and height. It sits on its own line at the very top of the rendered markdown,
  followed by one empty line and then the existing heading `## 🛡️ pharn-ci · <icon> <Label>`, unchanged.
- The same logo line in every rendering, whatever the report holds: PR comment, job summary and CLI
  markdown output.
- Existing tests that forbid `<img`, `![`, `http://` or `https://` anywhere, that expect the logo slot to
  be empty, or that expect the heading as the first line (or right after the comment marker and scope
  line) corrected so that exactly the one fixed logo line is allowed at the top and every other image and
  URL is still forbidden; the line right after the logo block is the heading.
- Golden files, the markdown snapshot and the hash-pinned golden constants regenerated because the output
  changes on purpose, with the reason written next to the constants; the README example PR comment
  updated; a CHANGELOG line under Unreleased; `docs/THREAT-MODEL.md` gains a note on the fixed header
  image; `packages/action/dist` rebuilt.

**Out of scope (non-goals):**

- Any image, link or URL derived from input (paths, message text, config, refs, repository names), and
  any second image anywhere in the rendering.
- Changing the logo artwork in `docs/assets/pharn-logo.svg`, the README's own header image, or
  `docs/assets/pharn-ci-logo.svg`.
- Embedding the image as a `data:` URI, inlining the SVG, or serving it from anywhere other than the one
  raw URL above (including pinning it to a release tag).
- Any change to `schema/report.v1.json`, to Report v1 data or `report.json` output, or to message codes,
  message text or hints.
- Changes to the heading text, the overview sentence, the summary table, the section headings, the
  `<details>` blocks or the footer.
- Changes to the sticky comment marker, its scope line, how the Action finds its comment, the comment and
  summary size limits, or the fallback row counts.
- A config key, Action input or CLI flag to turn the logo off or choose its size.

## Acceptance Criteria

- **AC-1** Given the `logoMarkup()` export of the core renderer When it is called Then it returns exactly
  `<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">`
  - verify: unit
- **AC-2** Given the report built from the `fixtures/golden` inputs (verdict `fail`) When
  `renderMarkdown()` renders it Then its first line equals the AC-1 string, its second line is empty, its
  third line is `## 🛡️ pharn-ci · ❌ Fail`, and every line after the first two equals the corresponding
  line of `fixtures/golden/report.md` as committed before this increment
  - verify: unit
- **AC-3** Given reports that validate against `schema/report.v1.json` with verdict `pass`, verdict `warn`,
  `diffCoverage` null, no messages, 0 agent setup files, and the report built from
  `fixtures/render/hostile-paths.json` When `renderMarkdown()` renders each Then each rendering's first
  line equals the AC-1 string, its second line is empty and its third line starts `## 🛡️ pharn-ci · `;
  and with the first line removed, no rendering except the hostile one contains `<img`, `![`, `http://` or
  `https://`, and the hostile one contains no `<img` outside a code span and no `://` on any message line
  - verify: unit
- **AC-4** Given the URL in the AC-1 string When its path after
  `https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/` is resolved against the repository root
  Then that file exists in the repository and its content starts with `<svg`
  - verify: unit
- **AC-5** Given the golden inputs of AC-2 When `check()` builds the report Then it is deep-equal to
  `fixtures/golden/report.json` as committed before this increment and validates against
  `schema/report.v1.json`
  - verify: unit
- **AC-6** Given a valid report whose full rendering is longer than the Action's 65,000-character comment
  limit because of its tables When the Action fits it into the sticky comment (`fitMarkdown` with the
  comment marker and scope line as prefix) Then the returned body is at most 65,000 characters, starts
  with the comment marker, the scope line, the AC-1 string, an empty line and then `## 🛡️ pharn-ci · `,
  and still contains the overview sentence, the summary table's value row and every message line of the
  report
  - verify: integration
- **AC-7** Given the Action's test harness on a pull request whose coverage is below the threshold (as in
  the existing run test that posts a failing comment) When the Action runs Then the comment it posts
  starts with the comment marker, the scope line, the AC-1 string, an empty line and
  `## 🛡️ pharn-ci · ❌ Fail`
  - verify: integration
- **AC-8** Given the CLI fake dependencies with coverage meeting the threshold (as in the existing CLI test
  that expects exit 0) When `main()` runs `check` with markdown output Then it exits 0, the first line of
  its output equals the AC-1 string, and the output contains `## 🛡️ pharn-ci · ✅ Pass` and
  `### 🧪 Diff coverage`
  - verify: integration

## Constraints

- `schema/report.v1.json` is unchanged and `report.json` output is unchanged; message codes, message text
  and hints are stable (AGENTS.md rule 2).
- `packages/core/src` stays pure: the logo URL is a fixed string constant, and core makes no network call,
  reads no file and uses no clock or randomness (AGENTS.md rule 1).
- The logo line is one fixed string: nothing input-derived ever enters it, and it is identical for every
  report.
- The Action makes no new request: GitHub, not pharn-ci, loads the image when the comment or summary is
  viewed (AGENTS.md rule 5). No new dependency, no telemetry (AGENTS.md rules 5 and 6).
- The Action keeps finding its sticky comment by the marker and scope line, never by the heading or the
  logo, and `fitMarkdown` keeps the marker, the scope line and the header block (logo line and heading)
  within the 65,000-character limit.
- Golden files change only because of this intentional output change; existing tests are corrected and
  never weakened, so every image or URL other than the one logo line is still forbidden; reports produced
  in tests are validated with `expectValidReport` (AGENTS.md rules 3 and 4).
- `packages/action/dist` is rebuilt and committed, since core changes (AGENTS.md rule 7).

## Assumptions

- The size is 48 by 48 pixels: the SVG is 502 by 500, close to square, and 48 pixels reads as a small
  mark next to a level-two heading; the browser keeps the drawing's proportions inside the box.
- The alt text is `pharn`, since the image is the pharn mark and the heading right below already names
  pharn-ci.
- The logo sits on its own line above the heading through the existing slot, not inside the heading, so
  the heading line keeps its exact text and the tests and readers that match it keep working.
- The attribute order and quoting in AC-1 are a fixed choice so the line can be compared exactly; GitHub
  renders the tag the same with any order.
- The raw URL resolves only after this branch is merged to `main`; until then a comment rendered from
  this branch shows the alt text or a broken image, which the user accepted by naming that URL.
- The URL follows `main`, not the release tag a workflow pins, so any later change to
  `docs/assets/pharn-logo.svg` on `main` changes the image in every existing and future comment; `main` is
  protected by the repository rulesets. This residual is recorded in `docs/THREAT-MODEL.md`.
- GitHub serves images in comments and job summaries through its image proxy (camo), so viewers' browsers
  do not contact `raw.githubusercontent.com` directly and the pharn-dev repository learns nothing per
  view; the CLI prints the raw `<img>` line in a terminal, where it is fetched by nothing.
- AGENTS.md's THREAT-MODEL triggers (new untrusted parsing, a new place the action writes, a new GitHub
  API call) do not strictly fire, but a short note on the fixed first-party header image is added anyway,
  since the B1 entry describes how images are kept out of the comment.
- The README example, the CHANGELOG line, the THREAT-MODEL note and the rebuilt dist are checked by review
  and by CI's dist check, not by acceptance criteria.
- `package.json` has a `test` script (`vitest run`), so PHARN's gate discovery finds the runner; no
  criterion needs an end-to-end runner.
