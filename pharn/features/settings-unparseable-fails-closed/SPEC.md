---
spec_id: settings-unparseable-fails-closed
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:0ac964d307ef33dc333d1eae764877b6ea5ae4006fe3fcad4dc54ed58a0478a4
---

## Intent

Review BLOCKER A3-F2: under an org policy, a pull request can loosen the policy by committing an agent settings or MCP
file that pharn-ci cannot parse but Claude Code still reads. Today such a file is graded as only a warning, so the
rules that would have blocked it (P02 forbidden permission, P04/P05 MCP server lists) never see its content, and P09
even reports the edit as "complies". Reproduced: a `.claude/settings.json` that allows `Bash(*)` and a `.mcp.json`
that adds an unlisted server, each padded with 67 nested arrays, give a `warn` verdict and exit 0 under a policy that
forbids `Bash(*)` and lists only server `ok`; Node's JSON parser (what Claude Code runs) reads both padded files and
honours them. The same files without the padding fail the check. The README promises that a file pharn-ci could not
read counts against the policy, and THREAT-MODEL row C5 claims fail-closed; both are false today for these files.

The outcome the owner of an org policy wants: a settings or MCP file the policy reads and pharn-ci cannot read or
parse always counts against the repository, whatever the policy's lists are, so no pull request can weaken its own
policy check with an unparseable or binary file.

## Scope

**In scope:**

- An agent settings file (`.claude/settings.json`, `.claude/settings.local.json`) that pharn-ci refuses as too deep
  (more than 64 nested `[` or `{`), not JSON or not a JSON object, or that is binary (a 0x00 byte or bytes that are
  not well-formed UTF-8), is an error-level settings problem whatever the policy's lists are.
- An MCP file (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) refused for the same reasons is an error-level
  settings problem whatever the policy's lists are, but still only when a rule that reads MCP files (P04 or P05) is in
  force.
