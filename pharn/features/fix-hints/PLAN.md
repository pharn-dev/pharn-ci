---
spec_id: fix-hints
spec_content_hash: "9910a4706db7a62b038f38bedba0ce7bd74805e94fef5fbd8a6be09b4608fa88"
applied_lessons: none
---

## Approach

ADVISORY — model work. Every message and every finding of Report v2 gains an optional `fix` object
`{ kind, target?, hint }`. It is computed in core, deterministically, from two plain tables (one per message code, one
per signal id) and attached in one pass over the built report, so the CLI's JSON and the Action's `report.json` carry it
with no change to the CLI or the Action sources. The markdown renderer is not touched, so every rendered golden stays
byte-identical.

Design, grounded in the live code read this run:

- **Where `fix` is attached.** Every message and finding reaches the report through `buildReport()`
  (`packages/core/src/report.ts`; every early return of `check()` calls it). After it, only three core functions add or
  rebuild messages: `acceptTestIntegrity()` and `ignoreAcceptLabel()` (`packages/core/src/acceptLabel.ts`, which rebuild
  the `TEST_INTEGRITY_TI*` messages and add `TEST_INTEGRITY_ACCEPTED` / `TEST_INTEGRITY_ACCEPT_IGNORED`) and
  `withUploadOutcome()` (`packages/core/src/upload/outcome.ts`, which adds `UPLOAD_TOO_LARGE`). No message is created in
  `packages/action/src`, `packages/cli/src` or `packages/node-io/src` (grep for `code: "` there is empty). So:
  `buildReport` returns `withFixHints({...})`, and the three later functions give the messages they create or rebuild a
  `fix` through `withMessageFix(message)`; signals they copy keep their `fix` through the existing object spread. They do
  **not** run `withFixHints` over the whole report, so a hand-built report passed to them (as many existing tests do)
  gains `fix` only on the messages those functions make.
- **Hints are not interpolated.** Each hint is exactly the table's sentence; the finding's path and line go only into
  `target`. That satisfies "only that path, line or id interpolated" trivially and makes AC-7 hold by construction: two
  findings of one id differ in `fix` only in `target`.
- **`target`** = `path` when `line` is null, `` `${path}:${line}` `` otherwise, omitted when `path` is null (a policy
  violation about no file) — messages never get a `target`.
- **Kinds by construction.** `MESSAGE_FIXES` is typed `Readonly<Record<MessageCode, FixEntry>>`, so the compiler refuses
  a message code with no entry; each signal-family code (`TEST_INTEGRITY_<id>`, `POLICY_<id>`, `INJECTION_<id>`,
  `SETUP_STALE_<id>`, `DEPENDENCY_<id>`) points at its signal's `SIGNAL_FIXES` entry, so the message and the signal
  cannot disagree on the kind.
- **Schema.** One `$defs.fix` (closed object, required `kind` and `hint`, optional `target`, `kind` the closed enum,
  `hint` `maxLength` 200) and six `"fix": { "description": …, "$ref": "#/$defs/fix" }` properties: in `$defs.message`
  and in the item schemas of `testIntegrity.signals`, `policy.violations`, `setupHealth.stale`, `injection.signals` and
  `dependencies.signals`. No `required` list changes; `schema/report.v1.json` is untouched. Nothing else in the schema
  changes (no edit to the top-level or message-code description), so the only schema pins that move are the ones whose
  pinned text spans one of these seven insertions.
