---
spec_id: agent-setup-inventory
spec_content_hash: fcf580fe5b5310ae1e48dfd5f7ab06254d1f5c76578465a09bfe301880196be9
applied_lessons: none
---

## Approach

ADVISORY — model work, derived from the Approved SPEC (`pharn/ARCHITECTURE.md §6` plan stage).

1. **Rule table instead of two lookup structures.** `packages/core/src/setup/scan.ts` replaces `DIR_KINDS` /
   `EXACT_KINDS` / the basename branch with one exported, ordered rule list `SETUP_RULES`, each rule
   `{ kind: AgentSetupKind; matches(path: string): boolean }`. `classifySetupPath` returns the kind of the
   **first** rule that matches, else `null`. Precedence (SPEC AC-6, "more specific wins") is the list order: every
   rule anchored to a directory or a full path comes first; the five file-name-anywhere rules (`CLAUDE.md`,
   `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md`, `.mcp.json`) come last. The rule list is also what the AC-7 test
   evaluates rule by rule.
2. **Summary as a pure derivation in its own file.** A new `packages/core/src/setup/summary.ts` holds the fixed tool
   list (`AGENT_TOOLS`), the kind→tools table (exactly the mapping SPEC AC-9 records) and
   `summarizeAgentSetup(files)`, which returns `{ byKind, tools }`: counts only for kinds present, keys inserted in
   sorted order, and the distinct tools of those kinds, sorted with the default string sort.
3. **The report always carries it.** `buildReport` sets `agentSetup: { files, summary: summarizeAgentSetup(files) }`,
   so `check()` needs no change and every report pharn-ci builds has the summary. The TypeScript type marks
   `summary` optional, mirroring the schema, where it is an optional, additive v1 field.
4. **Renderer.** With a non-empty inventory the Agent setup section starts with
   `Agent setup: <N> file|files · <tools joined by ", ">`, then a blank line, then the table. Above 25 files the
   table (rows, the existing 50-row cap and its `| _…and K more files_ | |` row) is wrapped in a `<details>` block
   placed after the summary line. The line is built from `summarizeAgentSetup(report.agentSetup.files)`, so it holds
   only a count, fixed words and names from the fixed tool list: nothing input-derived reaches it.
5. **Schema, docs, bundle.** Additive schema change, README kinds table and sample comment, `docs/LIMITS.md` §4,
   CHANGELOG Unreleased lines, rebuilt `packages/action/dist/index.js`.

## Applied lessons

- none — the project has no memory-bank yet (`check-lessons-index.mjs --verdict` printed `NO_CANON`; there is no
  `memory-bank/lessons-learned.md`), so there are no lessons to apply.

## Steps

1. **`packages/core/src/setup/scan.ts`**
   - Extend `AgentSetupKind` with `claude-local-md`, `gemini-md`, `copilot-instructions-scoped`, `copilot-agents`,
     `copilot-prompts`, `cursor-mcp`, `vscode-mcp`, `codex-config`, `windsurf-rules`, `cline-rules` (21 kinds).
   - Export `interface SetupRule { kind: AgentSetupKind; matches(path: string): boolean }` and
     `SETUP_RULES: readonly SetupRule[]`, in this order:
     - directory / full-path tier, nested allowed (`^` or a `/` before the anchor): `.claude/settings.json` →
       claude-settings; `.claude/settings.local.json` → claude-settings-local; `.claude/skills/<1+ chars>` →
       claude-skill; same for `hooks` → claude-hook, `agents` → claude-agent, `commands` → claude-command;
       `.cursor/rules/<1+ chars>` → cursor-rules.
     - directory / full-path tier, repo root only: `.cursorrules` → cursor-rules;
       `.github/copilot-instructions.md` → copilot-instructions; `.github/instructions/…/<name>.instructions.md`
       (any depth) → copilot-instructions-scoped; `.github/agents/<1+ chars>` → copilot-agents;
       `.github/prompts/<1+ chars>` → copilot-prompts; `.cursor/mcp.json` → cursor-mcp; `.vscode/mcp.json` →
       vscode-mcp; `.codex/config.toml` → codex-config; `.windsurfrules` and `.windsurf/rules/<1+ chars>` →
       windsurf-rules; `.clinerules` and `.clinerules/<1+ chars>` → cline-rules.
     - file-name-anywhere tier (last): base name exactly `CLAUDE.md` → claude-md, `CLAUDE.local.md` →
       claude-local-md, `AGENTS.md` → agents-md, `GEMINI.md` → gemini-md, `.mcp.json` → mcp-config.
   - Match with string operations (`startsWith`, `endsWith`, `indexOf`, `===` on the base name), or with regexes
     using the `s` flag / `[^]`. A plain `.` does **not** match `\n`, `\r`, ` `, ` `, and the existing
     hostile-path test feeds `.claude/skills/a\r\n| injected | row |` and `.claude/commands/x ## heading`,
     which must stay `claude-skill` / `claude-command` (SPEC Constraints: existing matches unchanged).
   - Matching is case-sensitive; `.claude/skills` with nothing after the slash stays unmatched;
     `.claude/settings.json.example` stays unmatched (full-path rules match to the end of the path).
   - `classifySetupPath` = first matching rule's kind, else `null`. `scanAgentSetup` unchanged in shape.
