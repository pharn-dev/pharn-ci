---
spec_id: pr-comment-logo-2
spec_content_hash: "3951f4d427b2bc235108ec78b8743ec0a941e9224237fc69fa338a356fd4070e"
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/render/logo.ts`, the logo slot in `packages/core/src/render/markdown.ts`
> (lines 64-65), `packages/core/src/index.ts`, `fitMarkdown`, `COMMENT_MARKER`, `commentScopeLine` and
> `MAX_COMMENT_LENGTH` in `packages/action/src/run.ts`, `packages/action/test/harness.ts`, `packages/cli/test/fake-deps.ts`,
> `packages/cli/src/main.ts` (`main`, `EXIT_OK`), the head of `docs/assets/pharn-logo.svg` (starts `<svg`, `<title>` on
> line 2), `fixtures/golden/report.md` and `report.json` (sha256 `a92f89d7…511c9` and `37d7101a…f8635f7`), the hash
> constants in `ac-format-golden.test.ts` and `ac-paths-partial.test.ts`, README "Example PR comment", THREAT-MODEL B1
> and CHANGELOG Unreleased. The stopped earlier run's record `pharn/features/pr-comment-logo/` (PLAN, GRILL,
> RUN-REPORT) was read as DATA only; every fact taken from it was re-checked live, including the dry run below.

The renderer already has the slot. `renderMarkdown()` calls `logoMarkup()` from `packages/core/src/render/logo.ts` and,
when it returns a non-empty string, pushes it and one empty line above the `## 🛡️ pharn-ci · <icon> <Label>` heading.
So the product change is one module constant: `logoMarkup()` returns the AC-1 string (a fixed `<img>` pointing at the
raw `main` URL of `docs/assets/pharn-logo.svg`, alt `pharn`, 48 by 48). Nothing input-derived reaches it, and core stays
pure: a string constant, no I/O, no clock. `markdown.ts` needs no edit.

The PR comment, the job summary and the CLI all print `renderMarkdown()` output, so all three gain the line. The
Action's `fitMarkdown()` prepends the marker and scope line to a full re-render at each fallback row count, so the logo
line and heading always stay; `run.ts` is not edited. The Action still finds its comment by marker and scope line, and
it makes no new request: GitHub loads the image when the comment is viewed.

**Dry run this run.** In a scratch copy outside the project, with `logoMarkup()` returning the AC-1 string, `vitest run
-u` then `vitest run`:
- the five tracked `report.md` goldens and `markdown.test.ts.snap` changed, and no `report.json`;
- `fixtures/golden/report.md` gained exactly two lines at the top (the logo line and an empty line), and its lines 3
  onward hash to `a92f89d7…511c9`, the committed file's hash;
- 16 test files (24 tests) still failed. They are the ones listed under "Existing tests corrected" below, and
  `packages/cli/test/main.test.ts` passed unchanged.

Every other change is that intentional output change spreading through the goldens and the tests that pinned the old
"no image, heading first" shape.

### Existing tests corrected (never weakened, AGENTS.md rule 4)

Each correction allows exactly the one fixed logo line and its empty line at the top, and still forbids every other
`<img`, `![`, `http://` and `https://`. No assertion is deleted; titles stay unless they state the old rule. Core tests
import `logoMarkup` from `../src/render/logo.js`. `logoMarkup` is not exported from `@pharn-ci/core`, so action tests
write the expected string inline, and `packages/core/src/index.ts` stays unchanged. Three patterns:

1. **"the heading is the first (non-empty) line"**: assert `lines[0] === LOGO` and `lines[1] === ""`, then find the
   heading from index 2 (or as the first non-empty line after the logo block).
2. **"no image or URL anywhere"**: assert the first line equals the logo, then run the same `not.toContain` checks on
   the rendering with that first line removed. The hostile checks (no `<img` outside code spans, no `://` on message
   lines) run the same way on the rendering without its first line.
