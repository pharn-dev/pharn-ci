---
spec_id: settings-unparseable-fails-closed
spec_content_hash: 5632523d7377c37e44883fe24a9a1f539b46368a51fcfe947811b566ea96fb0b
---

## Files

- `packages/core/test/ac-unparseable-padded-both.test.ts` — the tests for AC-1
- `packages/core/test/ac-unparseable-binary-settings.test.ts` — the tests for AC-2
- `packages/core/test/ac-unparseable-mcp-only.test.ts` — the tests for AC-3
- `packages/core/test/ac-unparseable-not-edited.test.ts` — the tests for AC-4
- `packages/core/test/ac-unparseable-complies.test.ts` — the tests for AC-5
- `packages/core/test/ac-unparseable-levels.test.ts` — the tests for AC-6
- `packages/core/test/ac-unparseable-docs.test.ts` — the tests for AC-7

## Mapping

- AC-1 | integration | `packages/core/test/ac-unparseable-padded-both.test.ts` | `check()` from `packages/core/src/check.ts` with `policy: { source: "file", path: "policy/org.json", document }`, `policySettingsSources: { files, dropped: [] }` and `diff: { text }` from `fixtures/policy-settings/unparseable/violates-padded-both/`, reading `report.verdict`, `report.policy.violations` (P09) and the `POLICY_SETTINGS_INVALID` message; plus `JSON.parse` on both fixture texts
- AC-2 | integration | `packages/core/test/ac-unparseable-binary-settings.test.ts` | `decodeTestSourceText(bytes: Uint8Array): string | null` from `packages/core/src/testSourceText.ts` (via `@pharn-ci/core`) on the `violates-binary-settings` text with its marker byte set to 0xff, then `check()` with `policySettingsSources: { files: [], dropped: [{ path: ".claude/settings.json", reason: "binary" }] }` and the case's `pr.diff`, reading `report.verdict`, `report.policy.violations` (P09) and the `POLICY_SETTINGS_INVALID` message
- AC-3 | integration | `packages/core/test/ac-unparseable-mcp-only.test.ts` | `check()` with the `violates-padded-mcp-only` policy, files and `pr.diff`, reading `report.verdict`, `report.policy.violations` (P09) and the `POLICY_SETTINGS_INVALID` message; plus `JSON.parse` on the fixture text
- AC-4 | integration | `packages/core/test/ac-unparseable-not-edited.test.ts` | `check()` with the `violates-not-json-unedited` policy and files and `diff: { text: fixture("golden/pr.diff") }`, reading `report.verdict`, `report.policy.violations` (no P09 for `.claude/settings.json`) and the `POLICY_SETTINGS_INVALID` message
- AC-5 | integration | `packages/core/test/ac-unparseable-complies.test.ts` | `check()` with the `complies-unpadded` policy, files and `pr.diff`, reading `report.messages` (no `POLICY_SETTINGS_INVALID`) and `report.policy.violations` (P09 `info` "it complies" per path)
- AC-6 | unit | `packages/core/test/ac-unparseable-levels.test.ts` | `packages/core/src/check.ts#check(input: CheckInput): Report` over the `fixtures/policy-settings/unparseable/levels/` texts and `decodeTestSourceText(bytes: Uint8Array): string | null` for the binary drops, reading the level and exact text of each `POLICY_SETTINGS_INVALID` message
- AC-7 | unit | `packages/core/test/ac-unparseable-docs.test.ts` | the `| C5 |` row of `docs/THREAT-MODEL.md` §2 and the `## [Unreleased]` → `### Security` bullets of `CHANGELOG.md`, read as text
