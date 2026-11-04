---
spec_id: settings-unparseable-fails-closed
spec_content_hash: 5632523d7377c37e44883fe24a9a1f539b46368a51fcfe947811b566ea96fb0b
applied_lessons: none
---

## Approach

> ADVISORY: this plan is model work. Only the gates named in `/pharn-plan` are floor-checked.

The bug sits in one function. `settingsProblemLevel()` in `packages/core/src/policy/rules/problems.ts` picks the
level of each settings problem from the problem's `problemClass`, which `readSettingsModel()` in
`packages/core/src/policy/settings/model.ts` sets:

- `drop` (too-large, caps, unsafe-path, symlink) → always `error`.
- `unparseable-settings` (a settings file refused as `not-json`, `not-object` or `too-deep`, or a `binary` settings
  drop) → `error` only when `required_permissions_deny` or `required_hooks` is set, else `warn`.
- `unparseable-mcp` (an MCP file refused for the same four reasons) → falls to `default` → always `warn`.

Everything downstream already fails closed once the level is `error`:

- `evaluatePolicyRules()` (`policy/rules/evaluate.ts`) puts every path with an error-level reported problem into
  `view.uncheckable`.
- `detectP09()` (`policy/rules/p09.ts`) class 4 then gives `block` with "this change edits a file the policy could not
  check" for an edited path, before it looks at `guarded` or "complies".
- `settingsInvalidMessage()` (`policy/rules/messages.ts`) gives the message level `error` when any problem is
  `error`, with the text unchanged.
- `buildReport` (`report.ts`, `messages.some((m) => m.level === "error")` → `fail`) fails the verdict.

So the fix is a level change only: `unparseable-settings` and `unparseable-mcp` both return `error`, whatever the
policy's lists. The reader filter is unchanged: `reportedProblems()` still keeps only problems whose `readers`
include a rule in force, and `readSettingsModel()` still parses MCP files only when `allowed_mcp_servers` or
`forbidden_mcp_servers` is set. MCP problems (readers `P04`/`P05`) therefore still appear only when P04 or P05 is in
force, as the SPEC's scope requires. Entry-level classes (`allow-syntax`, `deny`, `hooks`, `other`, which includes
`duplicate-key`) keep their levels. `MAX_DEPTH` stays 64.

