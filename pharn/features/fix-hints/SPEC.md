---
spec_id: fix-hints
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
---

## Intent

pharn-ci tells a team whether an AI coding agent's pull request is safe to merge, and today its report says only what is
wrong: a message code, a signal id, a path, a line and a sentence written for a human. An agent that reads the report
to fix its own pull request has to guess what an honest fix is, and the easiest guesses are the dishonest ones: lower
the coverage threshold, exclude the file, skip the test, add an exemption. Horizon 2 item H6 closes this loop. Every
message and every finding in Report v2 gains an optional machine-readable `fix` object, `{ kind, target?, hint }`,
whose `kind` comes from a closed list of honest actions (`add-test`, `restore-test`, `restore-assertion`,
`revert-config`, `remove-dependency`, `request-review`, `split-pr`, `none`), whose `target` is a path or `path:line` the
finding already names, and whose `hint` is one fixed English sentence per code or signal id. By construction no kind
lowers a gate, so an agent (or the `pharn-ci-fix` skill, which lives in another repository) can act on `fix.kind`
without ever being told to cheat. The report stays deterministic: no model decides a hint, and no file text, diff text
or test name reaches a hint. This matters now because v0.8.0 completed the set of signals (TI01 to TI16, P01 to P14,
S01 to S11, SI01 to SI04, PI01 to PI05, D01 to D05, flaky and JUnit) that the loop needs, and the skill cannot ship
without the report carrying the hints.

## Scope

**In scope:**

- An optional `fix` object on every item of `messages`, `testIntegrity.signals`, `policy.violations`,
  `setupHealth.stale`, `injection.signals` and `dependencies.signals` in Report v2, with `kind` (required, from the closed
  list), `target` (optional) and `hint` (required, at most 200 characters), described in `schema/report.v2.json` and
  mirrored in the core's TypeScript types.
- One table in core that maps every message code and every signal id the schema documents to a kind and a fixed hint
  sentence, and one helper that attaches `fix` wherever messages and findings are built, so the CLI's JSON and the
  Action's `report.json` carry it.
- The mapping of ids to kinds listed under Data, filled for every code and id; a code with no honest action gets `none`
  and a hint that still says what a person should look at.
- `target` filled only from fields the finding already carries (`path`, or `path:line` when the line is not null);
  messages carry no path, so a message's `fix` has no `target`.
- The uploaded `report.json` carrying `fix` under the same rules as every other uploaded field (fixed words, ids and
  paths only; redaction leaves it intact).
- Tests: the closed kind list, the banned words in hint text, a mapping for every documented code and id, the presence
  and shape of `fix` on real reports built from fixtures, schema validation of every such report, and the pins and
  goldens that whole-report changes touch, re-pinned through one shared helper that strips `fix` (never loosened).
- Documentation: a README section "Fix hints", the schema descriptions, a CHANGELOG line, and a `docs/LIMITS.md` section
  that says hints are generic and never prove the fix.

**Out of scope (non-goals):**

- The `pharn-ci-fix` skill (pharn-dev/skills) and any change to the `pharn-ci-cover` skill.
- Any change to the PR comment or job summary: the markdown renderer's output is unchanged, and no "How to fix" line is
  added; the existing human "Hint:" lines stay as they are.
- A new message code, action input, CLI flag, config key or policy key; nothing a pull request carries can change a
  hint or a kind.
- A kind that lowers a threshold, excludes a file, skips or quarantines a test, adds an exemption or an accept label, or
  edits a policy: such kinds do not exist, and no hint tells the reader to do any of these.
- Hints that interpolate file text, diff text, test names, package names, secret values or detail text; only the path,
  the line and the ids already in the finding may appear.
- Any change to `schema/report.v1.json`, and the removal, renaming or retyping of any existing field or message code.
- Changes to the workflows under `.github/`, to `AGENTS.md` or to `CLAUDE.md`.

## Acceptance Criteria

- **AC-1** Given the core's exported list of fix kinds and the `fix.kind` enum of `schema/report.v2.json` When both are read Then each is exactly the eight values `add-test`, `restore-test`, `restore-assertion`, `revert-config`, `remove-dependency`, `request-review`, `split-pr` and `none`, in that order, with no other value
  - verify: unit
- **AC-2** Given every message code named in the message-code description of `schema/report.v2.json` and every signal id the schema documents (TI01 to TI16, P01 to P14 as the core produces them, SI01 to SI04, PI01 to PI05, D01 to D05) When each is looked up in the core's fix table Then every one has an entry whose kind is one of the eight values and whose hint is a non-empty string of at most 200 characters, so a code or id added later without an entry fails the test
  - verify: unit