- **Existing tests (the large part).** A scratch experiment run this session (the base suite in a copy of HEAD
  7d88076 with git history, then the same suite with `fix` on every message and finding, the schema insertions, the
  goldens regenerated and the dist rebuilt) turned 129 tests in the 86 files under `## Files` from pass to fail; nothing
  else changed. They fall in four groups, and each is re-pinned through one shared helper,
  `packages/core/test/v090-codes.ts`, never loosened:
  1. **literal** — `toEqual` on messages or findings written out literally: wrap the *actual* side in
     `withoutFix(...)`; the expected literal stays byte-for-byte.
  2. **digest / golden** — a sha256 or byte compare of a whole report, of `{ fixture, signals, messages }` records, or of
     a committed golden JSON against a value pinned at an older commit: compute it over `withoutFix(...)` (or
     `withoutFixJson(text)` for a file), so the pinned digest stays.
  3. **schema** — a byte pin of `schema/report.v2.json` against an older commit, or an exact-text count
     (`v070-codes.ts`, `v080-codes.ts` texts, `injection-schema`, `stale-docs`): read the schema through
     `withoutV090SchemaEdits(...)` first, then the earlier helpers as before.
  4. **fixtures / meta** — the "nothing else changed" meta-tests (`git diff --name-status <BASE> -- fixtures/`, the
     UNCHANGED lists): accept exactly the modified golden `report.json` files listed below when `withoutFixJson(file)`
     equals the file at that base, and move the edited files from an UNCHANGED list to a marked "re-pinned by fix-hints
     (H6)" list.
  Every edited existing test gets one comment line naming `fix-hints (H6)`, as the earlier re-pins name their item.

## Applied lessons

- none — `node pharn/floor/check-lessons-index.mjs . --verdict` printed `NO_CANON`: the project has no
  `pharn/memory-bank/lessons-learned.md` yet, so there is no lesson to apply.

## Steps