- As a result, P09 blocks a pull request that edits such a file ("this change edits a file the policy could not
  check"), and the error-level `POLICY_SETTINGS_INVALID` message fails the verdict even when the pull request does not
  edit the file.
- The code comment that explains how a settings problem's level is chosen says that a file pharn-ci could not read or
  parse is an error because Claude Code may still read it.
- The existing problem-table test (AC-13 in `packages/core/test/ac-polset-problems.test.ts`) that pins today's `warn`
  for these files is updated deliberately to expect `error`, with its comments corrected (fixing a wrong test, not
  weakening it).
- New fixture-based tests with fixtures under `fixtures/policy-settings/` for the must-trigger and must-not-trigger
  cases below.
- `docs/THREAT-MODEL.md` row C5 and one `CHANGELOG.md` bullet under Unreleased → Security; `packages/action/dist`
  rebuilt.

**Out of scope (non-goals):**

- The JSON parser and its depth limit: `MAX_DEPTH` stays 64 (once the failure blocks, the limit is a safety bound, not
  a bypass).
- A repeated key stays a `duplicate-key` warning (the parser keeps the last value, as Node's JSON parser does).
- Entry-level problem classes (unknown permission syntax, deny, hooks, other entries) keep their current levels; drops
  and the compare budget stay errors.
- The binary decoder, P09, the rule evaluator, the renderer, the CLI and the Action source.
- Any schema change, new message code, new problem reason, or rewording of the `POLICY_SETTINGS_INVALID` text or of the
  schema's and README's description of its levels (pinned in tests and goldens; rewording is a separate follow-up).
- `.github/workflows/**` and the PHARN workflow tooling.

## Acceptance Criteria

- **AC-1** Given an org policy with `forbidden_permissions` `["Bash(*)"]` and `allowed_mcp_servers` `["ok"]`, a
  committed `.claude/settings.json` that allows `Bash(*)` and a committed `.mcp.json` that defines server `evil`, each
  padded with 67 nested arrays, and a pull request that edits both files When `check()` runs on the fixture Then Node's
  JSON parser accepts both padded texts, the returned report validates against the schema, its policy violations hold a
  P09 finding at severity `block` with detail "this change edits a file the policy could not check" for each of the two
  paths, its `POLICY_SETTINGS_INVALID` message has level `error` and names both paths with reason `too-deep`, and its
  verdict is `fail`
  - verify: integration
- **AC-2** Given an org policy with only `forbidden_permissions` `["Bash(*)"]` and a committed `.claude/settings.json`
  whose bytes allow `Bash(*)` and hold a 0xff byte inside a string value, which pharn-ci's text decoder refuses and
  hands to `check()` as a `binary` drop, edited by the pull request When `check()` runs Then the returned report
  validates against the schema, its `POLICY_SETTINGS_INVALID` message has level `error` and names that path with reason
  `binary`, its policy violations hold a P09 finding at severity `block` with detail "this change edits a file the
  policy could not check" for that path, and its verdict is `fail`
  - verify: integration
- **AC-3** Given an org policy with only `allowed_mcp_servers` (no required deny rule and no required hook) and a
  committed `.mcp.json` padded with 67 nested arrays, edited by the pull request When `check()` runs Then Node's JSON
  parser accepts the padded text, the returned report validates against the schema, its `POLICY_SETTINGS_INVALID`
  message has level `error` and names that path with reason `too-deep`, its policy violations hold a P09 finding at
  severity `block` with detail "this change edits a file the policy could not check" for that path, and its verdict is
  `fail`
  - verify: integration
- **AC-4** Given an org policy with only `forbidden_permissions` `["Bash(*)"]` and a committed `.claude/settings.json`
  that is not JSON, which the pull request does not edit When `check()` runs Then the returned report validates
  against the schema, its `POLICY_SETTINGS_INVALID` message has level `error` and names that path with reason
  `not-json`, its policy violations hold no P09 finding for that path, and its verdict is `fail`
  - verify: integration
- **AC-5** Given the AC-1 policy and the same two files without padding, made compliant (the settings file allows a
  permission the policy does not forbid, the MCP file defines only server `ok`), edited by the pull request When
  `check()` runs Then the returned report validates against the schema, it holds no `POLICY_SETTINGS_INVALID` message,
  and its policy violations hold a P09 finding at severity `info` with detail "this change edits a file the policy
  checks; it complies" for each of the two paths
  - verify: integration
- **AC-6** Given settings files refused as `not-json`, `not-object` and `too-deep` plus a `binary` settings drop under
  a policy with only `forbidden_permissions`, and MCP files refused for the same four reasons under a policy with only
  `allowed_mcp_servers` When `check()` runs on each Then each returned `POLICY_SETTINGS_INVALID` message has level
  `error` with its text unchanged in wording, MCP file problems are still not listed when only P02 is in force, and an
  entry with unknown permission syntax under a policy with no required list is still listed at level `warn`
  - verify: unit
- **AC-7** Given the repository documentation When `docs/THREAT-MODEL.md` and `CHANGELOG.md` are read Then row C5 says
  a settings or MCP file the parser refuses (too deep, not JSON, not an object) or that is binary is an error the policy
  counts against the repository whatever its lists, while still matching every term the existing row-C5 docs test
  requires and not holding both "duplicate" and "JSON.parse"; and the Unreleased → Security section holds one bullet
  naming review A3-F2 that says such files now fail where they warned
  - verify: unit

## Constraints

- AGENTS.md rule 1: the change stays inside pure core code; no I/O is added to `packages/core/src`.
- AGENTS.md rule 2: no change to `schema/report.v1.json` or `schema/report.v2.json`; no new message code, field or
  reason; the `POLICY_SETTINGS_INVALID` text stays word for word.
- AGENTS.md rule 3: every new test is fixture-based and validates each report it produces with `expectValidReport`.
- AGENTS.md rule 4: no existing test is weakened, skipped or deleted; the AC-13 update is a deliberate correction of a
  test that pinned the bug, listed in the PLAN's `## Files`.
- AGENTS.md rule 7: `packages/action/dist` is rebuilt with `pnpm build` because core reaches the action.
- AGENTS.md repo protection: a change in parsing behaviour on untrusted input updates `docs/THREAT-MODEL.md` in the same
  change, without renumbering or retitling any residual in §3; every user-visible change gets a CHANGELOG Unreleased
  line.
- CLAUDE.local.md: settings a pull request carries can never loosen a gate; this change closes such a loosening.
- Fixture files must not be named like an agent settings or MCP file (store them as `*.txt`), and a new test file must
  not be named `ac-polset-*.test.ts` (the existing fixtures test counts exactly 32 such files).
- No new dependency.

## Assumptions

- Under `--model-approve` no question can be asked; each point below is an informed guess a reader can challenge.
- `package.json` has a `test` script (`vitest run`), so the criteria's tests run through PHARN's gate discovery.
- The new must-trigger and must-not-trigger cases live in new case directories under `fixtures/policy-settings/`
  following the existing layout (`policy.json`, `files.json`, file contents as `*.txt`); the exact directory names are
  the PLAN's choice.
- The binary fixture really holds a 0xff byte: either stored raw and read as bytes, or built in the test from a text
  fixture plus the byte, with a comment saying why; the test turns it into a `binary` drop through core's exported text
  decoder, as `packages/node-io` does.
- The existing pin tests `packages/core/test/ac-p07-unchanged.test.ts` and `packages/core/test/ac-p11-unchanged.test.ts`
  accept new files under `fixtures/policy-settings/` only once they are tracked; while the loop runs, the new fixtures
  are untracked and those tests would fail. The PLAN may re-pin their untracked-fixture pattern to also accept
  `fixtures/policy-settings/`, marked with a comment naming this item, as the ti03-skip-evasion increment did for
  `fixtures/test-integrity/TI03/`.
- The README's sentence that a file pharn-ci could not read counts against the policy, and the README and schema
  description of `POLICY_SETTINGS_INVALID` levels ("error for a file pharn-ci could not read"), are read as covering a
  file it could not parse, so they become true with this change and are not reworded.
- The staged edits to `packages/core/src/render/markdown.ts` and four `fixtures/golden*/report.md` files present in the
  working tree when this SPEC was written are not part of this increment and are not touched by it.
- A repository with an already broken settings or MCP file under a policy that reads it now fails where it warned; this
  tightening is intended and is stated in the CHANGELOG bullet.
