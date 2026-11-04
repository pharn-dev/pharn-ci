---
spec_id: release-readiness-v0-1-0
spec_content_hash: 9fbea1c93031b67305156a9e286f8964e9fcfb216feb07a72109c3d47ebd076e
applied_lessons: none
---

## Approach

> ADVISORY: model work, derived from the Approved SPEC. Discovery read this run: root `package.json` (no
> `version` field), `packages/{core,cli,action}/package.json` (all `0.1.0`), `packages/core/src/version.ts`
> (`VERSION = "0.1.0"`), `packages/core/test/version.test.ts`, `.github/workflows/release.yml`, `action.yml`
> (9 inputs; `description` is 107 characters), `schema/report.v1.json` (7 known codes, 21 known kinds),
> `CHANGELOG.md`, `README.md`, `docs/LIMITS.md`, `docs/RELEASING.md`, `packages/cli/src/main.ts` (help text),
> `vitest.config.ts`, `biome.json`.

This run changes docs, one version field and tests only. No file under `packages/*/src`, no schema and no
`action.yml` change. The work splits into four parts:

1. **Versions.** Add `"version": "0.1.0"` to the root `package.json`. Extend `version.test.ts` with a root check
   while keeping its `it.each` over core, cli and action.
2. **Changelog.** Move every `[Unreleased]` entry under the literal heading `## [0.1.0] - YYYY-MM-DD`, with a one-line
   date note directly beneath it. Above that, put a fresh `## [Unreleased]` holding only empty `### Added`,
   `### Changed` and `### Security`. Rewrite the 0.1.0 entries so they read as one first release, not a list of
   increments:
   - Name all 21 schema kinds and all 7 schema codes literally.
   - Drop the phrase "the lcov report".
   - Keep every behaviour statement true to the merged code.
3. **Docs.**
   - Correct the few lcov-only phrasings in `README.md` and `docs/LIMITS.md`.
   - Add the `-h, --help` and `-v, --version` flags to the README CLI usage. This makes it list exactly what
     `pharn-ci --help` prints.
   - Update `docs/RELEASING.md`'s version step and add the placeholder-date convention.
   - Write `docs/MARKETPLACE.md` with one `##` heading per field, so the tests can find each field without
     ambiguity.
4. **Tests and bundle.** New AC tests (mapped in `AC-TESTS.md`, written by `/pharn-test`) read the files directly
   with `node:fs`. The AC-3 test runs the system `awk` with `release.yml`'s exact program. `pnpm build` regenerates
   `packages/action/dist/index.js`. No source changes, so the bundle is expected to be byte-identical.

## Applied lessons

- none: `check-lessons-index.mjs --verdict` printed `NO_CANON`, so this project has no `memory-bank/lessons-learned.md` yet and there is nothing to apply.

## Steps

1. **Root `package.json`.** Insert `"version": "0.1.0",` directly after `"name": "pharn-ci-monorepo",`. Keep the
   2-space JSON formatting so `biome check` stays clean. Change nothing else in the file: no script, dependency or
   `packageManager` change.
2. **`packages/core/test/version.test.ts`.**
   - Keep the existing `it.each(["core", "cli", "action"])` unchanged.
   - Add one `it("matches the root package.json", …)`. It reads `../../../package.json`, asserts the `version` field
     is present (`toHaveProperty("version")`) and that it equals `VERSION`.
   - Do not touch the existing assertions.
