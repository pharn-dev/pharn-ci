---
spec_id: action-pins-uses-value-next-line-2
spec_content_hash: faaf6226f4a2003a64719b2dc02e2882fb87e1c3dfd6ec9e644788984c5b9f8a
applied_lessons: none
---

## Approach

ADVISORY (model work). `scripts/check-action-pins.mjs` reads each workflow line by line. After the block-scalar
early return and `stripComment`, it runs the `USES` regex, which needs at least one value character after `uses:`. A
`uses` key that ends its line (value on the next line, a comment only, or a flow mapping split after `uses:`) matches
nothing, so it is never checked (CORE-147). The fix adds the regex the SPEC's Constraints give, `USES_EMPTY`, next to
`USES`, and tests it against the same comment-stripped line text right after the existing `USES` loop in `check()`.
A match pushes one entry into the existing `bad` list, so it prints under the existing heading line and the script
exits 1, as it does for an unpinned ref. The next line is never read: the key's own line decides, so a pinned SHA on
the next line is reported the same way as a tag.

Block-scalar text is already skipped by the early `return` at the top of the `forEach` callback (the
`blockKeyColumn` branch), which runs before the comment strip and before both regexes. So a `run: |` line whose text
ends in `uses:` never reaches the new check. Lines where `USES` matches behave exactly as today: `USES_EMPTY` needs
only optional quote and white space between the colon and the end of the line, so a line with a value on it does not
match.

The AC tests go in the new file the SPEC names, `packages/core/test/ac-action-pins-uses-empty-2.test.ts`, mapped in
`AC-TESTS.md` (not in `## Files` below, so the build is not scoped to it). It carries its own copies of the `runPins`,
`steps` and `X` helpers (and the `temps` list with its `afterEach` cleanup that `runPins` relies on) from
`packages/core/test/ac-review-medium-ci.test.ts`, so each test runs the script in a temp directory and never against
the repo's `.github/`. The earlier run's file name, `ac-action-pins-uses-empty.test.ts`, is claimed by
`pharn/features/action-pins-uses-value-next-line/AC-TESTS.md`, so this name is the free one.

## Applied lessons

- none — the project has no memory-bank yet (`check-lessons-index.mjs --verdict` printed `NO_CANON` this run), so
  there are no lessons to apply.

## Steps

- In `scripts/check-action-pins.mjs`, directly below the `USES` constant (line 11), add this constant with a one-line
  comment above it saying it matches a `uses` key that has no value on its line (the value is on the next line, only
  a comment follows, or a flow mapping is split after the key):
  `const USES_EMPTY = /(?:^|[\s{,-])["']?uses["']?\s*:\s*["']?\s*$/;`
  Use exactly this pattern, character for character (SPEC Constraints). It has no `g` flag, so `.test()` keeps no
  state between lines.
- In `check(file)`, immediately after the closing brace of the existing
  `for (const match of stripped.text.matchAll(USES)) { ... }` loop and before the `if (quote === "") { ... }`
  block-scalar detection, add:
  `if (USES_EMPTY.test(stripped.text)) bad.push(`${file}:${index + 1}  uses: with no value on its line`);`
  The entry is exactly `<file>:<line>  uses: with no value on its line`: the same `${file}:${index + 1}` prefix the
  existing entries use (the 1-based line of the `uses` key), then TWO spaces, then the message. It goes in the same
  `bad` array, so the existing heading line, the `  ${entry}` printing and `process.exit(1)` apply unchanged.
- Change nothing else in the script: not `USES`, `SHA`, `BLOCK_SCALAR`, `BLOCK_INDICATOR`, `stripComment`, `walk`,
  the `dirs` list, the header comment or the output lines. No new import, no dependency (AGENTS.md rule 6).
- Do not edit `packages/core/test/ac-review-medium-ci.test.ts` or any other existing test (AGENTS.md rule 4), and do
  not edit any file under `.github/`.
- Run `pnpm exec biome check scripts/check-action-pins.mjs` and fix formatting in that file only. Then run
  `node scripts/check-action-pins.mjs` from the repo root: it must still print
  `ok   every workflow action is pinned to a commit SHA` and exit 0. A read this run applied the new pattern to every
  line of the four files in `.github/workflows` and matched none; the script exits 0 today; `.github/actions` does not
  exist.

## Files

- `scripts/check-action-pins.mjs` — add the `USES_EMPTY` regex next to `USES`, and one `bad.push` in `check()` after the `USES` loop that reports `<file>:<line>  uses: with no value on its line`

### Explicitly not touched

- `packages/core/test/ac-review-medium-ci.test.ts` — existing tests stay byte-for-byte unchanged (AGENTS.md rule 4); its helpers are copied into the new AC test file, never edited or exported
- `packages/core/test/ac-action-pins-uses-empty-2.test.ts` — the AC test file; mapped in `AC-TESTS.md` and written by `/pharn-test`, never by the build
- `.github/workflows/ci.yml` — out of scope, including the `Action pins` job name; every other workflow too
- `.github/rulesets/` — out of scope
- `CHANGELOG.md` — no line: the script is repo tooling that is not shipped to users (SPEC Assumptions)
- `docs/THREAT-MODEL.md` — no change: the script is not part of the action or CLI and reads only the repo's own workflows

## Acceptance mapping

- AC-1 (`- uses:` on line 4 with `actions/checkout@v4` on the next line → exit 1, stderr has
  `.github/workflows/x.yml:4  uses: with no value on its line`; the same with a 40-hex SHA ref on the next line →
  exit 1) → `USES_EMPTY` matches `      - uses:` (`-` and a space precede `uses`, then `:` and end of line). The next
  line holds no `uses` key and is never consulted, so both workflows produce the same entry and exit 1. `steps` puts
  the first step on line 4, and `X` is the relative path the script prints.
- AC-2 (`- uses: # note` → exit 1 with the message; a `run: |` block whose text ends in `uses:` → exit 0 with
  `ok   every workflow action is pinned to a commit SHA`) → `stripComment` removes `# note`, leaving `      - uses: `,
  which `USES_EMPTY` matches (`\s*$` absorbs the trailing space). The block-scalar line is indented further than the
  `run: |` key column, so the existing `blockKeyColumn` early return skips it before any regex runs. That workflow has
  no other `uses` key, so `bad` stays empty and the `ok` line prints.
- AC-3 (a flow mapping `- { name: x, uses:` with `actions/checkout@v4 }` on the next line → exit 1 with the message)
  → `USES_EMPTY` matches ` uses:` at the end of the first line (the space before `uses` is in `[\s{,-]`). `USES` finds
  no value character there, and the next line has no `uses` key, so exactly the new entry is reported.

## Risks & open questions

- `USES_EMPTY` also matches `uses: "` or `uses: '` (a quote opened at the end of the line, a multi-line quoted value).
  That is reported too, which fits the intent (no value on the key's line). `uses: ""` (an empty quoted value) does
  not match; it is not in scope.
- A line where `USES` matches and a second `uses` key ends the line (`- { uses: a@v1, uses:`) yields two entries;
  harmless and out of scope.
- The `run: |` half of AC-2 passes before the build too (the SPEC's Assumptions say so); the `- uses: # note` half of
  the same criterion is what fails first at `/pharn-test`.
- The `Action pins` CI job runs this script on the repo's own workflows; none has a matching line today, so the job
  keeps passing with no workflow edit.
- The earlier run's LOOP.md records that the full vitest suite can exceed the 540 s per-gate timeout when the entry
  gates run it in parallel with `base:test` and `build`. That is load on this machine, not this feature; it can stop
  a loop at S14b again.
