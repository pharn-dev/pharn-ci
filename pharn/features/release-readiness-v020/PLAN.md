---
spec_id: release-readiness-v020
spec_content_hash: e13ec17d9897917aeb7d50b2a15f64613230e92abce855f87be158d4b48e7a10
applied_lessons: none
---

## Approach

> ADVISORY: model work, derived from the Approved SPEC. Discovery read this run: `docs/LIMITS.md` (section 1, the
> `### What TIxx misses` subsections, `### What the accept label misses` at line ~194, `## 2.` at ~213), `README.md`
> (Contents, `## Example PR comment`, `## Action reference`, `### Accept label`, `## Roadmap`), the `## [Unreleased]`
> section of `CHANGELOG.md`, `docs/RELEASING.md`, `product/TEST-INTEGRITY-SPEC.md` ("Definition of done" items 2 and 6),
> `packages/core/test/ac-skylos-nine-table.test.ts`, `ac-skylos-nine-added-skip.test.ts`, `ac-release-docs.test.ts`,
> `ac-accept-signoff-docs.test.ts`, `ac-stream-diff.test.ts`, `ac-stream-lcov.test.ts`, `packages/action/src/index.ts`,
> `packages/action/src/run.ts` (diff base resolution, outputs, summary), `packages/action/src/node-io.ts`,
> `packages/action/package.json`, `scripts/check-release-notes.mjs`, `biome.json`, `vitest.config.ts`, `.gitignore`.
> The `added-skip` case was rendered through a scratch bundle of `packages/core/src` to see the real section text.

Docs, one new script, one new fixture directory and AC tests. No file under `packages/*/src`, `schema/`, `action.yml`,
`packages/action/dist` or `.github/workflows/` changes, so no `pnpm build` is needed. Four parts:

1. **LIMITS.** A new unnumbered `## What test integrity does not catch` section between the end of
   `### What the accept label misses` and `## 2. When an input is missing`. It is unnumbered so that every existing
   `##` heading (and every "section N" cross-reference) stays as it is. Section 1's stale sentence is corrected.
2. **README and CHANGELOG.** A `## Test integrity` section between `## Example PR comment` and `## Action reference`
   (with its Contents line in the same position), a rewritten Roadmap bullet, and new lines appended to the end of
   `### Added` under `## [Unreleased]`. No existing CHANGELOG line changes.
3. **Smoke.** `scripts/smoke-release.mjs` (Node built-ins only) builds a throwaway git repository from
   `fixtures/smoke/`, runs `<action-dir>/packages/action/dist/index.js` against it with a fresh environment, and checks
   the exit code, the `verdict` output, the job summary lines and the footer version. The fixture directory is found
   from the script's own location (`import.meta.url`), not from the working directory, so a copy of the script and
   fixtures laid out as in the repository (AC-12, third setup) reads its own fixtures. `<action-dir>` is resolved
   against the working directory.