- **AC-3** Given every hint sentence in the core's fix table When each is scanned case-insensitively on word boundaries Then none contains any of the words `exclude`, `excluding`, `exclusion`, `lower`, `skip`, `threshold`, `ignore`, `disable`, `exempt` or `exemption`, and none contains a placeholder other than the finding's own path, line or id
  - verify: unit
- **AC-4** Given the core's fix table When the kinds of the entries are read Then they equal the mapping listed under Data, in particular TI01 to TI04 and `TEST_FILES_DELETED` give `restore-test`, TI05 to TI07 give `restore-assertion`, TI09, TI10, TI11, TI13, TI14, P09 and P13 give `revert-config`, TI08, TI12, TI15, TI16, P02 to P06, P08, P11, S01 to S11, PI01 to PI05, `CONFIG_CHANGED_IN_DIFF`, `COVERAGE_FILE_TRACKED` and D04 give `request-review`, `DIFF_COVERAGE_BELOW_THRESHOLD` and `TESTS_NOT_EXERCISING_CHANGES` give `add-test`, P14 gives `split-pr`, D01, D02, D03 and D05 give `remove-dependency`, and SI01 to SI04, P01, P07, P10 and every operational code (the coverage-file, diff, paths, agent-setup, mode, index, truncation, accept, unscanned, policy-unavailable, override, upload, settings-invalid, detection, lookup, check-incomplete, JUNIT and FLAKY codes) give `none`
  - verify: unit
- **AC-5** Given the fixtures that produce test-integrity signals (at least the TI01, TI05, TI14 and TI11 fixtures), a policy with P11 and P14 violations on an agent pull request, a stale-instruction fixture, a prompt-injection fixture and a dependency fixture with D04 and D05 When the check runs on each Then every signal, violation and stale finding carries `fix` whose kind is the one the table gives for its id, whose `target` equals the finding's `path` when its line is null and `path:line` when it is not, and whose hint is the table's sentence with only that path, line or id interpolated; and every report validates against `schema/report.v2.json`
  - verify: integration
- **AC-6** Given the same reports When their `messages` are read Then every message carries `fix` with the kind the table gives for its code, no `target`, and the table's hint, including the `TEST_INTEGRITY_<id>` message of each signal id present, and a `none` entry still carries a non-empty hint
  - verify: integration
- **AC-7** Given a test-integrity fixture whose diff lines and test names hold a distinctive token (for example a unique identifier and a secret-shaped string) and a dependency fixture that adds a distinctively named package When the report is produced Then no `fix.hint` and no `fix.target` of the report contains that token or that package name, and two findings of the same id differ in their `fix` only by path, line or id
  - verify: integration
- **AC-8** Given `schema/report.v2.json` When it is read Then the message definition and the item schemas of `testIntegrity.signals`, `policy.violations`, `setupHealth.stale`, `injection.signals` and `dependencies.signals` each carry an optional `fix` object with `additionalProperties` false, required `kind` and `hint`, optional `target`, `kind` as the enum of AC-1 and `hint` with `maxLength` 200, each with a description that says no kind lowers a gate; every `required` list of the schema is unchanged from the base commit; a report of the previous shape (without any `fix`) still validates; and `schema/report.v1.json` is byte-identical to the base commit
  - verify: unit
- **AC-9** Given the golden fixtures (`fixtures/golden`, `fixtures/golden-cobertura` and the other golden directories) When `pharn-ci check --format json` and the markdown renderer run on them Then the JSON output equals the regenerated golden `report.json` files, every message in it carries `fix`, and every golden markdown file (`report.md` and the other rendered goldens) is byte-identical to the base commit
  - verify: integration
- **AC-10** Given a report with `fix` on messages and on findings of every kind of object, and its upload metadata When the upload bundle is built Then the bundle's `report.json` carries every `fix` object unchanged in kind, target and hint, redaction and the byte caps leave them intact, and the bundle's `report.json` validates against `schema/report.v2.json`
  - verify: unit
- **AC-11** Given the Action run on the streamed local diff and lcov fixtures and the CLI adapters run on the same inputs When the two reports are compared with the regenerated golden report Then both equal it, both carry `fix` on every message, and no compare API call is made
  - verify: integration
