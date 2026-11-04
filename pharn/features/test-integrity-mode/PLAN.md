---
spec_id: test-integrity-mode
spec_content_hash: 0e8a13f6f3f8ccf53cffc89816b5147ecec7c674dc86603e81a4a4170f33753f
applied_lessons: none
---

## Approach

Add one pure function in core that turns the two raw settings (the `test-integrity` input and the config's
`test_integrity.mode`) into the effective mode, its source and an optional "ignored config" value. Thread the raw
settings through the same path every other setting takes: `RawInputs` and `PharnConfig` into `resolveInputs`, then
the adapters (CLI, Action) into `CheckInput`, then `check()` into `buildReport`, which fills `testIntegrity.mode` and
`testIntegrity.source` and adds the two new messages. The markdown renderer gains one section. No signal, no I/O, no
policy layer.

Decisions that the code below follows:

- Mode order is `off` < `warn` < `block`. Base = input when given, else `warn`. The config can only raise the base.
  - config > base: mode = config, source `config`.
  - config = base: mode = base, source of the base (`input` or `default`), no message.
  - config < base: mode = base, source of the base, one `TEST_INTEGRITY_MODE_IGNORED` message (level `warn`).
  - no config: mode = base, source of the base.
- `TEST_INTEGRITY_OFF` (level `info`) is added when the effective mode is `off`.
- `testIntegrity.verdict` stays `pass`, `signals` and `languages` stay empty. With no `testIntegrityMode` given,
  `check()` output is byte-identical to today's, so the golden report JSON files do not change.
- The input is trimmed by `resolveInputs`; an empty or whitespace-only value counts as not given, for the CLI flag too.
  Case-sensitive: anything but `block`, `warn`, `off` is an `InputError` on the input `testIntegrity`.
- `.pharn/ci.yml` shape: `test_integrity:` mapping with one key `mode`. The top-level key `test_integrity` is allowed
  in `parseConfig`; an unknown key under it and an invalid or non-string mode are a `ConfigError` naming the allowed
  values. Parsed config shape: `PharnConfig.testIntegrity?: { mode?: TestIntegrityMode }`.
- The "🔍 Test integrity" section goes directly after the Diff coverage section (and its excluded-files block) and
  before the Messages section. It is four lines: the heading `### 🔍 Test integrity`, an empty line, one fixed line,
  an empty line. With zero signals the fixed line is `No test-integrity findings (mode: <mode>).` for `warn` and
  `block`, and `Test integrity is off for this run.` for `off`; with signals present (not producible yet) it is a
  fixed count line pointing at report.json rather than a false "no findings".
  Everything printed is a fixed string plus the enum mode, so nothing input-derived reaches the markdown.

## Applied lessons

- none — the project has no memory-bank (`NO_CANON`), so there are no lessons to apply.

## Steps

- Add `packages/core/src/testIntegrityMode.ts`: `TEST_INTEGRITY_MODES = ["block", "warn", "off"] as const`,
  `type TestIntegrityMode`, `isTestIntegrityMode(value: unknown)`, and
  `resolveTestIntegrityMode(input: TestIntegrityMode | undefined, config: TestIntegrityMode | undefined):
  { mode: TestIntegrityMode; source: "input" | "config" | "default"; ignoredConfig?: TestIntegrityMode }`.
  Export all from `index.ts`, with the type `ResolvedTestIntegrityMode`.
- `config.ts`: add `testIntegrity?: { mode?: TestIntegrityMode }` to `PharnConfig`; allow the top-level key
  `test_integrity` (the unknown-top-level-key error list changes accordingly); add `validateTestIntegrity` (mapping
  required, key `mode` only, value one of the three strings, else `ConfigError` listing them, unknown key
  `unknown key "test_integrity.<key>"`). The YAML subset parser already reads nested mappings; no list support.
- `inputs.ts`: `RawInputs.testIntegrity?: string | undefined`; `InputErrorText.testIntegrity?: string` (label,
  default `test-integrity`); `ResolvedInputs.testIntegrityMode: { input?: TestIntegrityMode; config?:
  TestIntegrityMode }` (always present, keys absent when not given). Invalid input yields
  `InputError("testIntegrity", "<label> must be one of: block, warn, off (got \"<value>\")")` after the existing
  errors in the documented order.