No schema, message code, reason or text changes. The README sentence ("a file pharn-ci could not read counts against
the policy") and the README/schema level description become true as written (SPEC Assumptions). No new I/O in core.

The existing AC-13 problem-table test pins today's buggy `warn` for unparseable settings without a required list and
for unparseable MCP files. It is corrected on purpose to `error`, and its comments are fixed with a re-pin comment
naming this item (AGENTS.md rule 4: fixing a wrong test, not weakening it).

The new fixtures go under `fixtures/policy-settings/unparseable/`. The two pin tests `ac-p07-unchanged` and
`ac-p11-unchanged` reject untracked fixtures outside their allowlist, and these fixtures stay untracked until the loop
commits. So their untracked-fixture regex gains `^fixtures\/policy-settings\/unparseable\/[^\t]+$`, with a comment
naming this item, as ti03-skip-evasion did for `fixtures/test-integrity/TI03/`. The tracked-diff regex already
accepts `A\tfixtures/policy-settings/…`. The pattern is narrowed to the new subdirectory rather than all of
`fixtures/policy-settings/`, so an untracked file elsewhere in that tree still fails the pin.

`policy-settings-fixtures.test.ts` iterates only `p0[2-6]` directories, and `ac-polset-fixtures` AC-32 checks only
`p02`–`p06` case directories and counts `ac-polset-*.test.ts` files. So a sibling `unparseable/` directory and AC
test files named `ac-unparseable-*` leave both untouched. Fixture files are stored as `*.txt`, `*.json` (policy and
map) and `*.diff`, never under an agent settings or MCP file name.

## Applied lessons

- none — the lessons index verdict is NO_CANON: this project has no `pharn/memory-bank/lessons-learned.md` yet, so
  there is no lesson to cite.

## Steps

- `packages/core/src/policy/rules/problems.ts`: in `settingsProblemLevel()`, return `"error"` for `drop`,
  `unparseable-settings` and `unparseable-mcp` together. Keep `deny` and `hooks` as they are and `default` as `warn`.
  Rewrite the doc comment to say how the level is chosen:
  - A file pharn-ci could not read (a drop) or could not parse (too deep, not JSON, not an object, binary) is an
    error whatever the lists, because Claude Code may still read it.
  - Deny and hook entry problems are errors when their required list is set.
  - Every other entry problem warns.
- `packages/core/test/ac-polset-problems.test.ts` (AC-13, deliberate re-pin): add a comment line naming
  "settings-unparseable-fails-closed (review A3-F2)", then:
  - the first comment ("MCP files warn") now says unparseable MCP files are errors too;
  - the `settingsWarn` case (`P02_ONLY`, unparseable settings plus the binary drop) expects `error`, keeping the same
    `textOf(...)`, and its comment says that unparseable settings files are errors without a required list too
    (rename the variable, e.g. `settingsNoList`);
  - the `mcpWarn` case expects `error` with the same text, and its comment says "An unparseable MCP file is an error"
    (rename, e.g. `mcpOnly`).

  The entry-level assertions (`p02Entries` warn, `denyRun`, the `[]` case) are unchanged.
- `packages/core/test/ac-p07-unchanged.test.ts` and `packages/core/test/ac-p11-unchanged.test.ts`: append
  `|^fixtures\/policy-settings\/unparseable\/[^\t]+$` to the untracked-fixture regex only, with a comment line
  "Re-pinned for settings-unparseable-fails-closed (review A3-F2): its new case directories under
  fixtures/policy-settings/unparseable/ are untracked until committed."
- Fixtures under `fixtures/policy-settings/unparseable/`, each case directory with `policy.json` (a policy document),
  `files.json` (repo path → fixture file name, the existing layout) and, where the PR edits the files, `pr.diff`: a
  small unified diff in `git diff` shape that modifies each mapped path.
  - The padded texts put 67 nested arrays under one extra key (for example `"pad": [[[…]]]`), so the nesting is 68,
    above 64. They hold no secret-shaped value.
  - The binary case stores plain text with one ASCII marker character inside a string value. The AC-2 test turns
    that byte into 0xff before calling core's exported `decodeTestSourceText()`, which returns `null`. It then passes
    `{ path, reason: "binary" }` as a drop, as `packages/node-io/src/testSources.ts` does. The test carries a comment
    saying why: a raw 0xff byte is kept out of git, the diff tools and the secret scanners.
- `docs/THREAT-MODEL.md` row C5: after "a drop is an `error` the policy counts against the repository (fail-closed)",
  add a sentence saying that a settings or MCP file the parser refuses (deeper than 64, not JSON, not an object), or
  that is binary, is likewise an `error` the policy counts against the repository whatever its lists, because Claude
  Code may still read it (review A3-F2). For MCP files this holds only when P04 or P05 is in force.
  - Keep every term the row-C5 docs test needs (settings, MCP, HEAD, symlink, 64, budget, "never echoed").
  - Keep the existing `duplicate-key` warning sentence, and never write the string `JSON.parse` in the row.
  - Keep the "Enforced today" status. No §3 residual is renumbered or retitled.
- `CHANGELOG.md` Unreleased → `### Security`: one bullet naming review A3-F2. It says that under an org policy, an
  agent settings or MCP file pharn-ci cannot parse (too deep, not JSON, not an object) or that is binary now fails
  the check where it warned. It says that P09 blocks a PR that edits such a file, and that a repository with an
  already broken file now fails (intended).
- Run `pnpm build` (rebuilds `packages/action/dist/index.js`), then `pnpm lint` and `pnpm test`.

## Files

- `packages/core/src/policy/rules/problems.ts` — `settingsProblemLevel()`: unparseable settings and MCP files are errors; doc comment rewritten
- `packages/core/test/ac-polset-problems.test.ts` — AC-13 re-pinned on purpose from `warn` to `error` for unparseable files, comments corrected, re-pin comment naming this item
- `packages/core/test/ac-p07-unchanged.test.ts` — untracked-fixture regex also accepts `fixtures/policy-settings/unparseable/`, with a re-pin comment
- `packages/core/test/ac-p11-unchanged.test.ts` — untracked-fixture regex also accepts `fixtures/policy-settings/unparseable/`, with a re-pin comment
- `fixtures/policy-settings/unparseable/violates-padded-both/policy.json` — `forbidden_permissions` `["Bash(*)"]`, `allowed_mcp_servers` `["ok"]` (AC-1)
- `fixtures/policy-settings/unparseable/violates-padded-both/files.json` — maps `.claude/settings.json` and `.mcp.json` (AC-1)
- `fixtures/policy-settings/unparseable/violates-padded-both/claude-settings.json.txt` — allows `Bash(*)`, padded with 67 nested arrays (AC-1)
- `fixtures/policy-settings/unparseable/violates-padded-both/mcp.json.txt` — defines server `evil`, padded with 67 nested arrays (AC-1)
- `fixtures/policy-settings/unparseable/violates-padded-both/pr.diff` — edits both paths (AC-1)
- `fixtures/policy-settings/unparseable/violates-binary-settings/policy.json` — only `forbidden_permissions` `["Bash(*)"]` (AC-2)
- `fixtures/policy-settings/unparseable/violates-binary-settings/files.json` — maps `.claude/settings.json` (AC-2)
- `fixtures/policy-settings/unparseable/violates-binary-settings/claude-settings.json.txt` — allows `Bash(*)`, one ASCII marker inside a string value that the test turns into 0xff (AC-2)
- `fixtures/policy-settings/unparseable/violates-binary-settings/pr.diff` — edits `.claude/settings.json` (AC-2)
- `fixtures/policy-settings/unparseable/violates-padded-mcp-only/policy.json` — only `allowed_mcp_servers` (AC-3)
- `fixtures/policy-settings/unparseable/violates-padded-mcp-only/files.json` — maps `.mcp.json` (AC-3)
- `fixtures/policy-settings/unparseable/violates-padded-mcp-only/mcp.json.txt` — an MCP file padded with 67 nested arrays (AC-3)
- `fixtures/policy-settings/unparseable/violates-padded-mcp-only/pr.diff` — edits `.mcp.json` (AC-3)
- `fixtures/policy-settings/unparseable/violates-not-json-unedited/policy.json` — only `forbidden_permissions` `["Bash(*)"]` (AC-4)
- `fixtures/policy-settings/unparseable/violates-not-json-unedited/files.json` — maps `.claude/settings.json` (AC-4)
- `fixtures/policy-settings/unparseable/violates-not-json-unedited/claude-settings.json.txt` — text that is not JSON (AC-4; the test uses `fixtures/golden/pr.diff`, which does not touch it)
- `fixtures/policy-settings/unparseable/complies-unpadded/policy.json` — the AC-1 policy (AC-5)
- `fixtures/policy-settings/unparseable/complies-unpadded/files.json` — maps `.claude/settings.json` and `.mcp.json` (AC-5)
- `fixtures/policy-settings/unparseable/complies-unpadded/claude-settings.json.txt` — allows a permission the policy does not forbid, no padding (AC-5)
- `fixtures/policy-settings/unparseable/complies-unpadded/mcp.json.txt` — defines only server `ok`, no padding (AC-5)
- `fixtures/policy-settings/unparseable/complies-unpadded/pr.diff` — edits both paths (AC-5)
- `fixtures/policy-settings/unparseable/levels/policy-p02.json` — only `forbidden_permissions` (AC-6)
- `fixtures/policy-settings/unparseable/levels/policy-mcp.json` — only `allowed_mcp_servers` (AC-6)
- `fixtures/policy-settings/unparseable/levels/settings-not-json.txt` — a settings text refused as `not-json` (AC-6)
- `fixtures/policy-settings/unparseable/levels/settings-not-object.txt` — a settings text refused as `not-object` (AC-6)
- `fixtures/policy-settings/unparseable/levels/settings-too-deep.txt` — a settings text refused as `too-deep` (AC-6)
- `fixtures/policy-settings/unparseable/levels/settings-binary.txt` — a settings text with one marker the test turns into 0xff, a `binary` drop (AC-6)
- `fixtures/policy-settings/unparseable/levels/mcp-not-json.txt` — an MCP text refused as `not-json` (AC-6)
- `fixtures/policy-settings/unparseable/levels/mcp-not-object.txt` — an MCP text refused as `not-object` (AC-6)
- `fixtures/policy-settings/unparseable/levels/mcp-too-deep.txt` — an MCP text refused as `too-deep` (AC-6)
- `fixtures/policy-settings/unparseable/levels/mcp-binary.txt` — an MCP text with one marker the test turns into 0xff, a `binary` drop (AC-6)
- `fixtures/policy-settings/unparseable/levels/settings-unknown-allow.txt` — a settings file with one allow entry of unknown permission syntax (AC-6)
- `docs/THREAT-MODEL.md` — row C5: a refused or binary settings or MCP file is an error counted against the repository whatever the lists
- `CHANGELOG.md` — one Unreleased → Security bullet naming review A3-F2
- `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`, AGENTS.md rule 7)

