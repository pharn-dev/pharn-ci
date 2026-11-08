---
spec_id: fix-hints
spec_content_hash: "9910a4706db7a62b038f38bedba0ce7bd74805e94fef5fbd8a6be09b4608fa88"
---

## Files

- `packages/core/test/ac-fix-hints-kinds.test.ts` — the tests for AC-1
- `packages/core/test/ac-fix-hints-table.test.ts` — the tests for AC-2
- `packages/core/test/ac-fix-hints-words.test.ts` — the tests for AC-3
- `packages/core/test/ac-fix-hints-mapping.test.ts` — the tests for AC-4
- `packages/core/test/ac-fix-hints-findings.test.ts` — the tests for AC-5
- `packages/core/test/ac-fix-hints-messages.test.ts` — the tests for AC-6
- `packages/core/test/ac-fix-hints-no-leak.test.ts` — the tests for AC-7
- `packages/core/test/ac-fix-hints-schema.test.ts` — the tests for AC-8
- `packages/cli/test/ac-fix-hints-golden.test.ts` — the tests for AC-9
- `packages/core/test/ac-fix-hints-upload.test.ts` — the tests for AC-10
- `packages/action/test/ac-fix-hints-action.test.ts` — the tests for AC-11
- `packages/core/test/ac-fix-hints-pins.test.ts` — the tests for AC-12
- `packages/core/test/ac-fix-hints-docs.test.ts` — the tests for AC-13

## Mapping

- AC-1 | unit | `packages/core/test/ac-fix-hints-kinds.test.ts` | `FIX_KINDS: readonly FixKind[]` exported from `packages/core/src/index.ts` (module `packages/core/src/fix/table.ts`), and `$defs.fix.properties.kind.enum` of `schema/report.v2.json` (read in the test body)
- AC-2 | unit | `packages/core/test/ac-fix-hints-table.test.ts` | `MESSAGE_FIXES: Readonly<Record<MessageCode, { kind: FixKind; hint: string }>>` and `SIGNAL_FIXES: Readonly<Record<FixSignalId, { kind: FixKind; hint: string }>>` exported from `packages/core/src/index.ts`; codes taken from the message-code description of `schema/report.v2.json` (`\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b`), P ids from the file names `packages/core/src/policy/rules/p[0-9][0-9].ts`
- AC-3 | unit | `packages/core/test/ac-fix-hints-words.test.ts` | every `hint` of `MESSAGE_FIXES` and `SIGNAL_FIXES` exported from `packages/core/src/index.ts`, scanned with a case-insensitive word-boundary regex and for placeholder characters (`{`, `}`, `<`, `>`, `$`)
- AC-4 | unit | `packages/core/test/ac-fix-hints-mapping.test.ts` | the `kind` of every entry of `MESSAGE_FIXES` and `SIGNAL_FIXES` exported from `packages/core/src/index.ts`, against the SPEC's Data mapping written out in the test
- AC-5 | integration | `packages/core/test/ac-fix-hints-findings.test.ts` | `check(input: CheckInput): Report` from `packages/core/src/index.ts` over existing fixtures only (`fixtures/test-integrity/TI01`, `TI05`, `TI14`, `TI11`, `fixtures/policy-rules/p11` and `p14` with an agent pull request, `fixtures/stale-instructions`, `fixtures/injection`, `fixtures/dependencies` with D04 and D05), reading `fix` on `testIntegrity.signals`, `policy.violations`, `setupHealth.stale`, `injection.signals`, `dependencies.signals`, compared with `SIGNAL_FIXES` and `fixTarget(path, line)`, and `expectValidReport` from `packages/core/test/schema.ts`
- AC-6 | integration | `packages/core/test/ac-fix-hints-messages.test.ts` | `check()` from `packages/core/src/index.ts` over the same existing fixtures, reading `fix` on every item of `report.messages`, compared with `MESSAGE_FIXES[code]`
- AC-7 | integration | `packages/core/test/ac-fix-hints-no-leak.test.ts` | `check()` from `packages/core/src/index.ts` over an existing test-integrity fixture whose diff text is rewritten in memory to carry a unique identifier and a secret-shaped string in added lines and test names, and an existing `fixtures/dependencies` case whose added package name is read from the report's `dependencies.signals[].name`; no new file under `fixtures/`
- AC-8 | unit | `packages/core/test/ac-fix-hints-schema.test.ts` | the files `schema/report.v2.json` (parsed, `$ref` to `#/$defs/fix` resolved) and `schema/report.v1.json`, compared with `git show 7d88076280ec86435c3f84ad3c6102e272ab64d5:<path>`, and `validateReport` from `packages/core/test/schema.ts` on a report without any `fix`
- AC-9 | integration | `packages/cli/test/ac-fix-hints-golden.test.ts` | the CLI `main(["check", "--format", "json", ...], deps)` from `packages/cli/src/main.ts` on `fixtures/golden`, `fixtures/golden-cobertura`, `fixtures/golden-multi` and `fixtures/golden-exclusions`, and `renderMarkdown(report)` from `packages/core/src/index.ts`, against the committed `report.json` files and, byte for byte, the `report.md` files at `7d88076280ec86435c3f84ad3c6102e272ab64d5`
- AC-10 | unit | `packages/core/test/ac-fix-hints-upload.test.ts` | `buildUploadBundle(report, meta, options?)` from `packages/core/src/index.ts` on a `check()` report carrying `fix` on messages and on every kind of finding, reading the bundle's `reportJson`
- AC-11 | integration | `packages/action/test/ac-fix-hints-action.test.ts` | `run(...)` from `packages/action/src/run.ts` with in-memory deps, a streamed local diff and lcov from `fixtures/golden`, and the CLI `main(["check", "--format", "json", ...])` from `packages/cli/src/main.ts` on the same inputs, against `fixtures/golden/report.json` (tool.version set to `VERSION`), with no compare-API call
- AC-12 | integration | `packages/core/test/ac-fix-hints-pins.test.ts` | `withoutV090SchemaEdits(text: string): string` and `withoutFix<T>(value: T): T` from `packages/core/test/v090-codes.ts`; `git diff --name-status` from `7d88076280ec86435c3f84ad3c6102e272ab64d5` (frozen to the commit that adds the test once committed) over `packages/*/test` for deleted files, added `.skip`/`.only`/`.todo`/`skipIf` and the `fix-hints (H6)` marker on each modified existing test; and a child vitest run over the modified existing test files
- AC-13 | unit | `packages/core/test/ac-fix-hints-docs.test.ts` | the files `README.md` (section headed "Fix hints"), `CHANGELOG.md` (the Unreleased section), `docs/LIMITS.md` (a fix-hints section) and `schema/report.v2.json` (descriptions of `fix`, `kind`, `target`, `hint`)