1. **`packages/core/src/fix/table.ts` (new, pure data).** Export
   `FIX_KINDS = ["add-test", "restore-test", "restore-assertion", "revert-config", "remove-dependency", "request-review", "split-pr", "none"] as const`,
   `type FixKind = (typeof FIX_KINDS)[number]`, `interface FixEntry { kind: FixKind; hint: string }`,
   `interface FixHint { kind: FixKind; target?: string; hint: string }`, `type FixSignalId` (TI01–TI16, P01–P11, P13,
   P14, SI01–SI04, PI01–PI05, D01–D05; P12 is not produced by core — no `p12.ts` — so it has no entry),
   `SIGNAL_FIXES: Readonly<Record<FixSignalId, FixEntry>>` and `MESSAGE_FIXES: Readonly<Record<MessageCode, FixEntry>>`
   (import `type MessageCode` only). Kinds exactly as the SPEC's Data section lists them. Hints: one English sentence
   each, at most 200 characters, no placeholder, none of the words exclude, excluding, exclusion, lower, skip,
   threshold, ignore, disable, exempt, exemption (word-boundary, case-insensitive: so also avoid "coverage-ignore" and
   "no-skip"; "lowered", "skipped", "ignored" are not matched by the AC-3 scan but avoid them anyway). A `none` hint
   still says what a person should look at. Suggested wording (the build may refine within those rules):
   - TI01 "Restore the deleted test file, or move its tests to a test file that still runs them." TI02 "Restore the
     removed test, or keep a test with the same assertions in one of the touched test files." TI03 "Remove the marker
     that turns this test off, so it runs again." TI04 "Remove the focused-run marker (.only, fit or fdescribe) so every
     test in the file runs again." TI05 "Restore the assertions this test had, so it checks the behaviour again." TI06
     "Restore the stronger assertion this test had in place of the weaker one." TI07 "Restore the expected values; if
     the behaviour really changed, say why in the pull request and have a reviewer confirm it." TI08 "Ask a reviewer to
     confirm the snapshot changes are intended before merging." TI09 "Revert the test-runner config change so the same
     tests run under the same rules as before." TI10 "Revert the test script change in package.json so it runs the whole
     suite and fails when a test fails." TI11 "Revert the workflow change so CI runs the tests on pull requests as
     before." TI12 "Ask a reviewer to confirm that mocking the changed module still tests its real behaviour." TI13
     "Remove the added coverage pragma and add tests that run those lines." TI14 "Revert the change to the coverage
     settings of the pharn-ci config so the gate measures the same files as before." TI15 "Ask a reviewer to confirm the
     code does not special-case the value the test checks." TI16 "Ask a reviewer to confirm the lint or type suppression
     added to the test file is needed."
   - P01 "A maintainer should add the agent setup files the org policy requires." P02–P06 "Ask a maintainer or the
     policy owner to review the committed agent settings this rule names." P07 "A maintainer should make the agent
     instruction files agree on one package manager and one test runner." P08 "Ask a maintainer to review the tracked
     files that match the org policy's forbidden patterns." P09 "Revert the edit to the file the org policy guards."
     P10 "The org policy could not be used; a maintainer should check where it comes from." P11 "Ask a person to review
     or make the change to the paths the org policy protects from agent pull requests." P13 "Revert the edit that widens
     what an agent may do." P14 "Split the change into smaller pull requests within the org policy's size caps."
   - SI01–SI03 "Update this agent instruction so it names a script, path or file that exists." SI04 "Check that this old
     agent instruction file still describes the file this change edits."
   - PI01–PI05 "Ask a reviewer to look at the added text that addresses an AI agent before merging." (per-id wording
     may differ: PI01 invisible characters, PI04 the long encoded run, PI05 the instruction file in vendored code).
   - D01 "Remove the dependency; the package does not exist in the registry." D02 "Remove the newly published package,
     or wait until it is older and pin a reviewed version." D03 "Remove the rarely downloaded package, or have a
     reviewer vet it first." D04 "Regenerate the lockfile with the package manager and ask a reviewer to confirm the
     manifest change was meant." D05 "Remove the dependency from outside the allowed registries, or use the package's
     registry release."
   - Message codes: each `TEST_INTEGRITY_<id>`, `POLICY_<id>`, `INJECTION_<id>`, `SETUP_STALE_<id>`, `DEPENDENCY_<id>`
     reuses its signal's entry; `AGENT_CONFIG_SECRET_S01`–`S11` request-review ("Ask a maintainer to remove the value
     from the committed agent config, rotate it and load it from the environment."); `DIFF_COVERAGE_BELOW_THRESHOLD`
     and `TESTS_NOT_EXERCISING_CHANGES` add-test ("Add tests that run the changed lines listed in the report." /
     "Add or change tests that import and assert on the changed source files."); `TEST_FILES_DELETED` restore-test;
     `CONFIG_CHANGED_IN_DIFF` and `COVERAGE_FILE_TRACKED` request-review; every operational code `none` with a short
     "check …" sentence (for example `COVERAGE_FILE_MISSING` "Check that the test step writes the coverage file where
     the check reads it.", `DIFF_UNAVAILABLE` "Check that the workflow fetches the base commit so the diff can be
     read.").
2. **`packages/core/src/fix/attach.ts` (new, pure).** `fixTarget(path: string | null, line: number | null): string |
   undefined`; `messageFix(code: string): FixHint | undefined` (a fresh `{ kind, hint }` copy, undefined for a code not
   in the table, which only a cast can produce); `withMessageFix<M extends Message>(message: M): M` (adds `fix` last,
   overwriting any old one; leaves a message with an unknown code as it is); `withFixHints(report: Report): Report`
   (a new report: every message through `withMessageFix`, every item of `testIntegrity.signals`,
   `policy.violations`, `setupHealth.stale`, `injection.signals`, `dependencies.signals` with
   `fix: { kind, target?, hint }` from `SIGNAL_FIXES[id]`, `target` from `fixTarget`; an unknown id gets no `fix`; the
   input is not changed; key order kept with `fix` appended). Import `type Report, type Message` only (no runtime cycle
   with report.ts).
3. **`packages/core/src/report.ts`.** Add `fix?: FixHint` to `Message`, `TestIntegritySignal`, `ReportPolicyViolation`,
   `ReportStaleInstruction`, `ReportInjectionSignal`; `buildReport` returns `withFixHints({ … })` (the object it returns
   today, unchanged otherwise). `verdictOf` and the message order are untouched.
4. **`packages/core/src/dependencies/types.ts`.** Add `fix?: FixHint` to `DependencySignal` (the report's
   `dependencies.signals` type).
5. **`packages/core/src/acceptLabel.ts`.** In `acceptTestIntegrity`, the rebuilt `TEST_INTEGRITY_TI*` messages and the
   `TEST_INTEGRITY_ACCEPTED` message go through `withMessageFix`; in `ignoreAcceptLabel`, the
   `TEST_INTEGRITY_ACCEPT_IGNORED` message does. Nothing else changes.
6. **`packages/core/src/upload/outcome.ts`.** The `UPLOAD_TOO_LARGE` message goes through `withMessageFix`.
7. **`packages/core/src/index.ts`.** Export `FIX_KINDS`, `type FixKind`, `type FixEntry`, `type FixHint`,
   `type FixSignalId`, `SIGNAL_FIXES`, `MESSAGE_FIXES`, `fixTarget`, `messageFix`, `withMessageFix`, `withFixHints`
   (the AC tests import them from `packages/core/src/index.ts`).
8. **`schema/report.v2.json`.** Add `$defs.fix` after `$defs.message` with descriptions: `fix` "How to fix this
   message or finding honestly (since 0.9.0): one kind from a closed list and one fixed English sentence per code or
   signal id, never written by a model. No kind lowers a gate: none lowers a threshold, adds an exclusion, turns a test
   off, adds an exemption or edits a policy."; `kind` (the eight values and what each means); `target` "The path, or
   path:line, the finding already names; never present on a message, never file text."; `hint` "One fixed sentence
   for the code or signal id, at most 200 characters; never file text, diff text, a test name, a package name or a
   secret." Then the six `"fix": { "description": "…; no kind lowers a gate. See $defs/fix.", "$ref": "#/$defs/fix" }`
   properties, each appended as the last property of its object. Keep the file biome-formatted
   (`pnpm biome check --write schema/report.v2.json`, naming the file).
9. **`packages/core/test/v090-codes.ts` (new test helper, not an AC test).** Following `v080-codes.ts`: export the
   exact inserted bytes as constants (`V090_FIX_DEF_TEXT` and one constant per `fix` property insertion), and
   `withoutV090SchemaEdits(text: string): string` that takes each out exactly once (throws otherwise), so
   `withoutV090SchemaEdits(current)` equals `git show 7d88076280ec86435c3f84ad3c6102e272ab64d5:schema/report.v2.json`
   byte for byte; `withoutFix<T>(value: T): T` (a deep copy with every own `fix` property removed whose value is an
   object with string `kind` and `hint` — the report has no other `fix` key); and
   `withoutFixJson(text: string): string` (`JSON.stringify(withoutFix(JSON.parse(text)), null, 2) + "\n"`).
10. **Re-pin the 86 existing tests** listed under `## Files` by the four recipes in Approach; never change a test title
    (`ac-ti06-ti12-unchanged` pins titles), never delete a case, never add `.skip`/`.only`/`.todo`/`skipIf`, never
    widen an expected value. Specifics found this run:
    - `ac-polset-pins.test.ts`: move `golden.test.ts`, `ac-accept-signoff-default-golden.test.ts` and
      `ac-polrules-p09-settings.test.ts` from `UNCHANGED` to a new marked `EDITED_BY_FIX_HINTS` list (still run in its
      child vitest), and accept `fixtures/golden/report.json`, `fixtures/golden-cobertura/report.json` and
      `fixtures/golden-multi/report.json` as modified when `withoutFixJson` of each equals the file at its `BASE`.
    - `ac-p07-unchanged`, `ac-p11-unchanged`, `ac-pyparity2-unchanged`, `ac-name-only-suite`: the same fixture
      allowance for those three golden JSON files and `fixtures/coverage-paths/package-relative/report.json` and
      `report-warn.json` (each `M`, never `A` or `D`, `withoutFixJson(file)` equal to its base).
    - Do not edit any `packages/*/test/ac-agentpr-*.test.ts` (`ac-p11-unchanged` requires them byte-identical to its
      base), and add no file under `fixtures/` (five meta-tests refuse new fixtures outside their allowed patterns).
11. **Goldens.** Regenerate `fixtures/golden/report.json`, `fixtures/golden-cobertura/report.json`,
    `fixtures/golden-multi/report.json`, `fixtures/coverage-paths/package-relative/report.json` and `report-warn.json`
    so each equals the check output with `fix` (the only difference from base: a `fix` on each message and finding).
    `fixtures/golden-exclusions/report.json` has no message and no finding and stays byte-identical; every `report.md`
    stays byte-identical. Write them with the Write tool from the test's own output (or `pnpm vitest run -u` on the four
    golden test files only, which writes only the three `golden*` JSON snapshots); review the diff.
