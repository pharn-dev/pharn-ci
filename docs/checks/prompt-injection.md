# Prompt-injection scan

Agents read repositories, so a pull request can plant text aimed at the next agent that works there. The
prompt-injection scan (H4) reads the **added lines of the diff** and nothing else: no file is opened, and the CLI and
the Action run it on every diff, with or without an org policy, in every test-integrity mode. It is text-only and
deterministic: code point checks, `indexOf` and run-length counts, never a model and never a regex over a line.

| Signal | What it finds | Where | Default |
| ------ | ------------- | ----- | ------- |
| PI01 | Invisible or bidirectional Unicode: zero-width space, word joiner, invisible operators, a byte order mark past the start of a file, bidi embeddings, overrides and isolates (Trojan Source), the soft hyphen, the Mongolian vowel separator, tag characters (except in an emoji subdivision flag), ZWJ and ZWNJ (except between letters of a non-Latin script or inside an emoji sequence), and the directional marks U+200E, U+200F and U+061C on a line with no right-to-left letter | Added lines of any text file | `block` |
| PI02 | Hidden Markdown that addresses an agent: an HTML comment (one spanning added lines included), a reference definition such as `[//]: # (...)` or a link title holding a phrase of the list | Markdown files and agent instruction files | `warn` |
| PI03 | A known injection phrase of the versioned list (case-insensitive, white space folded, word boundaries) | Added lines of any text file | `warn` |
| PI04 | A base64 or hex run of more than 200 characters with letters and digits | Agent instruction files (the inventory's instruction kinds, skills, agents, commands, prompts and Claude Code settings) | `warn` |
| PI05 | An agent instruction file added inside `node_modules/`, `vendor/`, `third_party/`, `.venv/`, `dist/` or `bower_components/` | Added or renamed-in paths | `warn` |

The phrase list lives in `packages/core/src/injection/phrases.ts` with stable ids `PH01` to `PH32`
(`INJECTION_PHRASES_VERSION` is 1): instructions to drop earlier instructions, persona switches, secrecy towards the
user, chat-template tokens, a role marker at the start of a prose line, and, for PI02 only, phrases that address an AI
agent. A finding names the phrase id, never the line.

**Exemptions.** Every signal skips `fixtures/**`, `**/__fixtures__/**`, `**/testdata/**`, `**/*.test.*` and
`**/*.spec.*`, except that the two test-file names never exempt an agent instruction file (the kinds PI04 reads):
`.cursor/rules/a.test.mdc` and `.claude/commands/x.spec.md` are scanned like any instruction file, while the three
directories still exempt one; PI03 also skips `**/test/**` and locale files (`**/{locales,messages,i18n,lang}/**`, `*.po`, `*.arb`),
where PI01 also accepts the directional marks and the soft hyphen. An app policy can add exemptions
(`injection.exempt`), add phrases (`injection.phrases`, reported as `PX01`, `PX02`, ...) and set each signal's
severity (`injection.signals`, `off` included). A `file:` policy is carried by the pull request, so it can only
tighten: its phrases apply, its severities only raise, and its exemptions are never applied (`POLICY_OVERRIDE_IGNORED`
says so). When the pull request edits the policy file and its copy at the base commit can be read (a local diff; not with a
compare-API diff or in PR-number mode), that copy also counts: its phrases are
scanned first, so added phrases cannot push them past the 100-phrase cap, and its raised severities still apply. No workflow input and no `.pharn/ci.yml` key changes the scan.

**How a block fails the check.** Each signal adds one `INJECTION_PI01` to `INJECTION_PI05` message whose level follows
its findings' severity, the way the agent config secret check does: `block` is an `error` and the verdict is `fail`,
`warn` a warning. Neither the test-integrity mode nor the accept label lowers it. The findings go into the report's
optional `injection.signals` (id, severity, path, line, detail; present only when there is one) and into the
comment's 🧬 Content section, each with a hint. A message names up to 5 paths and lines; a detail is a character's
fixed name and code point (`right-to-left override U+202E`), a phrase id, a run length or a kind and directory, never
file text.

**Caps.** The scan keeps the first 50,000 added lines of a file and two budgets of 8,000,000 characters of added text
in the whole diff: one for agent instruction files and Markdown files (`.md`, `.mdx`, `.markdown`, `.mdc`), one for
every other file, so a large generated file cannot use up the budget that guards `AGENTS.md`. It lists 20 findings per
signal and file and 200 in all (the messages count the rest), and matches at most 100 policy phrases. A file it could
not read in full is named in `INJECTION_TEXT_TRUNCATED`: an `error` (verdict `fail`) when an instruction or Markdown
file was cut, a `warn` when only other files were (a 9 MB bundle). What it misses
(encodings, homoglyphs, instructions split across lines, images, unchanged lines) is in
[docs/LIMITS.md](../LIMITS.md#prompt-injection-scan).
