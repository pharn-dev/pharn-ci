---
spec_id: accept-label-human-signoff-3
spec_content_hash: 8565cbd9cbb9e2bcc9308e903ed01448d420ff57082e554877a6d70466efac41
applied_lessons: none
---

## Approach

> ADVISORY: model work. The verdicts named here come from the floor checkers, not from this plan.

The decision rules are pure and go in `packages/core` (no I/O, AGENTS rule 1). The two GitHub reads and the page
loop go in `packages/action`. `check()` stays as it is. The Action post-processes the report `check()` returns,
before it writes report.json, the job summary, the comment, the `verdict` output and the failed step. So the CLI
never sees the label (AC-12), and a default run's report is the report it is today (AC-13).

Pipeline inside the Action's `runUnsafe`:

1. **Validate `accept-label` first.** Do it right after `parsePrNumberInputs` and before `loadConfig`, the
   measurement, the summary and the comment. `readInput` already trims. Empty means `pharn/accepted`. More than
   50 code points (`[...label].length`) fails the step, and so does any character in U+0000–U+001F or
   U+007F–U+009F. The error is one fixed sentence that names `accept-label` and never echoes the value (AC-1).
2. **Run `check()` as today.**
3. **`withAcceptLabel(report, label)`.** When the label is not `pharn/accepted` (compared case-insensitively), set
   `testIntegrity.acceptLabel` to it. Otherwise the report is left untouched. This holds for every mode and event
   (AC-1, AC-5, Assumptions).
4. **Decide whether to ask GitHub at all.** All of these must hold, or nothing more happens: no API call, no
   message (AC-3).
   - The run is for a pull request: a `pull_request` event with a `pull_request` payload, or a `pr-number` target.
     `pull_request_target`, `push`, `merge_group` and everything else are excluded.
   - `testIntegrity.mode === "block"`.
   - At least one signal has severity `block`.
5. **Read the pull request** with the new `api.getPullRequestSignoff(number)`, which returns
   `{ author: data.user, labels: data.labels }`.
   - The read rejects, the author has no non-empty string login, or the labels are not a list of `{ name: string }`
     → **ignored / unreadable**, and no events request is made (AC-7, last case).
   - The PR carries no label equal to the configured name, compared case-insensitively → nothing: no message, no
     events request (AC-3, AC-5 second case).
6. **Read the events** with the new `api.listIssueEvents(number, page)`, which returns `{ events, hasNext }`.
   - Pages 1..10, `per_page: 100`. Stop at the first page with `hasNext === false`.
   - A page whose `events` is not an array, a rejection (403, timeout), or `hasNext` still true after page 10
     → **ignored / unreadable**. At most 10 requests (AC-4, AC-7).
7. **`decideAcceptLabel({ label, authorLogin, events })`** (pure, core). It takes the **last** event that has
   `event === "labeled"` and a `label.name` equal to the label, compared case-insensitively. The API lists events
   oldest first.
   - No such event → `no-event`.
   - The actor is not an object → `unreadable`. This covers a deleted account.
   - `actor.type` is not a string → `unreadable`.
   - `actor.type !== "User"` → `not-user` (Bot, Organization, …). The type is checked before the login pattern, so
     `claude[bot]` is `not-user`.
   - The login does not match `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$` → `unreadable`. This covers `a<b>c` and a
     40-character login.
   - The login equals the PR author's login, compared case-insensitively → `author`.
   - Otherwise → `{ honoured: true, by: login }` (AC-6, AC-7, AC-8).
8. **Honoured → `acceptTestIntegrity(report, { label, by })`** (pure). It returns a new report:
   - Every `block` signal becomes `warn`, with the same id, path, line, detail, base and head.
   - The `TEST_INTEGRITY_TIxx` messages are rebuilt in place with the shared helper below, so error becomes warn.
   - One `TEST_INTEGRITY_ACCEPTED` (info) message goes in after the last `TEST_INTEGRITY_TI*` message.
   - `testIntegrity.accepted = { label, by }`, where `label` is the configured name as given after trimming.
   - `testIntegrity.verdict` is recomputed from the signals and `report.verdict = verdictOf(messages)`. A
     `DIFF_COVERAGE_BELOW_THRESHOLD` error stays, so the run still fails (AC-5, fourth case).