3. **`CHANGELOG.md`.** Keep the intro paragraph. Replace the current `## [Unreleased]` block with this, in order:
   - `## [Unreleased]`, a blank line, then `### Added`, `### Changed` and `### Security`, each followed by a blank
     line and nothing else.
   - `## [0.1.0] - YYYY-MM-DD`, the literal placeholder.
   - Directly beneath the heading, one line:
     `The maintainer replaces \`YYYY-MM-DD\` with the release date, and deletes this line, when cutting the release.`
   - Remove the old paragraph "Planned first release: **0.1.0**. …"; the date note replaces it.
   - `### Added` and `### Security` holding the moved entries, edited for consistency:
     - **Diff coverage.** Say "the share of lines added in the change that the coverage report (lcov or Cobertura
       XML) marks as executed", with the inclusive threshold (`threshold` input, `--threshold`,
       `coverage.threshold`). This removes "the lcov report".
     - **Agent setup inventory.** Merge the two current inventory entries into one first-release entry naming all
       21 kinds in backticks, in the README table's order:
       - `claude-md`, `claude-local-md`, `agents-md`, `gemini-md`
       - `claude-settings`, `claude-settings-local`, `claude-skill`, `claude-hook`, `claude-agent`, `claude-command`
       - `cursor-rules`, `cursor-mcp`
       - `copilot-instructions`, `copilot-instructions-scoped`, `copilot-agents`, `copilot-prompts`
       - `vscode-mcp`, `codex-config`, `windsurf-rules`, `cline-rules`, `mcp-config`

       Keep the nested-directory and precedence sentences, worded as facts of 0.1.0 ("are found in nested
       directories"), not as changes ("now also found").
     - **`agentSetup.summary`.** Keep the entry: optional `agentSetup.summary` with the counts per kind and the
       tools, the `Agent setup: N files · tools` line, and the table collapsed above 25 files.
     - **Report v1 and codes.** Keep the entry naming all 7 codes: `DIFF_COVERAGE_BELOW_THRESHOLD`,
       `NO_COVERABLE_CHANGES`, `COVERAGE_FILE_MISSING`, `COVERAGE_FILE_EMPTY`, `COVERAGE_FORMAT_UNSUPPORTED`,
       `DIFF_UNAVAILABLE` and `NO_AGENT_SETUP_FILES`.
     - **Coverage formats.** One entry, or two adjacent ones, covering:
       - Cobertura XML parsing, read by the CLI and the Action.
       - The `coverage-format` Action input, the `--coverage-format` CLI flag and `coverage.format` in
         `.pharn/ci.yml`, each taking `lcov`, `cobertura` or `auto`, with the flag or input winning over the config.
       - `auto` as the default (write "is the default", not "is the new default"). It detects the format from the
         first 1 KiB and prints the chosen format.
       - Clover and JaCoCo native XML are not supported.
       - `COVERAGE_FORMAT_UNSUPPORTED`: an error with a threshold, a warning without.
       - The optional `diffCoverage.format` field.
     - **Exclusions.** Keep the entry, including:
       - `coverage.exclude`, the repeatable `--exclude <glob>` and the literal words "the Action's `exclude` input";
       - the merge (union) rule;
       - `diffCoverage.excludedFiles` and the "Excluded" summary.
     - **Unchanged entries.** The sticky comment and fork entry, the `.pharn/ci.yml` entry, and every
       `### Security` entry stay as they are.
   - The 0.1.0 section must contain none of `lcov only`, `lcov-only` or `the lcov report`.
   - Leave nothing else between `## [Unreleased]` and `## [0.1.0]`.
4. **`README.md`.** Keep the existing style. Make these corrections only:
   - Quick start lead-in (line ~116): "runs your tests with lcov output" → "runs your tests with lcov or Cobertura
     XML output". The YAML comment on line ~134 becomes "run tests with lcov or Cobertura output, e.g.:". The
     example stays vitest with lcov.
   - CLI usage block: add `[-h|--help] [-v|--version]` to the synopsis, so it lists exactly the flags
     `pharn-ci --help` prints (`packages/cli/src/main.ts`).
   - Development table, `packages/core` row: "lcov and diff parsing" → "lcov, Cobertura and diff parsing".
   - Re-check the inputs table, the message codes table and the kinds table. Today they match `action.yml` and the
     schema exactly (9 inputs, 7 codes, 21 kinds), so they need no change. Fix any mismatch the build finds.
   - Re-check "What it proves, and what it does not" against the merged behaviour. No edit is expected.
5. **`docs/LIMITS.md`.** Keep every limit. Change only these phrasings:
   - §1, "Files missing from the coverage report are invisible": "is often absent from lcov entirely" → "is often
     absent from the coverage report entirely".
   - §5, first bullet: "write a favorable lcov file" → "write a favorable coverage file".
   - §5, third bullet: "parsed as lcov or config" → "parsed as coverage (lcov or Cobertura) or config".
6. **`docs/RELEASING.md`.** In "Cutting a release", step 1:
   - **Version bullet.** Make it the one bullet that begins `Set \`"version": "X.Y.Z"\``. It names, in order:
     - the root `package.json` (written literally as "the root \`package.json\`");
     - `packages/core/package.json`, `packages/cli/package.json` and `packages/action/package.json`;
     - `VERSION` in `packages/core/src/version.ts`;
     - the version in the `uses: pharn-dev/pharn-ci@vX.Y.Z` line of `docs/MARKETPLACE.md`'s quick start.

     Follow it with one sentence saying `version.test.ts` and the docs tests fail when they disagree.
   - **Changelog bullet.** Move the `[Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading with the
     one-line date note beneath it. Leave an empty `## [Unreleased]` with `### Added`, `### Changed` and
     `### Security` above it.
   - **Placeholder sentence.** One sentence must contain all three of: "the maintainer replaces the `YYYY-MM-DD`
     placeholder", "release date" and "before running the release workflow". It also says the date line's note is
     deleted at the same time, so the extracted release notes do not carry it.
   - Keep steps 2–4 and every other section unchanged.
7. **`docs/MARKETPLACE.md`** (new). A short intro paragraph under `# GitHub Marketplace listing` says this is the
   listing text, checked against `action.yml` by a test, and refreshed on each release (`docs/RELEASING.md`). Then
   exactly these `##` sections, in this order, with these exact headings:
   - **`## Name`.** The single line `pharn-ci`.
   - **`## One-line description`.** The single line equal to `action.yml`'s `description`, byte-for-byte. It is 107
     characters, so at most 125.
   - **`## Description`.** Exactly three paragraphs separated by single blank lines. Each paragraph is plain text,
     with no list, heading or code fence.
     1. Diff coverage: lines added in the PR, from lcov or Cobertura XML (`auto` detection by default), with an
        optional inclusive threshold gate and exclusions.
     2. The agent setup inventory: the tracked setup files of Claude Code, Cursor, Copilot, Codex, Gemini, Windsurf,
        Cline and MCP, with a summary. It lists the files and never reads them.
     3. Output and safety: one sticky PR comment, the job summary, a pass/warn/fail verdict and a Report v1 JSON
        file. It is stateless, with no telemetry and no network calls except the GitHub API.

     Claim nothing the code does not do.
   - **`## Categories`.** Exactly two list lines: `- Primary: Continuous integration` and `- Secondary: Testing`.
   - **`## Quick start`.** Exactly one fenced block opened with ` ```yaml `. It is a whole workflow mirroring the
     README quick start:
     - `on: pull_request`, with `contents: read` and `pull-requests: write`;
     - checkout with `fetch-depth: 0`, then a test run with lcov output;
     - a step whose line reads exactly `- uses: pharn-dev/pharn-ci@v0.1.0`, with no trailing comment, and a `with:`
       block that sets `coverage-file: coverage/lcov.info` and `threshold: 80`.

     Every key under that `with:` is an `action.yml` input.
8. **Build.** Run `pnpm build`. It regenerates `packages/action/dist/index.js`, expected unchanged because no source
   changed. It also writes the git-ignored `packages/core/dist/` and `packages/cli/dist/`. Commit the action bundle
   only if it differs.
9. **Gates.** Run `pnpm lint` and `pnpm test`; both must pass, including the AC tests `/pharn-test` wrote and the
   unchanged golden and snapshot tests.

## Files

- `package.json` — add `"version": "0.1.0"` after `name`; nothing else changes
- `packages/core/test/version.test.ts` — add a root `package.json` check against `VERSION`, keeping the existing per-package `it.each`
- `CHANGELOG.md` — fresh empty `## [Unreleased]` (Added/Changed/Security), entries moved under `## [0.1.0] - YYYY-MM-DD` with the one-line date note, entries made complete and consistent
- `README.md` — lcov-only phrasings corrected, CLI usage gains `-h|--help` and `-v|--version`, core row names Cobertura
- `docs/LIMITS.md` — three lcov-only phrasings corrected; every limit kept
- `docs/RELEASING.md` — version step names the root `package.json` and `docs/MARKETPLACE.md`'s `uses:` line; placeholder-date convention
- `docs/MARKETPLACE.md` — new: Marketplace listing (name, one-line description, three-paragraph description, categories, quick start)
- `packages/action/dist/index.js` — regenerated by `pnpm build` (expected byte-identical; AGENTS.md rule 7)

### Explicitly not touched

- `packages/core/src/version.ts` — `VERSION` is already `0.1.0`; no file under `packages/*/src` changes
- `packages/core/package.json` — already `0.1.0`
- `packages/cli/package.json` — already `0.1.0`
- `packages/action/package.json` — already `0.1.0`
- `schema/report.v1.json` — out of scope (AGENTS.md rule 2)
- `action.yml` — out of scope; the listing and tests read it
- `.github/workflows/release.yml` — mirrored by the tests, never changed
- `docs/THREAT-MODEL.md` — not in the SPEC's scope; it makes no lcov-only claim
- `fixtures/golden/report.md` — golden files do not change
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `AGENTS.md` — out of scope
- `CLAUDE.md` — out of scope
- `CONTRIBUTING.md` — out of scope
- `SECURITY.md` — out of scope
- `LIMITS.md` — root PHARN tooling file, out of scope
- `THREAT-MODEL.md` — root PHARN tooling file, out of scope

## Acceptance mapping

> The AC tests live in AC-TESTS.md (new files, outside this plan's `## Files`).

- **AC-1:** Step 1 adds the root `version`, and the other three are already `0.1.0` = `VERSION`. The AC-1 test reads
  all four `package.json` files and compares each with `VERSION`. Step 2 also keeps `version.test.ts` covering the
  root.
- **AC-2:** Step 3 yields exactly one line starting `## [0.1.0]`, namely `## [0.1.0] - YYYY-MM-DD`. The first
  `## [` line is `## [Unreleased]`, above it. The test reads V from `packages/action/package.json`. It accepts the
  placeholder or a `\d{4}-\d{2}-\d{2}` date, so it stays true after the maintainer sets the date and after new
  Unreleased entries.
- **AC-3:** Step 3's 0.1.0 section, extracted by `release.yml`'s exact `awk` program, is non-empty. It names every
  required token, all 7 codes and all 21 kinds (read from the schema's "Known codes:" and "Known kinds:"
  descriptions), and none of the forbidden phrases.
- **AC-4:** Step 7's `## Name`, `## One-line description`, `## Description` (three paragraphs) and `## Categories`
  (Continuous integration and Testing, distinct, both in the allowed set) match `action.yml`'s `name` and
  `description`.
- **AC-5:** Step 7's quick start has `uses: pharn-dev/pharn-ci@v0.1.0`. `0.1.0` is `VERSION`. Its `with:` sets
  `coverage-file` and `threshold`, both declared under `action.yml` `inputs:`.
- **AC-6:** Step 6's version bullet names the root `package.json` and the four other files. Its placeholder sentence
  states the `YYYY-MM-DD` replacement before running the release workflow.

## Risks & open questions

- **AC-3's content tokens are 0.1.0-specific, but V comes from `packages/action/package.json`.** At the next release
  (say 0.2.0), the 0.2.0 section will not name Cobertura, every kind and so on, and the AC-3 test will fail. That
  release's PR must narrow the token assertions to the `0.1.0` section. The SPEC's constraint covers setting the date
  and adding Unreleased entries for this release, both of which stay green. This tension is flagged for
  `/pharn-grill` and the human.
- **AC-3 uses the system `awk`** through `execFileSync`, with no shell, on Linux and macOS, the platforms the repo
  supports. The test should also assert that `release.yml` still contains the exact `awk` program and the
  `grep -q "^## \[…\]"` check. That way a workflow edit fails the mirror loudly instead of letting it drift.
- **AC-1 is covered twice:** by the new AC test and by the extended `version.test.ts`. This is intentional. The SPEC
  scopes the extension, and RELEASING.md cites `version.test.ts`.
- **Status lines will go stale at the tag.** `README.md`'s "Status: … not yet released" and `docs/LIMITS.md`'s
  "pre-1.0 and not yet released" are true until the tag exists. Updating them at the release is not in this SPEC.
  Should `docs/RELEASING.md` gain a step for it? That is open for the human.
- **`pnpm build` also writes git-ignored files.** Besides the committed bundle, it writes `packages/core/dist/` and
  `packages/cli/dist/`. These are build outputs, not plan edits.
- **The quick start pins checkout by tag.** `docs/MARKETPLACE.md`'s quick start uses `actions/checkout@v7`, as the
  README does. It is consumer-facing example YAML, not a workflow in this repo, so `scripts/check-action-pins.mjs`
  does not scan it.
