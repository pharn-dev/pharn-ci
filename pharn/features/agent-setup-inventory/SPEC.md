---
spec_id: agent-setup-inventory
state: Draft
spec_content_hash: ""
spec_template: pharn-default@sha256:14a54668441fb0319b46bc0e6bcc9fc5ce59bb6cf3adeada609229ca920df42e
---

## Intent

pharn-ci's agent setup inventory recognizes only the Claude Code, Cursor, Copilot and MCP files it
started with, and only at the repo root for `.claude/` and `.mcp.json`. Teams using Gemini, Codex,
Windsurf or Cline, newer Copilot files (scoped instructions, custom agents, prompt files), editor MCP
configs, or monorepos with per-package `.claude/` directories get an inventory that silently misses
files their agents actually read. This run (3 of 5 of "Finish Phase 0 of pharn-ci") completes the
inventory: it detects the remaining common agent setup files, including nested ones, and adds a short
summary of which file kinds and which agent tools the repo is set up for, so a reviewer sees at a
glance what agents in this repo are told, and a large monorepo inventory still leaves the PR comment
readable.

## Scope

**In scope:**

- New setup kinds `claude-local-md`, `gemini-md`, `copilot-instructions-scoped`, `copilot-agents`,
  `copilot-prompts`, `cursor-mcp`, `vscode-mcp`, `codex-config`, `windsurf-rules` and `cline-rules`.
- `mcp-config` matching `.mcp.json` in any directory; every `.claude/` kind and `.cursor/rules/`
  matching inside nested directories.
- A precedence rule for paths two rules could match: the more specific rule wins.
- A test that every rule is reachable and that no two rules overlap on the fixture set.
- An optional `agentSetup.summary` in schema v1 and in the report: a count of files per kind and the
  sorted, distinct list of agent tools those kinds belong to, drawn from a fixed tool list.
- A summary line above the agent setup table, and a collapsed table when the inventory has more than
  25 files.
- Documentation: README kinds table and sample comment, `docs/LIMITS.md`, schema descriptions,
  `CHANGELOG.md` Unreleased lines, and the rebuilt committed action bundle.

**Out of scope (non-goals):**

- Coverage parsing, coverage format selection and coverage exclusions (other runs of this series).
- Reading, validating or judging the content of setup files; the inventory stays a list of paths.
- Untracked or ignored files, and user-level configuration outside the repository (for example
  `~/.claude/`).