12. **Docs.** README: a `### Fix hints` subsection inside `## Report v2`, before `### Agent PRs`, listing the eight kinds
    in a table with what each asks, saying an agent may act on `fix.kind` (and should still read the hint and the
    report), that `target` is only the path or `path:line` the finding names, that the PR comment is unchanged, and that
    no kind or hint lowers a gate. CHANGELOG `## [Unreleased]` `### Added`: one line naming the optional `fix` object
    on every message and finding of Report v2. `docs/LIMITS.md`: a `## Fix hints` section (after `## Dependency
    safety`) saying hints are generic, one per code or signal id, never look at the code, never prove a fix was made or
    was right, the next run's report is the only check; recording the D04 → request-review choice and the `none`
    kinds. No change to `docs/THREAT-MODEL.md` or `SECURITY.md` (no new untrusted parsing, write target or API call).
13. **Rebuild** `pnpm build` so `packages/action/dist/index.js` is a fresh bundle (the working tree already had an
    uncommitted change to it before this run; the rebuild replaces it). Then `pnpm lint` and the whole `pnpm test`.

## Files

- `packages/core/src/fix/table.ts` — new: the eight kinds, the `FixKind`/`FixEntry`/`FixHint`/`FixSignalId` types, `SIGNAL_FIXES` and `MESSAGE_FIXES`
- `packages/core/src/fix/attach.ts` — new: `fixTarget`, `messageFix`, `withMessageFix`, `withFixHints`
- `packages/core/src/report.ts` — `fix?` on the message and finding types; `buildReport` returns `withFixHints(...)`
- `packages/core/src/dependencies/types.ts` — `fix?` on `DependencySignal`
- `packages/core/src/acceptLabel.ts` — the messages it rebuilds or adds get `fix` through `withMessageFix`
- `packages/core/src/upload/outcome.ts` — `UPLOAD_TOO_LARGE` gets `fix` through `withMessageFix`
- `packages/core/src/index.ts` — export the fix table, types and helpers
- `schema/report.v2.json` — `$defs.fix` and six optional `fix` properties
- `README.md` — `### Fix hints` subsection under Report v2
- `CHANGELOG.md` — Unreleased line for the `fix` object
- `docs/LIMITS.md` — `## Fix hints` section
- `fixtures/golden/report.json` — regenerated: `fix` on each message
- `fixtures/golden-cobertura/report.json` — regenerated: `fix` on each message
- `fixtures/golden-multi/report.json` — regenerated: `fix` on each message
- `fixtures/coverage-paths/package-relative/report.json` — regenerated: `fix` on each message
- `fixtures/coverage-paths/package-relative/report-warn.json` — regenerated: `fix` on each message
- `packages/action/dist/index.js` — rebuilt bundle (`pnpm build`)
- `packages/core/test/v090-codes.ts` — new shared re-pin helper: `withoutV090SchemaEdits`, `withoutFix`, `withoutFixJson`