- `report.ts`: add the two codes to `MessageCode`; `BuildReportInput.testIntegrity?: ResolvedTestIntegrityMode`;
  `buildReport` emits `testIntegrity: { mode, source, verdict: "pass", signals: [], languages: [] }` (default when
  absent), pushes `TEST_INTEGRITY_MODE_IGNORED` (warn, text names the config value and the base mode and says the
  config can only tighten) and `TEST_INTEGRITY_OFF` (info) right after `TEST_FILES_DELETED`, before the agent setup
  messages. Keep `emptyTestIntegrity()` exported and unchanged.
- `check.ts`: `CheckInput.testIntegrityMode?: { input?: TestIntegrityMode; config?: TestIntegrityMode }`, resolved
  with `resolveTestIntegrityMode` and passed to `buildReport` through `base` (so every early return carries it).
- `render/markdown.ts`: `MESSAGE_HINTS` entries for both codes (it is a `Record<MessageCode, string>`, so the
  typecheck forces them); the section described above.
- `packages/cli/src/main.ts`: option `test-integrity` (string), `raw.testIntegrity`, `FLAG_ERRORS.testIntegrity =
  "--test-integrity"`, an early `flagError("testIntegrity")` throw before any git call (exit 2 through the existing
  `ConfigError` path), pass `resolved.inputs.testIntegrityMode` into `CheckInput`, usage text line.
- `packages/action/src/run.ts`: `testIntegrity: input("test-integrity") || undefined` in `RawInputs`,
  `INPUT_ERRORS.testIntegrity = "test-integrity"`, pass the resolved mode into `CheckInput`. An invalid value throws
  through `resolved.errors[0]` and fails the step as the other inputs do.
- `action.yml`: input `test-integrity` (not required, no default so that empty means not given).
- `schema/report.v2.json`: in `$defs.message.properties.code.description`, name the two new codes as added in v2.
  Nothing else in the schema changes; `schema/report.v1.json` is not touched.