- Nested matches for `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `.cursorrules`,
  `.windsurfrules`, `.clinerules` and `.github/copilot-instructions.md`; these stay root-only.
- New message codes, new verdict logic, or any policy check on top of the inventory.
- Changing the existing comment size cap or the default row limit per table.

## Acceptance Criteria

- **AC-1** Given the repo-relative paths `CLAUDE.local.md`, `packages/web/CLAUDE.local.md`,
  `GEMINI.md` and `packages/web/GEMINI.md`
  When each path is classified
  Then the first two return `claude-local-md` and the last two return `gemini-md`
  - verify: unit
- **AC-2** Given the paths `.github/instructions/ts.instructions.md`,
  `.github/instructions/frontend/react.instructions.md`, `.github/agents/reviewer.agent.md`,
  `.github/agents/notes/extra.md`, `.github/prompts/release.prompt.md` and `.github/prompts/sub/x.md`
  When each path is classified
  Then the two instructions paths return `copilot-instructions-scoped`, the two agents paths return
  `copilot-agents`, and the two prompts paths return `copilot-prompts`, while
  `.github/instructions/notes.md` returns no kind
  - verify: unit
- **AC-3** Given the paths `.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`,
  `.windsurfrules`, `.windsurf/rules/style.md`, `.clinerules` and `.clinerules/style.md`
  When each path is classified
  Then they return `cursor-mcp`, `vscode-mcp`, `codex-config`, `windsurf-rules`, `windsurf-rules`,
  `cline-rules` and `cline-rules` respectively, while `.vscode/settings.json`, `.codex/other.toml`,
  `.windsurf/other.json`, `packages/web/.cursor/mcp.json`, `packages/web/.vscode/mcp.json` and
  `gemini.md` return no kind
  - verify: unit
- **AC-4** Given the nested paths `packages/web/.mcp.json`, `packages/web/.claude/settings.json`,
  `packages/web/.claude/settings.local.json`, `packages/web/.claude/skills/release/SKILL.md`,
  `packages/web/.claude/hooks/pre.sh`, `packages/web/.claude/agents/reviewer.md`,
  `packages/web/.claude/commands/ship.md` and `packages/web/.cursor/rules/style.mdc`
  When each path is classified
  Then they return `mcp-config`, `claude-settings`, `claude-settings-local`, `claude-skill`,
  `claude-hook`, `claude-agent`, `claude-command` and `cursor-rules` respectively
  - verify: unit
- **AC-5** Given every path the existing classification tests map to a kind, and the existing
  non-matches `README.md`, `claude.md`, `docs/CLAUDE.md.bak`, `.claude/settings.json.example`,
  `.claude/skills` and `.cursor/other.json`
  When each path is classified
  Then every previously matched path returns the same kind as before and every listed non-match
  returns no kind
  - verify: unit
- **AC-6** Given paths that both a directory rule and a file-name rule could match:
  `.github/agents/AGENTS.md`, `.claude/agents/CLAUDE.md`, `.clinerules/AGENTS.md`,
  `.claude/skills/demo/.mcp.json` and `.windsurf/rules/GEMINI.md`
  When each path is classified
  Then the more specific directory rule wins: `copilot-agents`, `claude-agent`, `cline-rules`,
  `claude-skill` and `windsurf-rules` respectively
  - verify: unit
- **AC-7** Given a fixture file in `fixtures/` listing at least one representative path for every
  setup kind
  When every classification rule is evaluated against every path in that file, and the file is scanned
  Then each path is matched by exactly one rule, and the scan returns all 21 kinds (the 11 existing
  kinds plus the 10 new ones), each at least once
  - verify: unit
- **AC-8** Given the golden repo file list `fixtures/golden/files.txt` and the golden coverage and diff
  inputs
  When `check()` builds the report
  Then `agentSetup.summary.byKind` equals `{"agents-md": 1, "claude-md": 2, "claude-settings": 1,
  "claude-skill": 1, "copilot-instructions": 1, "cursor-rules": 1, "mcp-config": 1}`,
  `agentSetup.summary.tools` equals `["claude-code", "codex", "copilot", "cursor", "mcp"]`, and the
  report validates against `schema/report.v1.json`
  - verify: unit
- **AC-9** Given an inventory containing exactly one file of a single kind
  When the summary is computed
  Then `tools` is `["claude-code"]` for `claude-md`, `claude-local-md`, `claude-settings`,
  `claude-settings-local`, `claude-skill`, `claude-hook`, `claude-agent` and `claude-command`;
  `["codex", "copilot", "cursor"]` for `agents-md`; `["cursor"]` for `cursor-rules`;
  `["cursor", "mcp"]` for `cursor-mcp`; `["copilot"]` for `copilot-instructions`,
  `copilot-instructions-scoped`, `copilot-agents` and `copilot-prompts`; `["copilot", "mcp"]` for
  `vscode-mcp`; `["codex"]` for `codex-config`; `["gemini"]` for `gemini-md`; `["windsurf"]` for
  `windsurf-rules`; `["cline"]` for `cline-rules`; and `["mcp"]` for `mcp-config`
  - verify: unit
- **AC-10** Given a repo file list with no agent setup files
  When `check()` builds and renders the report
  Then `agentSetup.summary` equals `{"byKind": {}, "tools": []}`, the `NO_AGENT_SETUP_FILES` message
  is still present, the report validates against the schema, and the markdown shows
  `_No agent setup files found._` with no line starting `Agent setup:`
  - verify: unit
- **AC-11** Given the golden inputs
  When the report is rendered as markdown
  Then the Agent setup section shows the line
  `Agent setup: 8 files · claude-code, codex, copilot, cursor, mcp` above the `| Path | Kind |`
  table header, and the output equals the updated `fixtures/golden/report.md`
  - verify: unit
- **AC-12** Given a report whose inventory is the single file `AGENTS.md`
  When it is rendered as markdown
  Then the summary line reads `Agent setup: 1 file · codex, copilot, cursor`
  - verify: unit
- **AC-13** Given reports whose inventories hold 25, 26 and 60 agent setup files
  When each is rendered as markdown with the default options
  Then the 25-file output contains no `<details>`; the 26-file output has the summary line outside and
  before a `<details>` block that contains the whole table and is closed by `</details>`; and the
  60-file output's collapsed table shows 50 file rows followed by the row
  `| _…and 10 more files_ | |`
  - verify: unit
- **AC-14** Given an otherwise valid report
  When it is validated against `schema/report.v1.json` without `agentSetup.summary`, with a summary
  whose `tools` contains `aider`, and with a summary whose `byKind` value is a string
  Then the first validates and the other two are rejected
  - verify: unit

## Constraints

- AGENTS.md governs every change: `packages/core/src` stays pure (no I/O); every core change ships
  with fixture-based tests, and every report produced in tests passes `expectValidReport`.
- Schema v1 changes are additive only: `agentSetup.summary` is optional, no field is removed, renamed
  or retyped, and the TypeScript types in `packages/core/src/report.ts` match the schema.
- Existing kind names and their existing matches stay unchanged; existing message codes are untouched.
- No existing test is weakened, skipped or deleted. Golden files change only where the output
  intentionally changes (the summary line and `agentSetup.summary`).
- The PR comment size cap (`MAX_COMMENT_LENGTH`) and the default rows-per-table limit (50) stay as they
  are; collapsing large inventories adds to them and replaces neither.
- Setup file paths come from the change under review: the summary line and the collapsed table must
  not let a path inject markdown or HTML into the PR comment, as today's table already guarantees.
- No new runtime or dev dependency.
- `packages/action/dist` is rebuilt and committed, since core is bundled into the action.
- `CHANGELOG.md` gains lines under Unreleased for the new kinds, the nested matching and the summary.

## Data

- An agent setup file is a repo-relative path plus exactly one kind.
- A kind belongs to one or more agent tools; the tool list is fixed: claude-code, cursor, copilot,
  codex, gemini, windsurf, cline, mcp.
- The summary is derived from the inventory: a count of files per kind present, and the distinct tools
  of those kinds, sorted.

## Assumptions

- The schema's `kind` stays a pattern-constrained string whose description lists the known kinds; the
  description is extended with the 10 new kinds. Turning it into a closed JSON Schema enum would retype
  the field and break the schema's own "consumers must tolerate unknown kinds" promise, which AGENTS.md
  forbids within v1.
- `tools` is a real JSON Schema enum of the eight tools, as the increment asks, because it is a new field.
- The kind-to-tools mapping beyond `mcp-config` was not given; AC-9 records the chosen mapping:
  `agents-md` maps to codex, copilot and cursor (tools that read AGENTS.md natively), and editor MCP
  configs map to their editor's tool plus mcp.
- `byKind` lists only kinds with at least one file, with keys in sorted order, and every report
  pharn-ci builds carries `agentSetup.summary`, computed from the files list.
- With an empty inventory the renderer keeps today's `_No agent setup files found._` text and shows no
  summary line (AC-10), so those outputs do not change.
- The summary line lists tools in the sorted order of `tools`; the increment's example ("claude-code,
  cursor, copilot") illustrates the format, not an order. It says "1 file" for one file and "N files"
  otherwise, and counts every file, including rows the 50-row limit hides.
- "More than 25 files" means 26 or more; at exactly 25 the table is not collapsed.
- "More specific rule wins" means a rule anchored to a directory or a full path beats a rule that
  matches a file name in any directory (AC-6).
- `.github/agents/**`, `.github/prompts/**`, `.windsurf/rules/**` and `.clinerules/**` match any file
  under the directory, as written in the increment, not only `*.agent.md` or `*.prompt.md`.
- File names match case-sensitively, as `CLAUDE.md` and `AGENTS.md` do today.
- Two cases in the existing "ignores" test, `src/.claude/settings.json` and `nested/.mcp.json`, become
  matches by this intent (nested `.claude/` and `.mcp.json` are now detected). Their expectation is
  corrected to the new kinds, not deleted, and the PR description explains why (AGENTS.md rule 4).
- The README has no kinds table today; one is added (kind, what it matches, tools), and the README's
  sample comment gains the summary line.
- `docs/THREAT-MODEL.md` needs no change: no new untrusted input is parsed, no new place is written and
  no new GitHub API call is made; the paths classified are the same `git ls-files` list as today.
- `fixtures/golden/files.txt` stays as it is; the new kinds are covered by the AC-7 fixture instead.
- The project's `test` script (`vitest run`) runs these criteria; no extra runner is needed.
