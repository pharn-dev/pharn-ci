---
spec_id: pr-comment-logo
spec_content_hash: "3e4747735b10d93a7ccb5f8e1b6e2335e545700194ad29a7a063419e8fc80ec6"
applied_lessons: none
---

## Approach

The renderer already has the slot: `renderMarkdown()` in `packages/core/src/render/markdown.ts` calls
`logoMarkup()` from `packages/core/src/render/logo.ts` and, when it returns a non-empty string, pushes that string
and one empty line before the `## 🛡️ pharn-ci · <icon> <Label>` heading. So the product change is one line:
`logoMarkup()` returns the fixed string

`<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">`

as a module constant. Nothing input-derived reaches it, core stays pure (a string constant, no I/O, no clock), and
`markdown.ts` needs no edit. The PR comment, the job summary and the CLI all print `renderMarkdown()` output, so all
three gain the line. The Action's `fitMarkdown()` (`packages/action/src/run.ts`) prepends the marker and scope line
to a full re-render at each fallback row count, so the logo line and heading are always kept; `run.ts` is not
edited. The Action still finds its comment by marker and scope line (`commentScope` reads line 2), so it makes no
new request.

Everything else is the intentional output change spreading through the goldens and the tests that pinned the old
"no image / heading first" shape. A dry run in a scratch copy (logo filled in, `vitest run -u`, then `vitest run`)
showed: every regenerated `report.md` equals its committed file with exactly the two logo lines added at the top
(for `fixtures/golden/report.md`, the sha256 of lines 3 onward is `a92f89d7…511c9`, the committed file's hash).
After regeneration, 16 test files still fail. Each is corrected to allow exactly the one fixed logo line and its
empty line at the top, and keeps forbidding every other `<img`, `![`, `http://` and `https://`. No assertion is
deleted or loosened beyond that one line.

**How each correction is done (advisory guidance for the build).** Test files already import from core source,
so a corrected test imports `logoMarkup` from `../src/render/logo.js` (core tests) or `@pharn-ci/core` where it is
exported (check `packages/core/src/index.ts` first; when it is not exported, an action or CLI test writes the
expected string inline instead, and core's index is left unchanged). Three patterns:

1. **"heading is the first (non-empty) line"**: assert `lines[0] === LOGO` and `lines[1] === ""`, then look for
   the heading from index 2 (or as the first non-empty line after the logo block).
2. **"no image or URL anywhere"**: assert the first line equals the logo, then run the same `not.toContain`
   checks on the rendering with that first line removed. The hostile checks (no `<img` outside code spans, no
   `://` on message lines) run the same way on the rendering without its first line.
3. **hash-pinned golden markdown** (`GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256`):
   recompute the hash over the regenerated committed file (after the test's existing message removal), and
   extend the comment above the constants with one sentence: this feature added the fixed logo line and an empty
   line above the heading on purpose; the JSON report, and so its hash, did not change. JSON hash constants stay
   as they are.

Test titles cited in `docs/THREAT-MODEL.md` (B1: `markdown.test.ts › keeps PR-controlled paths and message text
from injecting markdown`, `exclusions-report.test.ts › AC-16: keeps hostile excluded paths from adding lines,
headings or raw HTML`; B3: `run.test.ts › truncates a comment over GitHub's size limit…`) keep their exact
titles.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON`; this project has no `memory-bank/lessons-learned.md`
  yet, so there is no lesson to apply.

## Steps

- In `packages/core/src/render/logo.ts`, replace the empty return with a fixed constant (the AC-1 string), and
  rewrite the doc comment: the slot now renders the pharn mark from `docs/assets/pharn-logo.svg` by its raw `main`
  URL; `docs/assets/pharn-ci-logo.svg` is still never used here; fixed markup only, nothing input-derived.
- Run `pnpm vitest run -u` once to regenerate the five golden `report.md` files and the markdown snapshot. Review
  the diff: each file and snapshot gains exactly the logo line and one empty line at the top and nothing else.
  `report.json` files must not change.
- Correct the 16 failing test files listed under `## Files` with the three patterns in the Approach. Per file:
  - `ac-comment-bold-overview.test.ts`: the `header()` helper skips the logo line (assert it first), so heading
    and overview are the first two non-empty lines after it. Update the stale "(the logo slot is empty)" comment.
  - `ac-comment-bold-header.test.ts`: the first non-empty line is the logo; the next three are heading, overview
    and table header.
  - `ac-comment-bold-footer.test.ts`: banned strings checked on each rendering without its first line, plus an
    assertion that the first line is the logo.
  - `ac-comment-bold-hostile.test.ts`: the no-`<img`-outside-code check skips line 0 after asserting it equals
    the logo.
  - `ac-comment-look-header.test.ts`, `ac-comment-look-summary.test.ts`, `ac-comment-look-collapse.test.ts`: the
    heading is found after the logo block, not as the first non-empty line.
  - `ac-comment-look-footer.test.ts`: `logoMarkup()` is expected to equal the fixed string (title wording
    "with an empty logo slot" changed to "with only the fixed logo line"); the heading is located after the logo
    block, and the `<img`, `![`, `http://`, `https://` checks run on the rendering without line 0.
  - `ac-comment-look-hostile.test.ts`: the code-span-stripped `<img` check runs on the rendering without line 0.
  - `markdown.test.ts`: the `@`/`<img` line filter and the code-span-stripped `<img` check skip line 0 after
    asserting it is the logo.
  - `exclusions-report.test.ts`: `headings[0]` is compared with `lines[2]` (after asserting `lines[0]` is the logo
    and `lines[1]` is empty); the `<img` check skips line 0.
  - `ac-format-golden.test.ts` and `ac-paths-partial.test.ts`: recompute the markdown hash constants as described,
    with the reason.
  - `packages/action/test/run.test.ts`: the three `startsWith` body checks expect
    `${COMMENT_MARKER}\n${SCOPE}\n${LOGO}\n\n## 🛡️ pharn-ci · …`.
  - `packages/action/test/ac-comment-look-fit.test.ts` and `ac-comment-bold-fit.test.ts`: the line after the
    scope line is the logo, then an empty line, then the heading; the overview is the first non-empty line after
    the heading.
- `README.md`, "Example PR comment": add the logo as the first quoted line (`> <img …>` then `>`), matching the
  regenerated `fixtures/golden/report.md`.
- `CHANGELOG.md`, Unreleased › Changed: one line saying the PR comment, job summary and CLI markdown now show the
  pharn logo (a 48×48 image loaded from the repository's raw `main` URL) above the verdict heading; report data and
  message text are unchanged.
- `docs/THREAT-MODEL.md`, row B1: one sentence that the only image in the rendering is the fixed pharn logo line
  from `logo.ts`, a constant URL to `docs/assets/pharn-logo.svg` on `main`, never input-derived. **Residual:**
  the image follows `main` (protected by the rulesets), so a later change to that file changes every comment,
  and GitHub fetches it through its image proxy when a comment is viewed. Cite the new AC-3 test title.
- Run `pnpm build` and commit the rebuilt `packages/action/dist/index.js` with the change.
- Run `pnpm test` and `pnpm lint`; format only the files listed below, by name.

## Files

- `packages/core/src/render/logo.ts` — `logoMarkup()` returns the fixed `<img …>` line (module constant); doc comment rewritten
- `fixtures/golden/report.md` — regenerated: logo line and an empty line above the heading
- `fixtures/golden-cobertura/report.md` — regenerated: as above
- `fixtures/golden-exclusions/report.md` — regenerated: as above
- `fixtures/golden-multi/report.md` — regenerated: as above
- `fixtures/coverage-paths/package-relative/report.md` — regenerated: as above
- `packages/core/test/__snapshots__/markdown.test.ts.snap` — regenerated: both snapshots gain the logo block
- `packages/core/test/markdown.test.ts` — hostile-injection test allows only the logo as line 0; title unchanged
- `packages/core/test/exclusions-report.test.ts` — AC-16 heading index and `<img` check allow only the logo line; title unchanged
- `packages/core/test/ac-format-golden.test.ts` — `GOLDEN_MD_SHA256` recomputed with the reason
- `packages/core/test/ac-paths-partial.test.ts` — `GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256` recomputed with the reason; JSON hashes unchanged
- `packages/core/test/ac-comment-bold-overview.test.ts` — heading and overview read after the logo block
- `packages/core/test/ac-comment-bold-header.test.ts` — first non-empty line is the logo, then heading, overview, table header
- `packages/core/test/ac-comment-bold-footer.test.ts` — banned image and URL strings checked without the logo line
- `packages/core/test/ac-comment-bold-hostile.test.ts` — no `<img` outside code, except the asserted logo line 0
- `packages/core/test/ac-comment-look-header.test.ts` — heading located after the logo block
- `packages/core/test/ac-comment-look-summary.test.ts` — heading located after the logo block
- `packages/core/test/ac-comment-look-collapse.test.ts` — heading located after the logo block
- `packages/core/test/ac-comment-look-footer.test.ts` — `logoMarkup()` expected to be the fixed line; image and URL checks without line 0
- `packages/core/test/ac-comment-look-hostile.test.ts` — `<img` check without the logo line
- `packages/action/test/run.test.ts` — comment body prefix includes the logo block before the heading; titles unchanged
- `packages/action/test/ac-comment-look-fit.test.ts` — logo line and empty line expected between scope line and heading
- `packages/action/test/ac-comment-bold-fit.test.ts` — logo block skipped before heading and overview
- `README.md` — "Example PR comment" gains the logo as its first quoted line
- `CHANGELOG.md` — Unreleased › Changed line for the header logo
- `docs/THREAT-MODEL.md` — B1 note on the fixed first-party header image and its residual
- `packages/action/dist/index.js` — rebuilt bundle (core changed)

### Explicitly not touched

- `packages/core/src/render/markdown.ts` — already pushes a non-empty `logoMarkup()` and one empty line above the heading
- `packages/core/src/index.ts` — no new export needed; tests import `logo.ts` directly or write the string inline
- `packages/action/src/run.ts` — `fitMarkdown`, marker, scope line, limits and fallback rows unchanged; every re-render keeps the header block
- `packages/cli/src/main.ts` — prints `renderMarkdown` output as today
- `schema/report.v1.json` — no schema change
- `packages/core/src/report.ts` — report data, message codes, text and hints unchanged
- `fixtures/golden/report.json` — report data unchanged; AC-5 compares against it as committed
- `fixtures/golden-cobertura/report.json` — unchanged
- `fixtures/golden-exclusions/report.json` — unchanged
- `fixtures/golden-multi/report.json` — unchanged
- `fixtures/coverage-paths/package-relative/report.json` — unchanged
- `fixtures/render/hostile-paths.json` — AC-3 input, read only
- `docs/assets/pharn-logo.svg` — the artwork, read by AC-4 only
- `docs/assets/pharn-ci-logo.svg` — never linked or embedded
- `packages/core/test/ac-comment-bold-data.test.ts` — passes unchanged (JSON hash and message lines only)
- `packages/core/test/ac-comment-look-data.test.ts` — passes unchanged
- `packages/cli/test/main.test.ts` — passes unchanged (`toContain` on the heading)

## Acceptance mapping

- AC-1 → `logo.ts` returns the exact fixed string; the AC-1 test compares it byte for byte.
- AC-2 → `renderMarkdown()` puts the logo and an empty line above the unchanged heading; lines 3 onward of the
  golden rendering hash to `a92f89d7fd9fa8c81d2a6de24df49b686becb8e4d3f84868a63ef2cde04511c9`, the committed
  `fixtures/golden/report.md` before this increment (the AC test pins that hash inline).
- AC-3 → the logo is emitted unconditionally by `renderMarkdown()`, whatever the verdict or data; no other code
  path emits an image or URL, and the hostile fixture's escaping is untouched.
- AC-4 → `docs/assets/pharn-logo.svg` is committed and starts `<svg`; the URL's path after `.../main/` is that file.
- AC-5 → no change to `check()`, `report.ts` or the schema; `fixtures/golden/report.json` is left as committed
  (sha256 `37d7101a…f8635f7`).
- AC-6 → `fitMarkdown()` re-renders the whole report with fewer rows, so marker, scope line, logo line, empty line
  and heading are always the start of the body; no change to `run.ts` is needed.
- AC-7 → `run()` posts `COMMENT_MARKER\nSCOPE\n` + `renderMarkdown()`, which now starts with the logo block.
- AC-8 → `main()` prints `renderMarkdown()` output, whose first line is now the logo.

## Risks & open questions

- Until this branch is merged to `main`, the raw URL may 404 (the SVG was committed on this branch's history; it
  is in `HEAD` now). A comment rendered before merge shows the alt text. Accepted in the SPEC Assumptions.
- The hash-pinned constants in `ac-format-golden.test.ts` and `ac-paths-partial.test.ts` change for the fourth
  time; the build must write the reason next to them, per the files' own convention, so the change is reviewable.
- Three corrected tests are other features' AC tests (pr-comment-redesign-2, pr-comment-bold-look). Their locks
  pin them for those features' records only; the PR description must say why each was corrected (AGENTS.md rule 4).
- `ac-comment-look-footer.test.ts`'s title changes ("empty logo slot" no longer true); it is cited nowhere in
  `docs/`, so no doc reference breaks.
- The build must not add the AC test files below (AC-TESTS.md) to this plan's scope; they are written by
  `/pharn-test`.