2. **`packages/core/src/setup/summary.ts`** (new, pure, no I/O)
   - `export const AGENT_TOOLS = ["claude-code", "cursor", "copilot", "codex", "gemini", "windsurf", "cline", "mcp"] as const`
     and `type AgentTool`.
   - A `Record<AgentSetupKind, readonly AgentTool[]>` with exactly the SPEC AC-9 mapping.
   - `export interface AgentSetupSummary { byKind: Partial<Record<AgentSetupKind, number>>; tools: AgentTool[] }`.
   - `export function summarizeAgentSetup(files: readonly AgentSetupFile[]): AgentSetupSummary`: count per kind,
     build `byKind` by inserting the present kinds in sorted order, `tools` = sorted distinct union. Empty input →
     `{ byKind: {}, tools: [] }`.
3. **`packages/core/src/report.ts`**: `Report.agentSetup` becomes
   `{ files: AgentSetupFile[]; summary?: AgentSetupSummary }`; `buildReport` always fills `summary`. The
   `NO_AGENT_SETUP_FILES` message and its text stay as they are.
4. **`packages/core/src/render/markdown.ts`**: in the Agent setup section, when files exist:
   - push `Agent setup: ${n} ${n === 1 ? "file" : "files"} · ${tools.join(", ")}` and `""`;
   - if `n > 25` (a module constant; `maxRows` keeps its default of 50 and stays the only option): push `<details>`,
     `<summary>Show all ${n} agent setup files</summary>`, `""`, the table as today (header, up to `maxRows`
     rows, the `| _…and K more files_ | |` row), `""`, `</details>`, `""`;
   - else the table as today. Empty inventory: unchanged `_No agent setup files found._`, no summary line.
   - Paths keep going through `code()`; the summary text holds no input-derived text.
5. **`packages/core/src/index.ts`**: also export `SETUP_RULES`, `type SetupRule`, `summarizeAgentSetup`,
   `AGENT_TOOLS`, `type AgentTool`, `type AgentSetupSummary`.
6. **`schema/report.v1.json`** (additive within v1):
   - `agentSetup.properties.summary`: `{ "$ref": "#/$defs/agentSetupSummary" }`, not added to `required`.
   - `$defs.agentSetupSummary`: object, `additionalProperties: false`, `required: ["byKind", "tools"]`;
     `byKind`: object, `propertyNames: { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" }`,
     `additionalProperties: { "type": "integer", "minimum": 1 }`; `tools`: array, `uniqueItems: true`,
     `items: { "enum": [the 8 tools] }`. Descriptions say both are derived from `files`, that `byKind` lists only
     present kinds, and that `tools` is sorted and drawn from a fixed list.
   - `agentSetupFile.kind` description lists the 10 new kinds; the pattern and "consumers must tolerate unknown
     kinds" stay.
   - Keep Ajv `strict: true` (in `packages/core/test/schema.ts`) compiling: give `propertyNames` an explicit `type`.