- Docs: README (input table row, CLI flag in the usage block and its flag list, the `.pharn/ci.yml` reference with
  `test_integrity.mode` and the tighten-only rule, and the code table if one lists message codes), CHANGELOG
  Unreleased "Added" line, THREAT-MODEL (a numbered residual-risk entry next to the other PR-carried settings:
  `test_integrity.mode` lives in the PR-carried config, can only raise the mode, never loosen it, a loosening attempt
  is reported as `TEST_INTEGRITY_MODE_IGNORED`; and the A1 row's config sentence if it lists the keys).
- Rebuild the action bundle with `pnpm build` (`packages/action/dist/index.js`).
- Existing tests that pin the golden markdown, or the exact section list, see the new section: fold the added
  section out before the comparison (the way the earlier widened tests fold a callout or a footer), keep every hash
  constant and every other assertion, and never delete or skip a case. Regenerate the markdown goldens and the
  markdown snapshot with `pnpm test -u` and review the diff: the only change is the added section.
- Verify with `pnpm lint`, `pnpm test`, `pnpm build`.

## Files

- `packages/core/src/testIntegrityMode.ts` — new: mode type, validation and the pure precedence function
- `packages/core/src/index.ts` — export the new module
- `packages/core/src/config.ts` — `test_integrity.mode` key
- `packages/core/src/inputs.ts` — raw input, error label, resolved `testIntegrityMode`
- `packages/core/src/report.ts` — message codes, `buildReport` fills `testIntegrity` and the two messages
- `packages/core/src/check.ts` — `testIntegrityMode` input threaded to `buildReport`
- `packages/core/src/render/markdown.ts` — hints and the "🔍 Test integrity" section
- `packages/cli/src/main.ts` — `--test-integrity` flag
- `packages/action/src/run.ts` — `test-integrity` input
- `packages/action/dist/index.js` — rebuilt bundle
- `action.yml` — the `test-integrity` input
- `schema/report.v2.json` — known-codes documentation
- `README.md` — input, flag and config documentation
- `CHANGELOG.md` — Unreleased entry
- `docs/THREAT-MODEL.md` — PR-carried mode can only tighten
- `fixtures/golden/report.md` — regenerated golden markdown
- `fixtures/golden-cobertura/report.md` — regenerated golden markdown
- `fixtures/golden-exclusions/report.md` — regenerated golden markdown
- `fixtures/golden-multi/report.md` — regenerated golden markdown
- `fixtures/coverage-paths/package-relative/report.md` — regenerated golden markdown
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated markdown snapshot
- `packages/core/test/ac-header-logo-golden.test.ts` — fold the new section out; hash constant unchanged
- `packages/core/test/ac-verdict-callout-golden.test.ts` — fold the new section out; hash constants unchanged
- `packages/core/test/ac-paths-partial.test.ts` — fold the new section out; hash constants unchanged
- `packages/core/test/ac-format-golden.test.ts` — fold the new section out; hash constants unchanged
- `packages/core/test/ac-comment-bold-data.test.ts` — message and hint lines move down by the new section
- `packages/core/test/ac-comment-bold-sections.test.ts` — the expected section list gains the new heading
- `packages/core/test/ac-markdown-order-cap.test.ts` — section order gains the new heading if it lists them
- `packages/core/test/markdown.test.ts` — only if an assertion lists the section order or full output
- `packages/core/test/ac-paths-unmatched-check.test.ts` — only if its snapshot of the markdown changes

### Explicitly not touched

- `schema/report.v1.json` — byte-identical to the base commit (AC-11)
- `packages/core/src/testFiles.ts` — item 3
- `docs/LIMITS.md` — item 9
- `fixtures/golden/report.json` — the default output does not change (AC-8)

## Acceptance mapping

- AC-1 → no `testIntegrityMode` given: base `warn`, source `default`, no new message (`resolveTestIntegrityMode`,
  `buildReport`).
- AC-2 → input `block`: source `input`; config `warn` under input `block` is ignored with `TEST_INTEGRITY_MODE_IGNORED`.
- AC-3 → config `block` over an absent or `warn` input: mode `block`, source `config`, no message.
- AC-4 → a config value looser than the base is ignored with exactly one `TEST_INTEGRITY_MODE_IGNORED`; an equal one
  adds none.
- AC-5 → effective mode `off` adds exactly one `TEST_INTEGRITY_OFF` (info); config `block` over input `off` gives
  `block`, source `config`, and no `OFF` message.
- AC-6 → `resolveInputs` rejects bad input values (empty or whitespace is not given); `parseConfig` rejects bad
  `test_integrity.mode` values and unknown `test_integrity` keys, both naming `block, warn, off`.
- AC-7 → `renderMarkdown` section placement and the three fixed lines.
- AC-8 → the golden JSON is unchanged because the default block is the same; the golden markdown differs only by the
  section (regenerated goldens, hash tests fold the section).
- AC-9 → Action wiring: the input beats the config, the comment carries the fixed line, an invalid value fails the step.
- AC-10 → CLI wiring: `--test-integrity block` gives source `input`; an invalid value exits 2 naming the allowed values.
- AC-11 → `action.yml`, CHANGELOG, README, THREAT-MODEL, `schema/report.v2.json` codes, v1 schema unchanged.

## Risks & open questions

- The list of existing tests that need the fold-out is a best estimate from the tests that pin the golden markdown or
  the section order; the build may find one more. Each is edited only to fold the new section out of what it
  compares, never weakened. A file that turns out to need an edit and is not listed above is a reconcile escape
  that a person decides on.
- Precedence fixtures are inline tables in the AC tests rather than files under `fixtures/`: the cases are
  `{input, config}` pairs checked through `check()`, with nothing file-shaped to store.
- A warn-level `TEST_INTEGRITY_MODE_IGNORED` turns the whole report verdict to `warn` (the existing `verdictOf`
  rule). That is intended: it tells a repo its config tried to loosen the mode. It never fails the check.
- The one-line count for a report that already carries signals is not reachable yet; it exists so the section never
  claims "no findings" next to a non-empty signal list.