9. **Ignored → `ignoreAcceptLabel(report, label, reason)`** (pure). It adds one `TEST_INTEGRITY_ACCEPT_IGNORED`
   (warn) message after the TI messages and leaves the signals and `accepted` alone.
   - The text names the label and no login.
   - The `author` text says the PR author applied it.
   - The `not-user` text says it was not applied by a user account.
   - The `no-event` text says no labeling event was found.
   - The `unreadable` text says the pull request or its labeling events could not be read.
   - Every text is a fixed sentence plus the validated label. Nothing the API returned goes in except a validated
     login, and only in the honoured case (Constraints).

`report.ts` exports the per-id message loop it already has, as
`testIntegritySignalMessages(signals): Message[]`. `buildReport` calls it as before, with the same output, and
`acceptTestIntegrity` calls it again, so the rule is the same: error if any block, warn if any warn, else info. One
source, no copy.

**Rendering** (`render/markdown.ts`):

- The TI03, TI10 and TI13 hints become functions of `report.testIntegrity.acceptLabel ?? "pharn/accepted"`, used
  both under the findings and in the Messages section, so `renderMessage` takes the report.
- The label is rendered by a new `labelSpan(text)`:
  - control characters become U+FFFD;
  - the code span fence is one backtick longer than the longest backtick run in the text;
  - a space pads each side when the text starts or ends with a backtick or a space (the CommonMark rule).
  - So ``a`b <!-- @x |`` stays one line, inside one code span, with its text intact (AC-9).
- New hint texts. Each keeps the words the existing tests look for, contains no `ships` and no `accept-label`:
  - **TI03:** "A reviewer must decide whether each skipped test may stay, for example one that fails in CI; a
    reviewer who is not the PR author records that sign-off by applying the accept label <span>."
  - **TI10:** "Restore the test script, or say in the PR why it changes so a reviewer can confirm it; a reviewer
    who is not the PR author can record that sign-off by applying the accept label <span>."
  - **TI13:** "Write a test for the code in place of the ignore comment, or say in the PR why it cannot be
    tested; a reviewer who is not the PR author can record that sign-off by applying the accept label <span>."
  - The TI01, TI04, TI11 and TI14 hints are unchanged.
- Fixed hints for the two new codes. Neither holds `accept-label`.
- The Test integrity section gets one line after the findings (and after the "…and N more" line) when
  `testIntegrity.accepted` is an object: "Accepted via label <labelSpan(label)> by @<login>".
  - The ` by @<login>` part appears only when `by` matches the login pattern (imported from `acceptLabel.ts`).
  - The line is absent when `accepted` is null or absent (AC-10).

**Config:** `validateTestIntegrity` rejects the `accept_label` key whatever its value, even an empty one, with a
`ConfigError` that names `test_integrity.accept_label` and says to set the `accept-label` input in the workflow. The
check runs before the null-skip. The Action step fails and the CLI exits 2 (AC-2). The general unknown-key message
stays for every other key.

**Token permission (confirmed this run).** GitHub's "Permissions required for fine-grained personal access
tokens" page lists `GET /repos/{owner}/{repo}/issues/{issue_number}/events` under both "Issues" (read) and "Pull
requests" (read). So the quick start's `pull-requests: write` (which includes read) is enough, and a fork PR's
read-only token can still read the events. The README and `action.yml` say "`pull-requests: read` (or
`issues: read`)".

## Applied lessons

- none: the lessons index check returned `NO_CANON`. This project has no `memory-bank/lessons-learned.md` yet, so
  there is no lesson to apply. The two earlier runs' plan-stage design notes (in
  `pharn/features/accept-label-human-signoff/LOOP.md`) were read as data and agree with this approach.

## Steps

- **Core purity (no I/O).** Add `packages/core/src/acceptLabel.ts` with:
  - `DEFAULT_ACCEPT_LABEL`, `MAX_ACCEPT_LABEL_LENGTH = 50` and `GITHUB_LOGIN`;
  - `validateAcceptLabel(raw)` → `{ ok: true, label } | { ok: false, error }`;
  - `isDefaultAcceptLabel(label)`;
  - `carriesAcceptLabel(labels: unknown, label)` → `boolean | "unreadable"`;
  - `decideAcceptLabel({ label, authorLogin, events })` → `{ honoured: true, by } | { honoured: false, reason }`;
  - `withAcceptLabel(report, label)`, `acceptTestIntegrity(report, { label, by })` and
    `ignoreAcceptLabel(report, label, reason)`.
  - Each returns a new report and never mutates its input.
  - The `reason` type is `"author" | "not-user" | "no-event" | "unreadable"`.
- In `report.ts`:
  - add `TEST_INTEGRITY_ACCEPTED` and `TEST_INTEGRITY_ACCEPT_IGNORED` to `MessageCode`;
  - add `acceptLabel?: string` to `ReportTestIntegrity`;
  - export `testIntegritySignalMessages(signals)` and have `buildReport` call it, with output unchanged.
- In `config.ts`, add the `accept_label` rejection before the null-skip.
- In `render/markdown.ts`:
  - turn the TI03, TI10 and TI13 hints into functions of the label;
  - add `labelSpan`, the accepted line and the hints for the two new codes;
  - pass the report into `renderMessage`.
- In `index.ts`, export the new functions, constants and types.
- In `api.ts`:
  - `getPullRequestSignoff(n)` calls `octokit.rest.pulls.get` and returns `{ author: data.user, labels: data.labels }`;
  - `listIssueEvents(n, page)` calls `octokit.rest.issues.listEvents({ owner, repo, issue_number: n, per_page: 100,
    page })` and returns `{ events: res.data, hasNext: /\brel="next"/.test(String(res.headers.link ?? "")) }`;
  - `getPullRequest` keeps its shape, so `api.test.ts` and `ac-pr-number-api.test.ts` are untouched.
- In `run.ts`:
  - add both methods to `GitHubApi`, with doc comments saying they are read-only;
  - validate the input early;
  - after `check()`, call `applyAcceptLabel` from the new `packages/action/src/accept-label.ts`;
  - write and render the report that comes back.
- In `accept-label.ts`:
  - the eligibility test, the PR read, the page loop (cap 10) and the mapping of every failure to `unreadable`;
  - `deps.info` lines are fixed text and never hold API text or error text.
- In `schema/report.v2.json`:
  - add `testIntegrity.acceptLabel` (`type: string`, `minLength: 1`, `maxLength: 50`), with a description saying it
    is Action-only and non-default-only;
  - document the two codes in the message-code description;
  - extend the `testIntegrity` and `accepted` descriptions.
  - `schema/report.v1.json` is not touched.
- In `action.yml`:
  - add the `accept-label` input (not required, `default: pharn/accepted`, a description);
  - add the issue-events read to the `github-token` description.
- In README:
  - an `accept-label` row in the input table;
  - an "Accept label" subsection covering the reviewer who is not the author, never from `.pharn/ci.yml`, the
    `pull_request` `types: [opened, synchronize, reopened, labeled, unlabeled]`, `pull-requests: read` (or
    `issues: read`), that the CLI never honours it, and that `merge_group` and `push` do not honour it;
  - the two codes in the message-code list;
  - the token row names the events read.
- In CHANGELOG, an Unreleased entry naming `accept-label`, `TEST_INTEGRITY_ACCEPTED` and
  `TEST_INTEGRITY_ACCEPT_IGNORED`.
- In `docs/THREAT-MODEL.md`, cover:
  - the new read-only issue-events call and the second PR read;
  - fail-closed;
  - the bot and author rules and the newest-event rule;
  - the 10-page cap;
  - that no API text reaches report, message or comment except a validated login;
  - that the input lives in the workflow file a `pull_request` run takes from the PR (the existing residual risk);
  - that the `@login` mention may re-notify.
- In `docs/LIMITS.md`, say:
  - the label is a sign-off on the PR as a whole, not tied to a commit, so a later push keeps it;
  - an event list that does not end within 10 pages of 100 (over 1,000 events) is not read, and the label is
    ignored;
  - no permission check on the applier, and no app-for-user distinction.
- Add the fixtures under `fixtures/accept-label/`. Exact contents are under Files: each event is
  `{ "id", "event", "actor": { "login", "type" } | null, "label": { "name", "color" }, "created_at" }`, oldest
  first.
- Replace the superseded hint assertions in the two named render tests, with a comment on each giving the reason:
  the label shipped, so the hint now names it. The reason also goes in BUILD.md. Nothing else in those files
  changes.
- Run `pnpm build` to rebuild `packages/action/dist/index.js`. Run `pnpm lint` and `pnpm test`.

## Files

- `packages/core/src/acceptLabel.ts` — new, pure: default label, input validation, login pattern, label membership, the newest-labeled-event decision, `withAcceptLabel`, `acceptTestIntegrity`, `ignoreAcceptLabel`
- `packages/core/src/report.ts` — two message codes, optional `testIntegrity.acceptLabel`, exported `testIntegritySignalMessages` helper used by `buildReport`
- `packages/core/src/render/markdown.ts` — label-aware TI03/TI10/TI13 hints, `labelSpan`, accepted line, hints for the two new codes
- `packages/core/src/config.ts` — `test_integrity.accept_label` rejected with an error pointing at the `accept-label` input
- `packages/core/src/index.ts` — exports of the new module and helper
- `packages/action/src/api.ts` — `getPullRequestSignoff` and `listIssueEvents` (read-only)
- `packages/action/src/accept-label.ts` — new: eligibility, PR read, capped events paging, fail-closed mapping, applies the core decision
- `packages/action/src/run.ts` — `GitHubApi` gains the two methods; `accept-label` validated first; accept step after `check()`
- `action.yml` — the `accept-label` input; `github-token` description names the issue-events read
- `schema/report.v2.json` — `testIntegrity.acceptLabel`, the two codes documented, descriptions extended
- `README.md` — input row, accept-label subsection, message codes, token permission
- `CHANGELOG.md` — Unreleased entry
- `docs/THREAT-MODEL.md` — issue-events read, fail-closed, bot/author rules, page cap, input in the PR-editable workflow
- `docs/LIMITS.md` — sign-off not tied to a commit; over 1,000 events not read
- `packages/cli/test/ac-ti1013-render.test.ts` — superseded TI10/TI13 hint assertions ("ships", "not `pharn/accepted`") replaced; reason in a comment and BUILD.md
- `packages/cli/test/ac-ti0304-render.test.ts` — superseded TI03 hint assertions ("not `pharn/accepted`") replaced; TI04 keeps its check; reason in a comment and BUILD.md
- `fixtures/accept-label/files.txt` — tracked files `package.json`, `src/a.ts`, `src/a.test.ts`, `e2e/login.spec.ts`, `AGENTS.md`
- `fixtures/accept-label/block.diff` — the concatenation of `fixtures/test-integrity/TI10/block-or-true.diff` and `fixtures/test-integrity/TI13/block-istanbul-next.diff` (TI10 and TI13 block in mode block)
- `fixtures/accept-label/or-true.diff` — a copy of `fixtures/test-integrity/TI10/block-or-true.diff` (TI10 only)
- `fixtures/accept-label/warn-only.diff` — a copy of `fixtures/test-integrity/TI03/warn-conditional-mobile.diff` (a TI03 warn, no block)
- `fixtures/accept-label/no-signal.diff` — adds `export const two = 2;` at line 3 of `src/a.ts` (no signal)
- `fixtures/accept-label/events-human.json` — `labeled` `bug` by `octo-author` (User), then `labeled` `pharn/accepted` by `Reviewer-1` (User)
- `fixtures/accept-label/events-author.json` — `labeled` `pharn/accepted` by `OCTO-Author` (User)
- `fixtures/accept-label/events-bot.json` — `labeled` `pharn/accepted` by `claude[bot]` (Bot)
- `fixtures/accept-label/events-organization.json` — `labeled` `pharn/accepted` by `octo-org` (Organization)
- `fixtures/accept-label/events-no-matching-event.json` — `labeled` `bug` and `labeled` `needs-review` by `Reviewer-1`, then `unlabeled` `pharn/accepted` by `Reviewer-1`
- `fixtures/accept-label/events-applied-twice-author-last.json` — `labeled` by `Reviewer-1`, `unlabeled` by `octo-author`, `labeled` by `octo-author` (all `pharn/accepted`, User)
- `fixtures/accept-label/events-applied-twice-reviewer-last.json` — `labeled` by `octo-author`, `unlabeled` by `octo-author`, `labeled` by `Reviewer-1` (all `pharn/accepted`, User)
- `fixtures/accept-label/events-no-actor.json` — `labeled` `pharn/accepted` with `"actor": null`
- `fixtures/accept-label/events-hostile-login.json` — `labeled` `pharn/accepted` by `a<b>c` (User)
- `fixtures/accept-label/events-unreadable.json` — a JSON object, not a list: `{ "message": "<b>not a list</b> @octo-author" }`
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `schema/report.v1.json` — unchanged (AC-11 pins it to the base commit)
- `fixtures/golden/report.json` — unchanged; default runs carry no `acceptLabel` (AC-13)
- `packages/core/src/check.ts` — `check()` is unchanged; the label is applied by the Action after it
- `packages/core/src/testIntegrityMode.ts` — mode precedence unchanged
- `packages/cli/src/main.ts` — no new flag; `--accept-label` stays an unknown option (AC-12)
- `packages/action/src/pr-number.ts` — `getPullRequest` and the target resolution keep their shape
- `packages/action/test/harness.ts` — existing fakes need no new method (no existing test reaches the new path)
- `packages/action/test/ac-stream-action.test.ts` — its golden assertion stays as it is
- `packages/cli/test/ac-stream-adapters.test.ts` — its golden assertion stays as it is
- `package.json` — no new dependency or script

## Acceptance mapping

- AC-1 → step 1 (`validateAcceptLabel` in `run.ts` before `loadConfig`; error text fixed) and step 3 (`withAcceptLabel`, case-insensitive default).
- AC-2 → `config.ts` rejection naming `test_integrity.accept_label` and the `accept-label` input; same parser in the CLI (exit 2 on `ConfigError`).
- AC-3 → the eligibility test of step 4 (PR run, mode block, a block signal) and the label-membership check of step 5; no events request before both pass.
- AC-4 → steps 5–8 in both a `pull_request` run and a `pr-number` run (PR number from the payload or the target); page cap 10; `acceptTestIntegrity` rebuilds messages and verdicts; accepted line rendered.
- AC-5 → configured label used for membership, matching and `accepted.label`; `acceptLabel` from step 3; hints read it; case-insensitive comparisons; diff-coverage error untouched by the downgrade.
- AC-6 → `decideAcceptLabel`: type before login pattern; author compared case-insensitively; `ignoreAcceptLabel` texts without login.
- AC-7 → every read failure, a non-list page, an actor that is null or fails the login pattern, and `hasNext` after page 10 map to `unreadable`; a missing event maps to `no-event`; fixed texts only.
- AC-8 → the newest matching `labeled` event decides; `unlabeled` events are not matches.
- AC-9 → label-aware hints with `labelSpan`; TI01/TI04/TI11/TI14 hints unchanged.
- AC-10 → the accepted line after the findings, only when `accepted` is an object.
- AC-11 → schema additions; reports from the core functions validate; `acceptLabel` typed string; v1 untouched.
- AC-12 → nothing in the CLI changes; `check()` never writes `acceptLabel` or `accepted`.
- AC-13 → `withAcceptLabel` adds nothing for an unset or default input; the golden assertions run unchanged.
- AC-14 → only the named hint assertions change; `buildReport` output unchanged through the shared helper; dist rebuilt.
- AC-15 → the `action.yml`, README, CHANGELOG, THREAT-MODEL, LIMITS and fixture changes above.

## Risks & open questions

- **`@login` in an updated sticky comment may re-notify the reviewer.** The product's wording accepts this, and
  THREAT-MODEL names it.
- **The label is honoured only on a run that happens after it is applied.** That needs the `labeled` and
  `unlabeled` trigger types, which the README states. Without them, an earlier failed run stays failed until a
  re-run.
- **`pull_request_target` is excluded on purpose.** The SPEC defines a PR run as `pull_request` or `pr-number`, so
  a `pull_request_target` run never honours the label.
- **`hasNext` comes from the Link header.** A response without one counts as the last page. A list of exactly
  1,000 events with no further page is read in full. A list longer than that keeps `hasNext` on page 10 and is
  unreadable.
- **The AC tests need their own fake API** with `getPullRequestSignoff` and `listIssueEvents`, plus a diff and
  tracked files with a test file. The golden harness lists no test file, so TI10 would be exempt there. They can
  spread `harness().deps` and override `api` and `git`, and use `fixtures/accept-label/files.txt` and the diffs
  above.