4. **RELEASING.** A fork-PR check step before **Release.**, and the `Release smoke` job and the smoke run in the dry
   run, described as the steps the maintainer adds to `release.yml` by hand.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON`, so this project has no `memory-bank/lessons-learned.md` yet and there is nothing to apply.

## Steps

1. **`docs/LIMITS.md`, section 1.** In the "Only added lines count" bullet, replace the sentence
   "Weakened, skipped or focused tests inside a file and deleted test cases are not detected yet." with one that says
   what is built: an added skip or focus marker is TI03 or TI04, and a weakened assertion, an emptied test body or a
   test case deleted from a file that stays are not detected yet (pointing to "What test integrity does not catch").
   The old sentence must not survive, even across a line break that the AC-4 test might join. Change nothing else in
   section 1.
2. **`docs/LIMITS.md`, new section.** Insert `## What test integrity does not catch` directly before
   `## 2. When an input is missing` (so after the last bullet of `### What the accept label misses`). Content, in order:
   - **Intro paragraph.** The shipped signals TI01, TI03, TI04, TI10, TI11, TI13 and TI14 read only the diff's added
     and removed lines of files they recognise by name. They do not run tests, parse syntax or read files outside the
     diff, and they cannot judge whether an assertion is strong. The accept label records that a reviewer who is not
     the author signed off. It cannot show that the reviewer read the tests, and it never adds a check. Point to the
     per-signal `What TIxx misses` subsections and `What the accept label misses` above.
   - **Skylos nine paragraph.** The Skylos benchmark's nine ways to hide a failing test, reproduced in vitest under
     `fixtures/skylos-nine/` and pinned by AC tests. The diff-only signals of this release catch **2 of 9**. Use that
     exact text `2 of 9`.
   - **Caught list.** Exactly two items, each naming only its one signal id and using exactly this shape:
     ``- `deleted-test` — caught by TI01: …`` and ``- `added-skip` — caught by TI03: …``.
   - **Missed list.** Exactly seven items, each naming only its planned id and using exactly the shape
     ``- `<case>` — missed; planned: TIxx …``:
     `emptied-assertion` TI05, `deselect-setting` TI09, `hard-coded-answer` TI15, `always-true-matcher` TI17,
     `replaced-test` TI02, `loosened-assertion` TI06, `edited-expected-value` TI07. TI17 is a proposal, not a signal in
     the test-integrity spec yet, and its item says so. An item may wrap onto continuation lines. No caught item
     contains `missed` or `planned`, and no missed item contains `caught by`.
   - **Further misses list** (the test-integrity spec's "Definition of done" item 6), three items:
     - a test replaced by a new test with the **same name** and a **trivial body**: TI02, planned, misses it when the
       name stays, and TI05, planned, catches only the zero-assertion case;
     - semantic weakening that keeps the matcher, such as `toEqual(expectedFromOutput)`;
     - a **mock** introduced in a **setup file** outside the diff.

     Every not-built id (TI02, TI05, TI06, TI07, TI09, TI15, TI17) appears only with the word `planned` (or
     "proposed" for TI17) nearby. No sentence says a not-built signal catches anything today.
3. **`README.md`, Contents.** Insert `- [Test integrity](#test-integrity)` between the `Example PR comment` and
   `Action reference` lines.
4. **`README.md`, new `## Test integrity` section.** Insert it after the `## Example PR comment` section (after its
   two trailing paragraphs and the `---` rule), followed by its own `---` rule before `## Action reference`. It holds
   no `uses:` line. Content:
   - The `test-integrity` input takes `block`, `warn` or `off`, and the `default` is `warn`. `test_integrity.mode` in
     `.pharn/ci.yml` can only make it `stricter`, never looser. Say what each mode does.
   - The seven shipped signals in one short list or sentence (TI01, TI03, TI04, TI10, TI11, TI13, TI14).
   - A link to `[Accept label](#accept-label)` for the reviewer sign-off on block findings.
   - **Example section.** A short lead-in line, then the "🔍 Test integrity" section that `renderMarkdown()` gives for
     `fixtures/skylos-nine/added-skip` in mode `block` (the Skylos AC tests' inputs). Copy it from the heading
     `### 🔍 Test integrity` to the line before the next `### `. Quote every line with `> ` and blank lines with `>`,
     like the existing "Example PR comment". The hint line keeps its two leading spaces after the `> `. Take the text
     from a real render, never by hand. The AC-6 test compares each non-blank line exactly, in order.
   - The Skylos result: the vitest reproduction of Skylos's nine cases, `2 of 9` caught today, with a link to
     `docs/LIMITS.md` (for example `[docs/LIMITS.md](./docs/LIMITS.md#what-test-integrity-does-not-catch)`).
5. **`README.md`, Roadmap.** Replace the two-line "Test-tampering detection (…already named by
   `TEST_FILES_DELETED`)" bullet with one that names the planned signals (emptied or loosened assertions, replaced
   tests, edited expected values, hard-coded answers, deselection settings) and links to
   `[Test integrity](#test-integrity)`. The phrase `deleted test files are already named by` must not remain. The other
   Roadmap bullets stay.
6. **`CHANGELOG.md`.** Append to the end of `### Added` under `## [Unreleased]`, after the Agent skills line:
   - one line on the Skylos nine benchmark: the nine hide-a-failing-test cases reproduced in vitest under
     `fixtures/skylos-nine/`, `2 of 9` caught by the diff-only signals (TI01 and TI03), pinned by AC tests;
   - one line on the new "What test integrity does not catch" section of `docs/LIMITS.md` and the README's Test
     integrity section.

   Edit no existing line, and add no `## [` heading. The `Report v2` line under `### Changed` stays byte-for-byte.