### Explicitly not touched

- `packages/core/src/policy/settings/json.ts` — the parser and `MAX_DEPTH` 64 stay as they are
- `packages/core/src/policy/settings/model.ts` — problem classes and readers are unchanged; only their level changes
- `packages/core/src/policy/rules/p09.ts` — already blocks an edited path in `uncheckable`
- `packages/core/src/policy/rules/evaluate.ts` — already builds `uncheckable` from error-level problems
- `packages/core/src/policy/rules/messages.ts` — the `POLICY_SETTINGS_INVALID` text stays word for word
- `packages/core/src/testSourceText.ts` — the binary decoder is reused as it is
- `packages/core/src/render/markdown.ts` — out of scope; the staged edits in the working tree are not this increment's
- `fixtures/golden/report.md` — staged edits in the working tree are not this increment's
- `schema/report.v1.json` — no schema change
- `schema/report.v2.json` — no schema change
- `README.md` — its sentences become true as written; no rewording
- `packages/cli/src/main.ts` — no CLI change
- `packages/action/src/run.ts` — no Action source change
- `packages/core/test/policy-settings-fixtures.test.ts` — iterates only `p0[2-6]`; unaffected
- `packages/core/test/ac-polset-fixtures.test.ts` — checks `p02`–`p06` and counts 32 `ac-polset-*` files; unaffected