7. **`fixtures/setup/all-kinds.txt`** (new): one repo-relative path per line, no blank or comment lines, read by the
   AC-7 test as `fixture("setup/all-kinds.txt").trim().split("\n")`. Every path is matched by exactly one rule,
   and every rule matches at least one path. Content:
   `.claude/agents/reviewer.md`, `.claude/commands/ship.md`, `.claude/hooks/pre.sh`, `.claude/settings.json`,
   `.claude/settings.local.json`, `.claude/skills/release/SKILL.md`, `.clinerules`, `.clinerules/style.md`,
   `.codex/config.toml`, `.cursor/mcp.json`, `.cursor/rules/style.mdc`, `.cursorrules`,
   `.github/agents/reviewer.agent.md`, `.github/copilot-instructions.md`, `.github/instructions/ts.instructions.md`,
   `.github/prompts/release.prompt.md`, `.mcp.json`, `.vscode/mcp.json`, `.windsurf/rules/style.md`,
   `.windsurfrules`, `AGENTS.md`, `CLAUDE.local.md`, `CLAUDE.md`, `GEMINI.md`,
   `packages/web/.claude/settings.json`, `packages/web/.mcp.json` (one per line).
8. **`packages/core/test/scan.test.ts`**: move `src/.claude/settings.json` (→ `claude-settings`) and
   `nested/.mcp.json` (→ `mcp-config`) from the "ignores" list to the matches table. The expectation is corrected,
   not deleted (SPEC Assumptions; AGENTS.md rule 4: the PR description must say why). Nothing else in it changes.
9. **Goldens and snapshot**: regenerate only the affected files with
   `pnpm vitest run -u packages/core/test/golden.test.ts packages/core/test/markdown.test.ts`, then review the diff.
   Expected changes: `fixtures/golden/report.json` gains `agentSetup.summary` (AC-8 values),
   `fixtures/golden/report.md` gains `Agent setup: 8 files · claude-code, codex, copilot, cursor, mcp` and a blank
   line above the table (AC-11), and the `renders the no-coverable-changes state` snapshot gains
   `Agent setup: 1 file · codex, copilot, cursor`. `fixtures/golden/files.txt` stays as it is.
10. **Docs**: README — the "What pharn-ci is" bullet lists the new files; add a kinds table (kind, what it matches,
    tools); the sample comment gains `> Agent setup: 3 files · claude-code, codex, copilot, cursor` and a blank `>`
    line above its table. `docs/LIMITS.md` §4 — the detected-kinds bullet lists the new kinds, which kinds match in
    nested directories, which stay root-only (`.cursor/mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`,
    `.cursorrules`, `.windsurfrules`, `.clinerules`, `.github/…`), and the precedence rule. `CHANGELOG.md`
    Unreleased → Added: the new kinds, nested `.mcp.json` / `.claude/` / `.cursor/rules/` matching, the
    `agentSetup.summary` field, and the summary line plus collapsed table above 25 files.
11. **Gates**: `pnpm lint`, `pnpm test`, then `pnpm build` and keep the regenerated `packages/action/dist/index.js`
    (AGENTS.md rule 7). `pnpm build` also writes the git-ignored `packages/core/dist` and `packages/cli/dist`.

## Files

> The build's writes-scope. AC test files are not here; they are in AC-TESTS.md.

- `packages/core/src/setup/scan.ts` — 10 new kinds, exported ordered `SETUP_RULES`, nested matching, precedence
- `packages/core/src/setup/summary.ts` — new: `AGENT_TOOLS`, kind→tools table, `summarizeAgentSetup`
- `packages/core/src/report.ts` — `agentSetup.summary` type and its computation in `buildReport`
- `packages/core/src/render/markdown.ts` — summary line, `<details>` collapse above 25 files
- `packages/core/src/index.ts` — export the new public API
- `schema/report.v1.json` — optional `agentSetup.summary`, `$defs.agentSetupSummary`, kind description
- `fixtures/setup/all-kinds.txt` — new: representative path per rule for the AC-7 test
- `fixtures/golden/report.json` — regenerated: gains `agentSetup.summary`
- `fixtures/golden/report.md` — regenerated: gains the summary line
- `packages/core/test/scan.test.ts` — two former non-matches corrected to their new kinds
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: no-coverable-changes snapshot gains the summary line
- `packages/action/dist/index.js` — rebuilt bundle (core is bundled into the action)
- `README.md` — inventory bullet, kinds table, sample comment summary line
- `docs/LIMITS.md` — §4 detected kinds, nested vs root-only, precedence
- `CHANGELOG.md` — Unreleased lines for kinds, nested matching, summary

### Explicitly not touched