7. **`fixtures/smoke/`** (new, hand-written, tiny). Use no `.diff` or `.info` extension (the stream tests enumerate
   every `*.diff` and `*.info` under `fixtures/`), and no agent setup file such as `AGENTS.md` (this repository's own
   inventory would list a nested one):
   - `fixtures/smoke/base/src/math.js`: a small ES module with one exported function;
   - `fixtures/smoke/head/src/math.js`: the same file with a second function added (a few lines);
   - `fixtures/smoke/head/src/math.test.js`: a vitest-style test of both functions (never run, only committed);
   - `fixtures/smoke/coverage.lcov`: lcov for the head `src/math.js` (`SF:src/math.js`, a `DA:<line>,1` for every
     executable line, added lines included, `end_of_record`), so diff coverage is 100%;
   - `fixtures/smoke/expected-summary.txt`: the whole lines the job summary must contain, one per line. At least
     `### 🔍 Test integrity` and `No test-integrity findings (mode: block).`, plus the diff-coverage headline line from
     a real run. Never a line with `pharn-ci` followed by a space and a digit; the footer is checked separately. Take
     the lines from a real run of the committed bundle.

   `head/` is an overlay: the head commit is base plus every file under `head/` copied over it.
8. **`scripts/smoke-release.mjs`** (new; Node built-ins only, `node:`-prefixed imports, no `fetch`, no
   network modules). A header comment in the style of `scripts/check-release-notes.mjs` says what it runs and how.
   Flow:
   - **Arguments.** Exactly one argument, `<action-dir>`, else print usage to stderr and exit 2. Resolve it against
     `process.cwd()`. Bundle: `<action-dir>/packages/action/dist/index.js`. Version: `version` of
     `<action-dir>/packages/action/package.json`. An unreadable or missing version is a failed check named `version`.
   - **Fixtures.** `fileURLToPath(new URL("../fixtures/smoke/", import.meta.url))`.
   - **Temporary directory.** `mkdtempSync(join(tmpdir(), "pharn-ci-smoke-"))`, so `TMPDIR` decides the location. All
     work goes inside a `try`, with `rmSync(tmp, { recursive: true, force: true })` in `finally`. That covers success,
     a failed check and a thrown error.
   - **Repository.** Create `<tmp>/repo`, copy `base/` in (`cpSync`, recursive), then run
     `git init -q`, `git add -A` and `git commit -q -m base`. Copy `head/` over it, then `git add -A` and
     `git commit -q -m head`. Every git call uses `execFileSync("git", [...], { cwd, env })` with
     `-c user.name=pharn-ci-smoke -c user.email=smoke@invalid -c commit.gpgsign=false -c init.defaultBranch=main`.
     Its `env` is only `PATH` and `HOME`, so an inherited `GIT_DIR` or `GIT_INDEX_FILE` (a git hook running the
     tests) cannot redirect it. After the head commit, copy `coverage.lcov` to `<repo>/coverage/lcov.info`, untracked.
   - **Runner files.** Create empty `<tmp>/summary.md` and `<tmp>/output.txt` (`@actions/core`'s summary writer needs
     the file to exist) and the directory `<tmp>/runner-temp`.
   - **Run.** `spawnSync(process.execPath, [bundle], { cwd: repo, env, encoding: "utf8", timeout })`. The env is
     built from nothing:
     - `PATH` and `HOME` from the parent;
     - `INPUT_COVERAGE-FILE=coverage/lcov.info`, `INPUT_THRESHOLD=80`, `INPUT_BASE-REF=HEAD~1`,
       `INPUT_TEST-INTEGRITY=block`, `INPUT_COMMENT=false` and `INPUT_GITHUB-TOKEN=` (empty);
     - `GITHUB_WORKSPACE=<repo>`, `GITHUB_STEP_SUMMARY=<tmp>/summary.md`, `GITHUB_OUTPUT=<tmp>/output.txt` and
       `RUNNER_TEMP=<tmp>/runner-temp`.

     No other `GITHUB_*` or `INPUT_*` name is passed. Capture its stdout and stderr; never inherit them.
   - **Checks, in order. The first failure stops the run.**
     1. `exit`: status 0. On failure, say `exit code <n>, expected 0` (or the signal).
     2. `verdict`: parse `output.txt` in both forms (`name=value` lines and `name<<DELIM` … `DELIM` blocks). The
        `verdict` value must be `pass`. On failure, say `verdict "<value>", expected "pass"`.
     3. `summary`: every non-blank line of `expected-summary.txt` must equal a whole line of `summary.md` (lines
        trimmed of a trailing `\r`). On failure, name the first missing line verbatim.
     4. `footer`: some summary line contains `pharn-ci <version>` not followed by a digit or `.`. On failure, say
        `footer: no "pharn-ci <version>" in the job summary`.
   - **Output.** On success, print exactly one line to stdout: `ok pharn-ci <version>: exit 0, verdict pass, <n>
     summary lines, footer` (or similar, starting `ok`), and exit 0. On failure, print to stderr
     `smoke failed: <check>: <detail>`, then the bundle's captured stdout and stderr under a separator. Never print a
     line starting `ok`. Exit 1.
   - Keep it lint-clean under `biome check` (it is in scope of `biome.json`'s includes).
9. **`docs/RELEASING.md`.** Keep every heading, every list item's leading bold text and step 1 unchanged; the existing
   `ac-release-docs.test.ts` pins step 1's order. Add:
   - **Under step 2 (`**Dry run.**`)**, two indented sub-items, in this order:
     - `**Smoke in the dry run.**`: the dry run also runs `node scripts/smoke-release.mjs .` on the committed bundle,
       after the stale-dist check. A red smoke means no release. This item contains `smoke` and `dry run`.
     - `**Fork PR check.**`: before the release run, open a pull request from a fork against a throwaway repository
       whose workflow uses `pharn-dev/pharn-ci@<the release commit SHA>` on `pull_request`. Check that the run is
       green, that the job summary carries the report, and that no comment is posted: the fork token is read-only,
       so pharn-ci warns and uses the job summary only. This repository's CI cannot produce a fork PR, so this is a
       manual step. The item contains `fork`, `job summary` and `comment`.

     Both sit before `**Release.**`.
   - **Under step 3 (`**Release.**`)**, one indented sub-item, `**Release smoke.**`: after `Release publish`, the
     `Release smoke` job checks out the new tag and runs `node scripts/smoke-release.mjs .`. It builds a throwaway
     repository from `fixtures/smoke/`, runs the tagged bundle with no token and no event, and checks the exit code,
     the `verdict` output, the job summary and the footer version. If `Release smoke` is red, skip the Marketplace
     step and fix it with a new patch release (tags never move). The item contains `Release smoke`,
     `node scripts/smoke-release.mjs` and `Marketplace`.

   The sub-items use the existing indentation of the numbered list. Their wording must not break the
   `ac-release-docs.test.ts` patterns: for example, no item in step 1 starts `**Set the CHANGELOG date.**`.
10. **Gates.** `pnpm lint` and `pnpm test` pass, including the new AC tests and the unchanged existing ones (skylos
    nine, release docs, accept-label docs, TI docs, stream fixtures, golden).

## Files

- `docs/LIMITS.md` — section 1's stale "not detected yet" sentence corrected; new `## What test integrity does not catch` section before `## 2.`
- `README.md` — Contents line, new `## Test integrity` section with the rendered added-skip example and the 2-of-9 result, Roadmap bullet rewritten
- `CHANGELOG.md` — new lines at the end of `### Added` under `## [Unreleased]` (Skylos 2 of 9, the LIMITS section); nothing existing edited
- `docs/RELEASING.md` — `**Smoke in the dry run.**` and `**Fork PR check.**` under step 2, `**Release smoke.**` under step 3
- `scripts/smoke-release.mjs` — new release smoke script (Node built-ins only)
- `fixtures/smoke/base/src/math.js` — new: base state of the smoke repository
- `fixtures/smoke/head/src/math.js` — new: head state, one function added
- `fixtures/smoke/head/src/math.test.js` — new: the head's tests (committed, never run)
- `fixtures/smoke/coverage.lcov` — new: lcov for the head, every executable line covered
- `fixtures/smoke/expected-summary.txt` — new: the whole lines the job summary must contain

### Explicitly not touched

- `.github/workflows/release.yml` — the `Release smoke` job and the dry-run smoke step are added by hand after this increment
- `packages/action/dist/index.js` — no source change, no rebuild
- `packages/core/src/version.ts` — versions are out of scope
- `package.json` — no version change and no new script (test infrastructure)
- `packages/action/package.json` — version out of scope
- `schema/report.v2.json` — no report change
- `action.yml` — no input or output change
- `docs/THREAT-MODEL.md` — the smoke script is maintainer tooling that parses only its own fixture and the bundle's outputs; not in the SPEC's scope
- `packages/core/test/ac-skylos-nine-table.test.ts` — existing test; unchanged even though its table has `null` where LIMITS names the proposed TI17
- `fixtures/skylos-nine/added-skip/change.diff` — existing fixture, read only
- `fixtures/golden/report.md` — golden files never change here
- `vitest.config.ts` — test infrastructure
- `biome.json` — lint config unchanged

## Acceptance mapping

> The AC tests live in AC-TESTS.md (new files, outside this plan's `## Files`).

- **AC-1:** Step 2 writes one `## What test integrity does not catch` heading after `### What the accept label
  misses`. The intro names all seven ids and the accept label, and the Skylos paragraph has `Skylos` and `2 of 9`. The
  caught list has two items in the `— caught by TIxx` shape; the missed list has seven in the
  `— missed; planned: TIxx` shape with the required ids.
- **AC-2:** Step 2's further-misses list carries `same name`, `trivial body`, `toEqual(expectedFromOutput)`, `mock`
  and `setup file`. The missed list carries `planned`.
- **AC-3:** The caught and missed items are parsed by their fixed shapes. `check()` over all nine cases (the Skylos AC
  tests' inputs, mode `block`) gives exactly `deleted-test` → `[TI01]` and `added-skip` → `[TI03]`, and the seven
  others give none. That is the stated 2 of 9; the code is unchanged.
- **AC-4:** Step 1 removes the old sentence. Step 2 only adds a `##` heading, so every `##` and `###` heading line of
  `b2c3a56` remains.
- **AC-5:** Steps 3–4 add exactly one `## Test integrity` heading and its Contents line. The section's words and its
  two links are as listed, with no `uses:` line. The Status note and the four `uses: pharn-dev/pharn-ci@v0.1.0` lines
  are untouched.
- **AC-6:** Step 4 quotes the real render of `added-skip`, line for line, with `> `.
- **AC-7:** Step 5 removes the old phrase and links `#test-integrity`.
- **AC-8:** Step 6 only appends lines naming `Skylos`, `2 of 9` and `docs/LIMITS.md`. The `Report v2`, `schemaVersion`
  and `report.v1.json` text stays, as do all earlier lines and the `## [` lines.
- **AC-9:** Step 9's `**Fork PR check.**` sub-item (with `fork`, `job summary` and `comment`) comes before
  `**Release.**`. `**Release smoke.**` holds `Release smoke`, `node scripts/smoke-release.mjs` and `Marketplace`, and
  `**Smoke in the dry run.**` holds `smoke` and `dry run`. Every old heading and bold lead stays.
- **AC-10:** Step 7's `expected-summary.txt` holds the two lines and no `pharn-ci <digit>` line.
- **AC-11:** Step 8 on the committed bundle (version 0.1.0, footer `pharn-ci 0.1.0`) passes every check and prints one
  `ok` line. The `finally` empties `TMPDIR`.
- **AC-12:** Step 8 checks in order (exit, verdict, summary, footer). The fake verdict-fail bundle fails at
  `verdict`, and the 9.9.9 package fails at the footer naming `9.9.9`. The copied script finds its own fixtures through
  `import.meta.url`, so the extra line fails at `summary`, quoted verbatim. The exit-1 bundle fails at `exit`. None
  prints an `ok` line, and `finally` cleans up each run.
- **AC-13:** Step 8's env is built from nothing, with the six `INPUT_*` values and four paths inside `mkdtemp(tmpdir())`.
- **AC-14:** Step 8 uses only `node:` built-ins (fs, path, os, url, child_process), none of the network modules, and
  no `fetch(`.

## Risks & open questions

- **The workflow half is manual.** `docs/RELEASING.md` will describe a `Release smoke` job and a dry-run smoke step
  that `release.yml` does not have until the maintainer adds them by hand, before merge (SPEC assumption). Until then
  the doc is ahead of the workflow. Flag this to the human in the PR description.
- **TI17 vs the existing table test.** LIMITS names TI17 (proposed) for `always-true-matcher`, as the SPEC requires,
  while `ac-skylos-nine-table.test.ts` records `null` for it. The existing test is not changed (SPEC non-goal). The AC-3
  test asserts only that missed cases give no signal, so the two do not conflict, but the doc and the table disagree
  on the planned id. Grill should weigh this.
- **Fixture extensions.** `ac-stream-diff.test.ts` and `ac-stream-lcov.test.ts` parse every `*.diff` and `*.info`
  under `fixtures/`. The smoke coverage file is therefore `coverage.lcov`, so no existing test gains an input.
- **The user's global git config.** The script's own git calls pass `commit.gpgsign=false` and a fixed identity. The
  bundle's git calls inherit `HOME`, so a global `diff.*` setting on a developer machine could, in principle, change
  the diff the bundle reads. Real runners have none.
- **Test timing.** AC-11 to AC-13 run git and the bundle (about 1–2 s per run; AC-12 runs four). They need explicit
  per-test timeouts (60–120 s), set by `/pharn-test`.
- **`fixtures/smoke/head/src/math.test.js` is a test file in this repository's diff.** pharn-ci's own CI check sees an
  added test file. An addition fires no signal, and `fixtures/` is not in this repository's coverage report, so its
  gate is unaffected.