- `packages/action/test/ac-accept-signoff-default-golden.test.ts` — re-pin (digest/golden)
- `packages/action/test/ac-accept-signoff-regression.test.ts` — re-pin (digest/golden)
- `packages/action/test/ac-policy3-outcomes.test.ts` — re-pin (literal)
- `packages/action/test/ac-polset-action.test.ts` — re-pin (literal)
- `packages/action/test/ac-pyparity2-unchanged.test.ts` — re-pin (schema, fixtures)
- `packages/action/test/ac-upload-url-failures.test.ts` — re-pin (literal)
- `packages/action/test/setup-sizes.test.ts` — re-pin (literal)
- `packages/action/test/stale-instructions-action.test.ts` — re-pin (literal)
- `packages/cli/test/ac-inventory-empty.test.ts` — re-pin (literal)
- `packages/cli/test/ac-polset-cli.test.ts` — re-pin (literal)
- `packages/cli/test/stale-instructions-cli.test.ts` — re-pin (literal)
- `packages/core/test/ac-comment-bold-data.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-format-golden.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-globs-check.test.ts` — re-pin (literal)
- `packages/core/test/ac-header-logo-data.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-name-only-suite.test.ts` — re-pin (digest/golden, fixtures)
- `packages/core/test/ac-p07-schema-hints.test.ts` — re-pin (schema)
- `packages/core/test/ac-p07-unchanged.test.ts` — re-pin (fixtures)
- `packages/core/test/ac-p11-agent-vs-human.test.ts` — re-pin (literal)
- `packages/core/test/ac-p11-diff-kinds.test.ts` — re-pin (literal)
- `packages/core/test/ac-p11-diff-unavailable.test.ts` — re-pin (literal)
- `packages/core/test/ac-p11-incomplete.test.ts` — re-pin (literal)
- `packages/core/test/ac-p11-policy-file-base.test.ts` — re-pin (literal)
- `packages/core/test/ac-p11-schema-hints.test.ts` — re-pin (schema)
- `packages/core/test/ac-p11-unchanged.test.ts` — re-pin (fixtures)
- `packages/core/test/ac-p14-caps.test.ts` — re-pin (literal)
- `packages/core/test/ac-p14-policy-file.test.ts` — re-pin (literal)
- `packages/core/test/ac-paths-partial.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-policy3-unchanged.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-polrules-p01-expect.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p01-require.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p08-forbidden.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p09-config.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p09-policy-file.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p09-settings.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p09-workflow.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-p10.test.ts` — re-pin (literal)
- `packages/core/test/ac-polrules-report.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-absent.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-budget.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-duplicate-deny.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-messages.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p02-allow.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p02-fixed.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p03.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p04.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p05.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p06.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-p09.test.ts` — re-pin (literal)
- `packages/core/test/ac-polset-pins.test.ts` — re-pin (UNCHANGED list, golden fixtures)
- `packages/core/test/ac-polset-unavailable.test.ts` — re-pin (literal)
- `packages/core/test/ac-precision-v030-schema.test.ts` — re-pin (schema)
- `packages/core/test/ac-py-index-docs.test.ts` — re-pin (schema)
- `packages/core/test/ac-pyparity2-ti09-headers.test.ts` — re-pin (literal)
- `packages/core/test/ac-report-v2-check.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-secrets-repin.test.ts` — re-pin (schema)
- `packages/core/test/ac-test-integrity-mode-render.test.ts` — re-pin (digest/golden)
- `packages/core/test/ac-test-sources-docs.test.ts` — re-pin (schema)
- `packages/core/test/ac-ti01-unparsed.test.ts` — re-pin (literal)
- `packages/core/test/ac-ti0102-regression.test.ts` — re-pin (digest)
- `packages/core/test/ac-ti0205-regression.test.ts` — re-pin (digest)
- `packages/core/test/ac-ti0304-regression.test.ts` — re-pin (digest)
- `packages/core/test/ac-ti06-ti12-unchanged.test.ts` — re-pin (digest)
- `packages/core/test/ac-ti07-schema.test.ts` — re-pin (schema)
- `packages/core/test/ac-ti081516-docs.test.ts` — re-pin (schema)
- `packages/core/test/ac-ti09-opaque-head.test.ts` — re-pin (literal)
- `packages/core/test/ac-ti1013-regression.test.ts` — re-pin (digest)
- `packages/core/test/ac-unparseable-cases.test.ts` — re-pin (literal)
- `packages/core/test/ac-unread-added.test.ts` — re-pin (literal)
- `packages/core/test/ac-upload-outcome.test.ts` — re-pin (literal)
- `packages/core/test/ac-upload-schema.test.ts` — re-pin (schema)
- `packages/core/test/ac-verdict-callout-data.test.ts` — re-pin (digest/golden)
- `packages/core/test/dependencies-check.test.ts` — re-pin (literal)
- `packages/core/test/dependencies-registry.test.ts` — re-pin (literal)
- `packages/core/test/docs-schema-levels.test.ts` — re-pin (schema)
- `packages/core/test/golden.test.ts` — re-pin (literal)
- `packages/core/test/injection-check.test.ts` — re-pin (literal)
- `packages/core/test/injection-policy.test.ts` — re-pin (literal)
- `packages/core/test/injection-schema.test.ts` — re-pin (schema)
- `packages/core/test/report-unsafe-chars.test.ts` — re-pin (literal)
- `packages/core/test/report.test.ts` — re-pin (literal)
- `packages/core/test/setup-sizes.test.ts` — re-pin (literal)
- `packages/core/test/stale-check.test.ts` — re-pin (literal)
- `packages/core/test/stale-docs.test.ts` — re-pin (schema)
- `packages/core/test/threshold-semantics.test.ts` — re-pin (literal)
- `packages/node-io/test/ac-ti07-moved.test.ts` — re-pin (digest)