- **AC-12** Given the existing test suite, including the schema-byte pin tests that compare `schema/report.v2.json` with older commits and the whole-report comparisons When the whole suite runs with this increment Then every existing assertion passes unchanged, the pin tests strip only the `fix` additions through one shared helper in `packages/core/test/v090-codes.ts` whose stripped text equals the base commit's schema (after the earlier helpers), and no test is skipped, deleted or weakened
  - verify: integration
- **AC-13** Given the repository files When `README.md`, `CHANGELOG.md`, `docs/LIMITS.md` and `schema/report.v2.json` are read Then the README has a section headed "Fix hints" that lists the eight kinds, says what an agent may do with a hint and states that no hint lowers a gate, the CHANGELOG Unreleased section names the `fix` object, `docs/LIMITS.md` has a section on fix hints saying they are generic, per code or id, and never prove that the fix was made or was right, and the schema's descriptions of `fix`, `kind`, `target` and `hint` say what each holds and never holds
  - verify: unit

## Constraints

- `packages/core/src` stays pure: no file, process, network, clock or random access; the fix table and the helper are
  plain data and functions.
- Report v2 stays additive to v1: `fix` is optional everywhere, no field or message code is removed, renamed or retyped,
  no `required` list changes, and `schema/report.v1.json` is not changed.
- The eight kinds are the whole list, and no kind can lower a threshold, exclude a file, skip a test, add an exemption or
  change a policy; `kind` is a closed enum in the schema and in the core.
- A hint is one fixed English sentence per code or signal id, at most 200 characters, with no interpolated file text,
  diff text, test name, package name, detail text or secret; only the path, line and ids already in the finding may be
  interpolated. A `target` is only a path or `path:line` already present in the finding.
- Nothing leaves the job beyond what already leaves it: `fix` holds fixed words, ids and paths the report already
  carries, and the uploaded `report.json` carries it under the existing redaction and caps.
- No new dependency, action input, CLI flag, config key or policy key; the PR comment and job summary are unchanged.
- Existing tests are not weakened, skipped or deleted; schema-byte pins are re-pinned through one shared strip helper,
  goldens change only because reports gain `fix`, and `packages/action/dist` is rebuilt.
- Every acceptance criterion ships with fixture-based tests, and every report produced in a test validates against
  `schema/report.v2.json`.

## Data

- A fix hint: `kind` (one of the eight kinds), optional `target` (a repo-relative path, or `path:line`), `hint` (one
  fixed sentence, at most 200 characters). It belongs to exactly one message or finding.
- Kind `add-test`: `DIFF_COVERAGE_BELOW_THRESHOLD`, `TESTS_NOT_EXERCISING_CHANGES`.
- Kind `restore-test`: TI01, TI02, TI03, TI04 and their `TEST_INTEGRITY_` messages; `TEST_FILES_DELETED`.
- Kind `restore-assertion`: TI05, TI06, TI07 and their messages.
- Kind `revert-config`: TI09, TI10, TI11, TI13, TI14 and their messages; P09 and `POLICY_P09`; P13 and `POLICY_P13`.
- Kind `request-review`: TI08, TI12, TI15, TI16 and their messages; P02 to P06 and `POLICY_P02` to `POLICY_P06`; P08
  and `POLICY_P08`; P11 and `POLICY_P11`; `AGENT_CONFIG_SECRET_S01` to `AGENT_CONFIG_SECRET_S11`; PI01 to PI05 and
  `INJECTION_PI01` to `INJECTION_PI05`; `CONFIG_CHANGED_IN_DIFF`; `COVERAGE_FILE_TRACKED`; D04 and `DEPENDENCY_D04`.
- Kind `split-pr`: P14 and `POLICY_P14`.
- Kind `remove-dependency`: D01, D02, D03, D05 and `DEPENDENCY_D01`, `DEPENDENCY_D02`, `DEPENDENCY_D03`,
  `DEPENDENCY_D05`.
