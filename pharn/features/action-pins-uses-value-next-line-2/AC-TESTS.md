---
spec_id: action-pins-uses-value-next-line-2
spec_content_hash: faaf6226f4a2003a64719b2dc02e2882fb87e1c3dfd6ec9e644788984c5b9f8a
---

## Files

- `packages/core/test/ac-action-pins-uses-empty-2.test.ts` — the tests for AC-1, AC-2 and AC-3, with local copies of `runPins`, `steps`, `X` and the `temps` list with its `afterEach` cleanup from `packages/core/test/ac-review-medium-ci.test.ts`

## Mapping

- AC-1 | integration | `packages/core/test/ac-action-pins-uses-empty-2.test.ts` | `node scripts/check-action-pins.mjs` spawned by `runPins(workflow)` in a temp dir holding `.github/workflows/x.yml` = `steps("- uses:", "  actions/checkout@v4")`, and again with `actions/checkout@<40-hex SHA>` on the second line, reading exit status and stderr (`${X}:4  uses: with no value on its line`)
- AC-2 | integration | `packages/core/test/ac-action-pins-uses-empty-2.test.ts` | `node scripts/check-action-pins.mjs` spawned by `runPins(workflow)` on `steps("- uses: # note")` and on `steps("- run: |", "    echo uses:")`, reading exit status, stderr (`uses: with no value on its line`) and stdout (`ok   every workflow action is pinned to a commit SHA`)
- AC-3 | integration | `packages/core/test/ac-action-pins-uses-empty-2.test.ts` | `node scripts/check-action-pins.mjs` spawned by `runPins(workflow)` on `steps("- { name: x, uses:", "  actions/checkout@v4 }")`, reading exit status and stderr (`uses: with no value on its line`)