### Explicitly not touched

- `schema/report.v1.json` — byte-identical to base (AC-8)
- `packages/core/src/render/markdown.ts` — the PR comment and job summary do not change; its human `Hint:` table stays separate
- `packages/core/src/upload/bundle.ts` — `fix` passes through redaction and the caps as it is (AC-10)
- `packages/cli/src` and `packages/action/src` — no source change; the JSON they write carries `fix` through core
- `fixtures/golden-exclusions/report.json` and every `fixtures/**/report.md` — unchanged
- `docs/THREAT-MODEL.md` and `SECURITY.md` — no new untrusted parsing, write target or API call
- `packages/*/test/ac-agentpr-*.test.ts` — pinned byte-identical by `ac-p11-unchanged`
- `packages/core/test/v060-codes.ts`, `v070-codes.ts`, `v080-codes.ts` — earlier helpers stay as they are; pins call `withoutV090SchemaEdits` before them
- `.github/`, `AGENTS.md`, `CLAUDE.md` — out of scope

## Acceptance mapping

- AC-1 → `FIX_KINDS` in `fix/table.ts` and `$defs.fix.properties.kind.enum` in the schema hold the eight values in the SPEC's order.
- AC-2 → `MESSAGE_FIXES` is a `Record<MessageCode, FixEntry>` (every code the schema description names is a
  `MessageCode`) and `SIGNAL_FIXES` covers TI01–TI16, the P ids core has a rule file for (`policy/rules/p*.ts`),
  SI01–SI04, PI01–PI05, D01–D05; hints non-empty, at most 200 characters.
