---
spec_id: action-pins-uses-value-next-line-2
state: Approved
approved_by: model
spec_content_hash: faaf6226f4a2003a64719b2dc02e2882fb87e1c3dfd6ec9e644788984c5b9f8a
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
spec_kind: quick
---

## Intent

The `Action pins` check (`scripts/check-action-pins.mjs`) exists so that no workflow in this repo can use
a third-party action that is not pinned to a full commit SHA. Today it reads a `uses` key and its value
from one line only. A `uses` key written with no value on its own line, with the value on the next line,
is not seen at all, so an unpinned action written that way passes the check (review ticket CORE-147).
The maintainers want the check to fail on every `uses` key that has no value on its line, whatever the
next line holds, so that this spelling cannot be used to get an unpinned action past the required check.

## Scope

**In scope:**

- `scripts/check-action-pins.mjs` reports a `uses` key that has no value on its own line, once comments
  are removed, as `<file>:<line>  uses: with no value on its line`, and exits 1 as it does for an unpinned
  action. The line is the 1-based line of the `uses` key.
- The report does not depend on the next line: a value on the next line that is pinned to a 40-hex SHA is
  reported the same way as a tag.
- The shapes covered: a plain `uses:` with the value on the next line, a `uses:` followed only by a
  comment, and a flow mapping split across lines so that a `uses` key ends a line.
- Text inside a block scalar (such as a `run: |` block) is still not read as a key, also when that text
  ends in `uses:`.
- Tests for these cases in one new test file, each running the script in a temp directory and never
  against the repo's own `.github/`.

**Out of scope (non-goals):**

- `.github/workflows/ci.yml`, including the job name `Action pins`, and every other workflow file.
- Hooks and rulesets, including `.github/rulesets/`.
- Reading a value from the next line and checking whether it is pinned: the key's own line decides.
- Changing how a `uses` key that has a value on its line is checked or reported.
- Changing, moving or removing an existing test, including those in
  `packages/core/test/ac-review-medium-ci.test.ts`.

## Acceptance Criteria

- **AC-1** Given a workflow whose first step line, line 4 of the file, is `- uses:` with nothing after the
  colon, and whose next line holds the tag ref `actions/checkout@v4`
  When `scripts/check-action-pins.mjs` runs in the temp directory that holds the workflow
  Then it exits 1 and stderr contains the workflow's path followed by `:4  uses: with no value on its line`,
  and the same workflow with a ref pinned to a 40-hex SHA on the next line also exits 1
  - verify: integration
- **AC-2** Given a workflow whose step line is `- uses: # note`, and a second workflow whose only step is a
  `run: |` block scalar whose text ends in `uses:`
  When the script runs on each
  Then the first exits 1 and stderr contains `uses: with no value on its line`, and the second exits 0
  and stdout contains `ok   every workflow action is pinned to a commit SHA`
  - verify: integration
- **AC-3** Given a workflow whose step is a flow mapping split across lines, with a `uses` key ending one
  line and its value starting the next
  When the script runs
  Then it exits 1 and stderr contains `uses: with no value on its line`
  - verify: integration

## Constraints

- The pattern the user requires, added next to `USES` in the script and matched against the line's text
  after comment removal, after the existing `USES` loop in `check()`:
  `USES_EMPTY = /(?:^|[\s{,-])["']?uses["']?\s*:\s*["']?\s*$/`.
- The reported entry is exactly `<file>:<line>  uses: with no value on its line`, with two spaces after
  the line number, in the same list and under the same heading line as the existing entries.
- The new tests live in the new file `packages/core/test/ac-action-pins-uses-empty-2.test.ts`, with its
  own copies of the `runPins`, `steps` and `X` helpers from `packages/core/test/ac-review-medium-ci.test.ts`.
- Every existing test stays unchanged and keeps passing (AGENTS.md rule 4).
- The new tests use temp directories; none reads or writes the repo's own `.github/`.
- The script stays a dependency-free Node script; no new dependency anywhere (AGENTS.md rule 6).
- The repo's own workflows keep passing the check without being edited.

## Assumptions

- The five cases the description lists are grouped into three criteria so the change fits a quick SPEC;
  no case is dropped. The `run: |` case exits 0 today as well, so it shares a criterion with the
  `- uses: # note` case: the test stage requires each criterion's test to fail before the build.
- "Names line 4" means stderr holds the workflow's path as the script prints it
  (`.github/workflows/x.yml` joined with the platform separator, the `X` helper's value), then `:4`, then
  the message; the `steps` helper puts the first step on line 4.
- For the 40-hex SHA case, the comment-only case and the split flow mapping the description asks only for
  exit 1; the message text in stderr is asserted for the last two because the script prints one entry per
  report, and no line number is asserted for them.
- The split flow mapping in the test is of the form `- { name: x, uses:` on one line and the ref with the
  closing brace on the next.
- The `run: |` workflow holds no other `uses` key, so exit 0 comes with the script's `ok` line.
- A read this run found no `uses` key without a value on its line in the four files under
  `.github/workflows` (`.github/actions` does not exist), and the script exits 0 on the repo today, so the
  `Action pins` job keeps passing with no workflow edit.
- The new test file does not exist yet; the earlier feature `action-pins-uses-value-next-line` maps a
  different file name (`ac-action-pins-uses-empty.test.ts`), so the name the description gives is free.
- No `CHANGELOG.md` line and no `docs/THREAT-MODEL.md` change: the script is repo tooling that is not
  shipped to users, and the description names neither.
- The level is `integration` because each test spawns the script as a subprocess over files on disk, as
  the existing tests for this script do.
- The project's `test` script is `vitest run`, so PHARN's gate discovery finds a runner for the
  `integration` criteria; the test stage's own preflight decides whether it gives per-test results.