## Acceptance mapping

- AC-1 → the padded settings and MCP files are refused as `too-deep` with classes `unparseable-settings` and
  `unparseable-mcp` (P04 in force, so the MCP file is read). The new `error` level puts both paths in `uncheckable`,
  so P09 class 4 blocks each edited path with "could not check". The message is `error`, naming both `too-deep`, and
  the verdict is `fail`. The test also asserts `JSON.parse` accepts both fixture texts.
- AC-2 → `decodeTestSourceText` returns `null` for the 0xff bytes, giving a `binary` drop of class
  `unparseable-settings`. Under P02 only it was `warn` and is now `error`, so P09 blocks, the message is `error` and
  the verdict is `fail`.
- AC-3 → with only `allowed_mcp_servers`, the padded `.mcp.json` is `unparseable-mcp` (was always `warn`) and is now
  `error`, so P09 blocks, the message is `error` and the verdict is `fail`.
- AC-4 → the not-JSON settings file is `error` under P02 only; the message is `error` and the verdict is `fail`. The
  golden diff does not touch the file, so there is no P09 finding for it.
- AC-5 → the compliant, unpadded files parse, so there is no problem and no message. The policy lists are set
  (`guarded`), so P09 is `info` "it complies" for each edited path.
- AC-6 → each of the four reasons, for settings (P02 only) and MCP (`allowed_mcp_servers` only), gives a message at
  `error` whose text equals the binding `P02–P06 could not fully use these agent settings files: … counts against
  the policy.` form. With P02 only, MCP problems are absent (MCP files are not parsed, and MCP binary drops are
  filtered by readers). The unknown allow entry under P02 only is still `warn` (class `allow-syntax`, unchanged).
- AC-7 → the THREAT-MODEL row C5 sentence and the CHANGELOG Security bullet from Steps. The row keeps every term the
  existing row-C5 docs test (`ac-polset-docs.test.ts` AC-30) requires, without "JSON.parse".

## Risks & open questions

- Other existing tests could build an unparseable settings or MCP file under a policy and expect `warn` or a
  non-failing verdict. Discovery grepped the test tree for the refusal reasons and found only AC-13 pinning the level.
  The renderer tests use synthetic messages, and `ac-polset-messages` and `ac-polset-duplicate-deny` use entry-level
  problems that keep `warn`. If `/pharn-regress` finds another test that pinned the bug, it is corrected the same way
  (deliberate re-pin with a comment naming this item), and it must first be added to `## Files` here.
- `P02` is always in force under a policy (`on("P02", true)`), so an unparseable settings file now fails any policy
  with a document, even one with no `setup` lists. This matches the SPEC's "whatever the policy's lists are" and is
  stated in the CHANGELOG bullet.
- Fixture names and the exact padding shape are advisory. The build may rename fixtures inside
  `fixtures/policy-settings/unparseable/` only by updating this list first.