- `packages/core/src/check.ts` — already passes the scan to `buildReport`, which now adds the summary
- `packages/cli/src/main.ts` — gathers `git ls-files` as today; no new input or output
- `packages/action/src/run.ts` — no new write place or API call
- `fixtures/golden/files.txt` — stays as it is (SPEC Assumptions)
- `docs/THREAT-MODEL.md` — no new untrusted input, write place or API call (SPEC Assumptions)
- `packages/core/test/markdown.test.ts` — the hostile-path test must keep passing unchanged
- `packages/core/test/golden.test.ts` — unchanged; only its file snapshots are regenerated
- `packages/core/test/report.test.ts` — unchanged
- `vitest.config.ts` — test infrastructure, out of scope
- `package.json` — no new dependency

## Acceptance mapping

- AC-1 → step 1: `CLAUDE.local.md` / `GEMINI.md` file-name rules in the last tier.
- AC-2 → step 1: root `.github/instructions/` rule requires the `.instructions.md` suffix; `.github/agents/` and
  `.github/prompts/` accept any file under them.
- AC-3 → step 1: root-only full-path rules for the editor MCP configs, Codex, Windsurf and Cline; nested copies and
  `gemini.md` (case) stay unmatched.
- AC-4 → step 1: `.mcp.json` in the file-name tier; `.claude/*` and `.cursor/rules/` rules accept a `/`-prefixed anchor.
- AC-5 → step 1 keeps every previous match and non-match except the two the SPEC re-classifies (step 8).
- AC-6 → step 1 ordering: directory tier before file-name tier.
- AC-7 → steps 1 and 7: `SETUP_RULES` evaluated one by one over `fixtures/setup/all-kinds.txt`; 21 kinds via
  `scanAgentSetup`.
- AC-8 → steps 2, 3, 9: `check()` on the golden inputs yields the stated `byKind` / `tools`; schema step 6.
- AC-9 → step 2: the kind→tools table.
- AC-10 → steps 2–4: empty summary, message kept, no summary line.
- AC-11 → steps 4 and 9: summary line above the header; golden `report.md` regenerated.
- AC-12 → step 4: singular "file", tools `codex, copilot, cursor`.
- AC-13 → step 4: `> 25` collapses; 50-row cap and the "more files" row inside `<details>`.
- AC-14 → step 6: optional `summary`, `tools` enum, integer `byKind` values.

## Risks & open questions

- **Red run (for `/pharn-test`, per `pharn/pharn-contracts/ac-tests.md`, "The red run").** A leaf whose title starts
  `AC-<n>:` and PASSES before the build REDs the run (`ac-test-passes-before-build`). Several criteria contain parts
  that already hold today (AC-2's and AC-3's non-matches, AC-5 entirely, AC-13's 25-file case, AC-14's first two
  cases). So write **one `it` per AC** (no per-path `it.each` leaves), import the target **inside the test body**
  (`await import("../src/…")`), and use no `toMatchSnapshot` / `toMatchFileSnapshot` in the AC tests, so the build's
  `-u` cannot rewrite their expectations. Two ACs need a new-behavior assertion to fail first:
  - AC-5: for each listed path, also assert that the first rule in `SETUP_RULES` matching it has the expected kind,
    and that no rule matches a listed non-match. The classifier must follow its own rule table, and `SETUP_RULES`
    does not exist before the build.
  - AC-14: also assert that the same report with a well-formed `summary` validates, so the two rejections are shown
    to come from the bad `tools` value and the string count, not from `summary` being an unknown property (today
    `agentSetup` has `additionalProperties: false`).
- **Line terminators in paths.** See step 1. A regex `.` would quietly drop the hostile paths from the inventory and
  fail `markdown.test.ts`.
- **Root-only `.github/` kinds.** The SPEC lists neither nested matching nor root-only status for
  `.github/instructions/`, `.github/agents/` and `.github/prompts/`; its ACs use root paths only. Planned root-only
  (GitHub reads `.github/` at the root), like `.github/copilot-instructions.md`. Flag for `/pharn-grill`.
- **`.clinerules` as file and directory** both appear in the AC-7 fixture. A real tree cannot hold both, but the
  fixture is a path list, so this is fine.
- **Ajv strict mode** may reject a `propertyNames` schema without `type`; step 6 gives it one. Run the schema tests.
- **AGENTS.md rule 4.** The `scan.test.ts` correction must be explained in the PR description by whoever opens the PR.
- **Within-tier overlaps** (e.g. `.claude/skills/x/.claude/settings.json`) are decided by list order. The SPEC covers
  only directory-vs-file-name overlap (AC-6); nothing tests within-tier order.