- AC-3 → hint wording rules in step 1; no placeholders at all.
- AC-4 → the kinds of the SPEC's Data section, step 1.
- AC-5 → `withFixHints` in `buildReport`; `target` from `fixTarget`; hint = table sentence exactly; reports still
  validate (schema step 8).
- AC-6 → every message through `withMessageFix`, no `target` on messages; `none` entries have hints.
- AC-7 → no interpolation: the hint is the table sentence and `target` is only path / path:line.
- AC-8 → schema step 8: one `$defs.fix`, six `$ref` properties each with a description, `required` lists and v1 unchanged.
- AC-9 → golden JSON regenerated (step 11); `report.md` goldens unchanged because the renderer is not touched.
- AC-10 → `buildUploadBundle` copies, redacts and caps only `text`/`detail` — `fix` passes unchanged; no change needed.
- AC-11 → the Action and the CLI serialise the core report; the existing streamed-input tests compare with the
  regenerated golden.
- AC-12 → step 9 helper and step 10 re-pins; the 86 files are exactly the ones the experiment showed failing.
- AC-13 → docs step 12 and the schema descriptions of step 8.

## Risks & open questions

- **Blast radius.** 86 existing test files change. The list comes from a scratch experiment (HEAD 7d88076 copied out
  of the project with `git archive`, history reached through a git alternates file, base run 2882 tests / 2 failures,
  patched run 129 newly failing). The experiment's hints and schema descriptions were placeholders, so a pin over text
  this experiment did not touch could still move; if the build meets a failing existing test that is not in
  `## Files`, it must stop and report rather than widen its scope or loosen the test.
- **Flaky in this environment, not ours:** `ac-polset-pins` and `ac-p07-unchanged` failed in the base run too (their
  child vitest timed out on the streamed-input tests under load) and `ac-ti09y-mocha` timed out once; both meta-tests
  are still in `## Files` because they also need the golden-fixture re-pin.
- **Hint wording vs the banned words.** The AC-3 test is written before the build; a hint that trips it is fixed in
  `fix/table.ts`, never by changing the test.
- **`$ref` with a sibling `description`** is valid in draft 2020-12 and compiled under the suite's strict Ajv in the
  experiment; the AC-8 test resolves `$ref` to check the shape.
- **Pre-existing uncommitted edit** to `packages/action/dist/index.js` (in `git status` before this run): the rebuild
  overwrites it with a fresh bundle; whoever made it should know.
- **P12** has a schema-valid id pattern but no rule in core: it gets no `SIGNAL_FIXES` entry, and `withFixHints` leaves
  such a violation without `fix` (optional) rather than inventing a kind.