3. **hash-pinned golden markdown** (`GOLDEN_MD_SHA256`, `GOLDEN_COBERTURA_MD_SHA256`, `EXCLUSIONS_MD_SHA256`): recompute
   each hash over the regenerated committed file, with the same derivation the test already applies (for example its
   message-line removal), using a throwaway `node -e` that writes nothing. Extend the comment above the constants with
   one sentence: the pr-comment-logo-2 feature added the fixed logo line and an empty line above the heading on purpose;
   the JSON report, and so its hash, did not change. Every `*_JSON_SHA256` stays.

Test titles cited in `docs/THREAT-MODEL.md` keep their exact text:
- B1: `markdown.test.ts › keeps PR-controlled paths and message text from injecting markdown`;
- B1: `exclusions-report.test.ts › AC-16: keeps hostile excluded paths from adding lines, headings or raw HTML`;
- B3: the `run.test.ts` truncation test.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON` this run; the project has no
  `memory-bank/lessons-learned.md` yet, so there is no promoted lesson to apply.

## Steps

- In `packages/core/src/render/logo.ts`, replace the empty return with a module constant holding the AC-1 string, and
  rewrite the doc comment:
  - the slot renders the pharn mark from `docs/assets/pharn-logo.svg` through its raw `main` URL;
  - `docs/assets/pharn-ci-logo.svg` is still never used;
  - fixed markup only, nothing input-derived.
- Regenerate with only the tests that own the files:
  `pnpm vitest run -u packages/core/test/golden.test.ts packages/core/test/markdown.test.ts packages/core/test/ac-format-golden.test.ts packages/core/test/ac-globs-golden.test.ts packages/core/test/exclusions-golden.test.ts packages/core/test/ac-paths-unmatched-check.test.ts`.
  Review the diff: each `report.md` and both snapshots gain exactly the logo line and one empty line at the top, and no
  `report.json` changes. If a listed test asserts before its file snapshot is written, correct that test first and
  re-run.
- Then recompute the hash constants in `ac-format-golden.test.ts` and `ac-paths-partial.test.ts` (pattern 3).
- Correct the remaining failing test files with patterns 1 and 2:
  - `ac-comment-bold-overview.test.ts`: the `header()` helper asserts the logo line first, then takes heading and
    overview as the first two non-empty lines after it. Its "(the logo slot is empty)" comment is updated.
  - `ac-comment-bold-header.test.ts`: the first non-empty line is the logo; the next three are heading, overview and
    table header.
  - `ac-comment-bold-footer.test.ts`: the first line is asserted to be the logo; the banned strings are checked on each
    rendering without it.
  - `ac-comment-bold-hostile.test.ts`: line 0 is asserted to be the logo; the no-`<img`-outside-code check skips it.
  - `ac-comment-look-header.test.ts`, `ac-comment-look-summary.test.ts`, `ac-comment-look-collapse.test.ts`: the heading
    is found after the logo block, not as the first non-empty line.
  - `ac-comment-look-footer.test.ts`:
    - `logoMarkup()` is expected to equal the fixed string;
    - the title's "with an empty logo slot" becomes "with only the fixed logo line";
    - the heading is found after the logo block, and the `<img`, `![`, `http://`, `https://` checks run without line 0.
  - `ac-comment-look-hostile.test.ts`: the code-span-stripped `<img` check runs without line 0.
  - `markdown.test.ts`: the `@`/`<img` line filter and the code-span-stripped `<img` check skip line 0 after asserting it
    is the logo.
  - `exclusions-report.test.ts`: assert `lines[0]` is the logo and `lines[1]` is empty, then compare `headings[0]` with
    `lines[2]`; the `<img` check skips line 0.
  - `packages/action/test/run.test.ts`: the three `startsWith` body checks expect
    `${COMMENT_MARKER}\n${SCOPE}\n${LOGO}\n\n## 🛡️ pharn-ci · …`.
  - `packages/action/test/ac-comment-look-fit.test.ts` and `ac-comment-bold-fit.test.ts`: the line after the scope line
    is the logo, then an empty line, then the heading; the overview is the first non-empty line after the heading.
- `README.md`, "Example PR comment": add the logo as the first quoted lines (`> <img …>` then `>`), matching the
  regenerated `fixtures/golden/report.md`.
- `CHANGELOG.md`, Unreleased › Changed: add one line. The PR comment, job summary and CLI markdown now show the pharn
  logo (a 48×48 image from the repository's raw `main` URL) above the verdict heading; report data and message text are
  unchanged.
- `docs/THREAT-MODEL.md`, row B1: add one sentence. The only image in the rendering is the fixed logo line from
  `logo.ts`, a constant URL to `docs/assets/pharn-logo.svg` on `main`, never input-derived. **Residual:** the image
  follows `main` (protected by the rulesets), so a later change to that file changes every comment; GitHub fetches it
  through its image proxy when a comment is viewed. Cite the new AC-3 test title.
- Run `pnpm build`; of what it writes, only `packages/action/dist/index.js` is tracked.
- Run `pnpm test` and `pnpm lint` and get them green. Run `pnpm format` only on files in `## Files`, named one by one.

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
- `packages/core/src/index.ts` — no new export; tests import `logo.ts` directly or write the string inline
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
- `packages/core/test/ac-comment-bold-data.test.ts` — passed unchanged in the dry run
- `packages/core/test/ac-comment-look-data.test.ts` — passed unchanged in the dry run
- `packages/cli/test/main.test.ts` — passed unchanged in the dry run (`toContain` on the heading)

## Acceptance mapping

- AC-1 → `logo.ts` returns the exact fixed string; the AC-1 test compares it byte for byte.
- AC-2 → `renderMarkdown()` puts the logo and an empty line above the unchanged heading. The golden rendering without
  its first two lines hashes to `a92f89d7fd9fa8c81d2a6de24df49b686becb8e4d3f84868a63ef2cde04511c9`, the committed
  `fixtures/golden/report.md` before this increment (verified in the dry run).
- AC-3 → the logo is pushed unconditionally by `renderMarkdown()`, whatever the verdict or data. No other code path
  emits an image or URL, and the hostile fixture's escaping is untouched.
- AC-4 → `docs/assets/pharn-logo.svg` is committed and starts `<svg`; the URL's path after `…/main/` is that file.
- AC-5 → no change to `check()`, `report.ts` or the schema; `fixtures/golden/report.json` stays as committed
  (sha256 `37d7101a…f8635f7`).
- AC-6 → `fitMarkdown()` re-renders the whole report with fewer rows, so marker, scope line, logo line, empty line and
  heading always open the body. `run.ts` needs no change.
- AC-7 → `run()` posts `COMMENT_MARKER\nSCOPE\n` plus `renderMarkdown()`, which now opens with the logo block.
- AC-8 → `main()` prints `renderMarkdown()` output, whose first line is now the logo.

## Risks & open questions

- Until this branch is merged to `main`, the raw URL may 404, and a comment rendered before the merge shows the alt
  text. The SPEC Assumptions accept this.
- The hash constants in `ac-format-golden.test.ts` and `ac-paths-partial.test.ts` change again. The build must write
  the reason next to them, as those files already do, so the change is reviewable.
- Thirteen corrected test files are earlier features' AC tests (the six `ac-comment-look-*` and five `ac-comment-bold-*`
  files, `ac-format-golden`, `ac-paths-partial`). Their locks pin them for those features' records only. The PR description
  must say why each was corrected (AGENTS.md rule 4).
- `ac-comment-look-footer.test.ts`'s title changes, because "empty logo slot" is no longer true. No doc cites it.
- The AC test files in `AC-TESTS.md` are written by `/pharn-test` and stay out of this plan's `## Files`. They use new
  names: the stopped `pr-comment-logo` run mapped `ac-pr-logo-*` names, which this feature does not reuse.
- The `GRILL.md` of the stopped run flagged, as advisory, a hardcoded user-facing string (the alt text). It is a fixed
  brand name the SPEC chose, not translatable copy.