- Kind `none`: SI01 to SI04 and `SETUP_STALE_SI01` to `SETUP_STALE_SI04`; P01, P07, P10; `DIFF_COVERAGE_UNGATED`,
  `NO_COVERABLE_CHANGES`, `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`,
  `DIFF_UNAVAILABLE`, `COVERAGE_PATHS_UNMATCHED`, `COVERAGE_PATHS_PARTIALLY_UNMATCHED`, `COVERAGE_LINES_SKIPPED`,
  `DIFF_BINARY_COVERED_FILE`, `NO_AGENT_SETUP_FILES`, `AGENT_SETUP_FILE_EMPTY`, `AGENT_SETUP_EXPECTED_MISSING`,
  `TEST_INTEGRITY_MODE_IGNORED`, `TEST_INTEGRITY_OFF`, `TEST_INTEGRITY_INDEX_UNAVAILABLE`,
  `TEST_INTEGRITY_TEXT_TRUNCATED`, `TEST_INTEGRITY_ACCEPTED`, `TEST_INTEGRITY_ACCEPT_IGNORED`,
  `AGENT_CONFIG_SECRET_UNSCANNED`, `POLICY_UNAVAILABLE`, `POLICY_OVERRIDE_IGNORED`, `POLICY_SETTINGS_INVALID`,
  `UPLOAD_TOO_LARGE`, `AGENT_PR_DETECTION_INCOMPLETE`, `INJECTION_TEXT_TRUNCATED`, `JUNIT_NOT_FOUND`,
  `JUNIT_INVALID`, `JUNIT_TOO_LARGE`, `FLAKY_QUARANTINED_FAILURES`, `DEPENDENCY_LOOKUP_UNAVAILABLE`,
  `DEPENDENCY_CHECK_INCOMPLETE`.
- A `TEST_INTEGRITY_<id>`, `POLICY_<id>`, `INJECTION_<id>`, `SETUP_STALE_<id>` or `DEPENDENCY_<id>` message has the
  same kind as the signal id it reports; its hint may differ in wording from the signal's.

## Assumptions

- The decisions of the H6 brief are taken as given: the eight kinds, `target` only from fields already in the finding,
  one fixed sentence per code or id of at most 200 characters, the comment unchanged, pins re-pinned through a shared
  strip helper named for v0.9.0, and no new message code.
- D04 (lockfile drift) maps to `request-review`, not `remove-dependency` or `revert-config`: the honest fix is to
  regenerate the lockfile, which no kind names, and a reviewer should confirm the manifest change was meant; the hint
  may say so in fixed words. This choice is recorded in `docs/LIMITS.md`.
- P13 maps to `revert-config`: every P13 finding is, by the rule's definition, a widening of an agent's powers in a
  settings file, an MCP config, a workflow or CODEOWNERS, so reverting that edit is always the honest fix; P09 (the pull
  request loosens the policy it is graded by) maps to `revert-config` for the same reason.
- P02 to P06 map to `request-review`, not `revert-config`: their findings describe the repository's agent settings as
  they are, whether or not the pull request changed them, so the agent cannot know that a revert is the fix.
- P01, P07 and P10 map to `none`: adding agent setup files, reconciling instruction files and restoring a policy are not
  actions in the closed list.
- `CONFIG_CHANGED_IN_DIFF` and `COVERAGE_FILE_TRACKED` map to `request-review`: a config edit that TI14 did not flag and
  a committed coverage file both need a human's judgment, and no kind removes a tracked file.
- SI01 to SI04 map to `none`: editing an instruction file is not a kind in the list; the hint still names the stale
  instruction's path and line.
- The "secrets findings" of the brief are the `AGENT_CONFIG_SECRET_S01` to `AGENT_CONFIG_SECRET_S11` messages; the
  report carries no separate secrets array, so `fix` reaches them as messages, without a `target`.
- Operational codes (missing or empty coverage file, unsupported format, diff unavailable, unmatched paths, mode and
  index notices, truncation, accept label, policy unavailable or overridden, upload too large, detection incomplete,
  JUNIT and FLAKY, lookup unavailable, check incomplete) map to `none` because none is fixed by a change to the pull
  request's code.
- A `none` entry still carries a hint, so a consumer never sees an empty hint; the hint says what to look at, in fixed
  words.
- Hints avoid the banned words by wording (for example "turned off" for TI03 and TI04 rather than the banned word, and
  "add tests that run the changed lines" for coverage), and the ban is a word-boundary, case-insensitive check on the
  table's text.
- The PR comment's existing human "Hint:" lines are a separate table in the renderer and are not unified with the fix
  table in this increment; the goldens for markdown therefore do not change.
- `docs/THREAT-MODEL.md` needs no change: the increment adds no parsing of untrusted input, no new place the Action
  writes to and no new GitHub API call; `fix` holds fixed words and paths the report already carries. `SECURITY.md`'s
  data-handling list is unchanged because the uploaded `report.json` is already named there.
- The repository has no end-to-end runner, and `package.json` has a `test` script (`vitest run`), so every criterion is
  verified at unit or integration level.
- The schema-byte pin helpers follow the `v080-codes.ts` pattern, so `v090-codes.ts` strips the `fix` property
  insertions and any description sentence the schema gains; the version number names the release the change lands in.
