---
spec_id: coverage-exclusions
spec_content_hash: 281c8618464de784e1a66053efff1417c7718c4a096a4bf8d74ba8ccd0dbc242
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Read live this run: `packages/core/src/{check,config,diffCoverage,report,index}.ts`,
> `packages/core/src/render/markdown.ts`, `packages/core/src/diff/unified.ts`, `packages/cli/src/{main,index,nodeDeps}.ts`,
> `packages/action/src/{run,index}.ts`, `action.yml`, `schema/report.v1.json`,
> `packages/core/test/{config,golden,markdown,purity,helpers,schema}.ts`, `packages/cli/test/main.test.ts`,
> `packages/action/test/run.test.ts`, `fixtures/golden/*`, `fixtures/render/hostile-paths.json`, `README.md`,
> `docs/LIMITS.md`, `docs/THREAT-MODEL.md`, `CHANGELOG.md`, `biome.json`, `tsconfig.base.json`, `vitest.config.ts`,
> `.gitignore`, `.gitattributes`, the package manifests and `pharn/features/cobertura-parser/{PLAN,AC-TESTS}.md`.

Exclusions are a filter on the **changed files** inside diff coverage. Pattern matching and validation live in core
(pure); the CLI and the Action only gather patterns from their sources and hand the concatenation to `check()`,
which validates, de-duplicates and applies them. Five pieces, one reason to change each:

1. **`packages/core/src/glob.ts` (new) — the matcher, nothing else.** Exports
   `compileGlob(pattern: string): (path: string) => boolean` and `matchGlob(pattern: string, path: string): boolean`
   (`= compileGlob(pattern)(path)`). It never throws and never validates (validation is piece 2); a character it
   does not treat specially is a literal, so `a+(b)|$.ts` is matched literally. No regular expression at all.
   - The pattern and the path are each split on `/` (`String.prototype.split`, linear). A pattern segment that is
     exactly `**` is a **globstar**: it matches zero or more whole path segments. Every other pattern segment is
     compiled once to a token list over **code points** (`for…of`): a literal code point, `?` (one code point), or
     `*` (any run of code points); consecutive `*` collapse to one, so `a**b` behaves like `a*b`. Since a segment
     never contains `/`, `*` and `?` can never cross one.
   - **Segment level** (a set-of-states simulation, no backtracking): the active set holds pattern-segment indices;
     its closure adds `i + 1` for every active globstar `i`. For each path segment, the next set gets `i` for an
     active globstar (it consumes the segment) and `i + 1` for an active non-globstar segment whose tokens match the
     whole path segment. The path matches when, after the last path segment and closure, the end index (the
     pattern's segment count) is active. So `src/**` matches `src` (the globstar matches zero segments) and
     `**/test/**` matches `test/a.ts`.
   - **Within a segment**: the same idea over token positions — a boolean array (or generation-stamped array) of
     active positions, closure over `*`, one step per path code point (`*` stays, `?` advances, a literal advances
     when equal). Accept when the end position is active.
   - **Cost:** each (path segment, active pattern segment) pair costs O(|pattern segment tokens| × |path segment|),
     and at most every pattern segment is active, so a whole match is O(pattern length × path length): linear in
     the path for a given pattern (AC-4). Paths are matched as given, with no normalization (AC-3).

2. **`packages/core/src/config.ts` — pattern validation and the `coverage.exclude` list.**
   - New export `parseExcludePattern(pattern: string, label = "exclude pattern"): string`, the twin of
     `parseThreshold`: trims, removes a repeated leading `./`, then throws
     `ConfigError(\`${label} "${pattern}" <reason>\`)` — the **raw** pattern interpolated as written, never
     `JSON.stringify`'d (that would double a backslash and the message would no longer contain the pattern) — when
     the result is empty, starts with `/` or `!`, ends with `/`, contains `//`, has a `..` segment (`=== ".."`
     after `split("/")`), or contains `\`, `{`, `}`, `[` or `]`. Checks use `startsWith`/`endsWith`/`includes`/`split`
     only. It returns the normalized pattern; it is idempotent, so a caller may validate early and `check()` may
     validate again.
   - `PharnConfig.coverage` gains `exclude?: string[]`.
   - **`parseYamlSubset` reads a block list only as the value of `coverage.exclude`.** The `YamlMap` value type
     widens to `Scalar | Scalar[] | YamlMap`. When a line's content is `- …` or `-`:
     - if `pendingKey` is set, its `key` is `"exclude"`, its `map` is the object at `root.coverage` (identity check),
       and the line's indent is `>= pendingKey.indent` → a list starts at this indent: `pendingKey.map.exclude = []`,
       `pendingKey = null`, and the item is read;
     - else if a list is open and the indent equals the list's indent → the item is read and appended;
     - else if a list is open (other indent) → `line N: unexpected indentation`;
     - otherwise → the existing `line N: lists are not supported in .pharn/ci.yml` error, unchanged (so
       `coverage:` / `  - file: x` keeps its message — AC-6, SPEC Constraints).

     Any non-item line closes an open list and is processed exactly as today (so items at the key's own column are
     followed by sibling keys normally). **Reading an item:** the text after `- ` (comments already stripped,
     trimmed); an item that starts with `- ` or is `-` → `line N: nested lists are not supported`; an item that is
     not one complete quoted string (the two quoted-string regexes `parseScalar` already uses) and contains `": "`
     or ends with `":"` → `line N: mappings are not supported in a list in .pharn/ci.yml`; an empty item (`-`
     alone) → `null`; otherwise `parseScalar(item, lineNo)` — so an unquoted `*…` item and `[a, b]` throw its
     existing `unsupported YAML syntax` error.
   - **`validateConfig`** gains `case "exclude"`: the value must be an array (a scalar, or a nested mapping,
     → `"coverage.exclude" must be a list of glob patterns`); every item must be a non-empty string
     (→ `"coverage.exclude" items must be non-empty strings`, covering a number item, an empty-string item and a
     `null` item); each item goes through `parseExcludePattern(item, '"coverage.exclude" pattern')`, and the
     normalized patterns are stored in order. `exclude:` with no value is `null` and is skipped by the existing
     `if (value === null) continue;`, so there is no `exclude` field (AC-5). An array `coverage` value is rejected
     with the existing `"coverage" must be a mapping` (a TypeScript guard; the parser cannot produce one).
   - Every step is O(line length) per line, so 100,000 items or one 100,000-character item stay linear (AC-7).

3. **`packages/core/src/diffCoverage.ts` + `report.ts` + `check.ts` — applying exclusions.**
   - `computeDiffCoverage(diff, coverage, threshold, isExcluded: (path: string) => boolean = () => false)`: the new
     optional last parameter keeps every existing caller and test unchanged. In the loop, after the existing
     `deleted` skip and **before** the coverage lookup, a file whose `file.path` (the new path for a rename)
     `isExcluded` is added to a `Set` of excluded paths and skipped. So an excluded file the coverage report does
     not know is still listed, a deleted file never is, and a rename is judged by its new path only (AC-9).
     `DiffCoverageResult` gains `excludedFiles?: string[]`, set (conditional spread, `exactOptionalPropertyTypes`)
     only when the set is non-empty, sorted with the same comparator as `files` (extract it to one local
     `byPath` function used by both sorts).
   - `ReportDiffCoverage` gains `excludedFiles?: string[]` (doc comment: sorted repo-relative paths, present only
     when at least one changed file was excluded). `buildReport` copies it **after `files`** only when present and
     non-empty, so a report without exclusions is byte-identical to today's (AC-11, `fixtures/golden/` unchanged).
     Messages and the verdict are untouched: with every coverable file excluded, `coverableLines` is 0 and the
     existing `NO_COVERABLE_CHANGES` pass applies (AC-10).
   - `CheckInput` gains `exclude?: readonly string[]` (doc: patterns from every source, in any order; validated and
     de-duplicated here). `check()` **first**, before any early return, maps them through `parseExcludePattern`
     (throws `ConfigError` naming the pattern — AC-13), de-duplicates with a `Set`, and compiles each once with
     `compileGlob`; the predicate is "any compiled pattern matches". It is passed to `computeDiffCoverage` only.
     `scanAgentSetup(input.repoFiles)` is untouched, so exclusions never reach the inventory (AC-12), and an empty
     coverage map is still `COVERAGE_FILE_EMPTY` (SPEC Assumptions).

4. **`packages/core/src/render/markdown.ts` — the summary.** Inside the Diff coverage section, after the table's
   trailing blank line (or after `_No coverable lines changed._` and its blank line), when
   `dc.excludedFiles?.length` is non-zero, push:

   ```text
   <details><summary>Excluded: 2 files</summary>

   - `schema.gen.ts`
   - `src/generated/api.ts`

   </details>

   ```

   `file` is singular for one. Each path goes through the existing `code()` helper (control characters replaced,
   backslashes, pipes and backticks escaped), so a hostile path cannot add a line or raw HTML (AC-16). The list
   follows report order and is cut at `maxRows` like the tables, with a final `- _…and N more files_` item, so a PR
   excluding thousands of files cannot push the verdict out of the size-capped comment; `report.json` keeps the full
   list (see Risks).

5. **Gathering (CLI and Action) — concatenation only.**
   - CLI (`packages/cli/src/main.ts`): `parseArgs` gains `exclude: { type: "string", multiple: true }`; `HELP` gains
     the line `  --exclude <glob>     Leave matching changed files out of diff coverage (repeatable; adds to coverage.exclude)`
     (same 23-column alignment as the other options). In `runCheck`, right after the `--format` and `--base`
     checks and before any git call, each flag goes through `parseExcludePattern(p, "--exclude")` (a rejected one
     throws `ConfigError` → the existing `main` catch → stderr `pharn-ci: --exclude "<p>" …`, exit 2 — AC-19). A
     rejected config pattern already fails in `loadConfig` with the config path prefixed, exit 2. `CheckInput.exclude`
     is `[...(config.coverage?.exclude ?? []), ...flags]`; `check()` de-duplicates (AC-18).
   - Action (`packages/action/src/run.ts`): a local `splitPatternList(value: string): string[]` splits the `exclude`
     input on `,` and `\n` (`split` with a one-character class, no quantifier), trims each entry and drops blank
     ones. Right after the other inputs are read, each entry goes through `parseExcludePattern(p, "exclude")` (a
     rejected one throws → the existing `run` catch → `setFailed("pharn-ci: exclude \"<p>\" …")` — AC-21).
     `CheckInput.exclude` is `[...(config.coverage?.exclude ?? []), ...inputPatterns]`. The `diff-coverage` output
     already reads `report.diffCoverage.percent`, so it reflects the recomputed percent (AC-20).
   - `action.yml` declares `exclude` (`required: false`, no default) with the description: "Glob patterns of changed
     files to leave out of diff coverage, separated by commas or newlines. Added to coverage.exclude in
     .pharn/ci.yml, never replacing it."

`packages/core/src/index.ts` re-exports `compileGlob`, `matchGlob` (from `glob.js`) and `parseExcludePattern`
(from `config.js`). `glob.ts` imports nothing from `config.ts`, so there is no import cycle.

## Applied lessons

- none — `check-lessons-index.mjs --verdict` returned `NO_CANON`: this project has no `memory-bank/lessons-learned.md`
  yet, so there are no lessons to apply.

## Steps

- Write `packages/core/src/glob.ts` as in Approach (1), with a doc comment stating the subset (`*`, `**` as a whole
  segment, `?` as one code point; anchored at the root, whole-path, case-sensitive, no dotfile rule, no
  normalization of the path) and the O(pattern × path) bound. No regex, no recursion, no I/O; comments must not
  contain `process`, `require`, `fetch` or `globalThis` followed by `.` or `(` (the purity test greps comments).
- Extend `packages/core/src/config.ts` as in Approach (2); update the `parseConfig` doc comment to say a block list
  is read for `coverage.exclude` only.
- Extend `diffCoverage.ts`, `report.ts` and `check.ts` as in Approach (3); re-export from `index.ts`.
- Add the `<details>` block to `render/markdown.ts` as in Approach (4).
- Add `diffCoverage.excludedFiles` to `schema/report.v1.json` under `$defs.diffCoverage.properties`, after `files`,
  **not** in `required`:
  `"excludedFiles": { "description": "Changed files left out of diff coverage because an exclusion pattern (coverage.exclude, --exclude or the Action's exclude input) matches their path. Repo-relative paths with forward slashes, sorted by path. Present only when at least one changed file was excluded; such files count nowhere else in diffCoverage.", "type": "array", "items": { "type": "string", "minLength": 1 } }`.
  Nothing else in the schema changes (AGENTS.md rule 2).
- Wire the CLI and the Action as in Approach (5); declare the input in `action.yml`.
- Write the four golden-exclusions inputs below with the Write tool (fixtures are `-text` and outside Biome; LF, no
  BOM, trailing newline). Then produce the two outputs the repo's documented way, on that test file only:
  `pnpm vitest run -u packages/core/test/exclusions-golden.test.ts` (the AC-17 test `/pharn-test` wrote). Review
  the written `report.json` and `report.md` against the expected content below before keeping them; a difference
  is a build defect to fix in source, never a reason to accept the snapshot. Never run `-u` on any other test file:
  `fixtures/golden/report.json` and `report.md` must not change.
- Update `README.md`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md` and `CHANGELOG.md` (details under Files). The
  THREAT-MODEL citations use the exact `file › test` titles of the AC tests `/pharn-test` wrote — read them from the
  test files, never invent them.
- Regenerate the committed Action bundle with `pnpm --filter @pharn-ci/action build` (runs `tsc --noEmit` and writes
  only `packages/action/dist/index.js`; core is bundled from source). Do not run the root `pnpm build` in the build
  stage: it also writes the gitignored `packages/core/dist/` and `packages/cli/dist/`, outside this plan's scope.
- Run `pnpm lint` and `pnpm test`; format only the TypeScript and JSON files this plan names, one by one
  (`pnpm biome check --write <file>`).

### Golden-exclusions fixture (the contract between the AC-17 test and the build)

`fixtures/golden-exclusions/ci.yml` — the patterns and threshold, read by the AC-17 test with `parseConfig`:

```yaml
# Exclusions for the golden-exclusions fixture.
coverage:
  threshold: 80
  exclude:
    - src/generated/**
    - "*.gen.ts"
```

`fixtures/golden-exclusions/pr.diff` — six changes: `README.md` modified (line 2, unknown to coverage, not excluded);
`schema.gen.ts` added (lines 1-2, excluded by `*.gen.ts`); `src/app.ts` modified (lines 2-4); `src/generated/api.ts`
added (lines 1-4, excluded by `src/generated/**`); `src/generated/old.ts` deleted (matches, never listed);
`src/util.ts` modified (lines 5-7):

```diff
diff --git a/README.md b/README.md
index 0123456..1234567 100644
--- a/README.md
+++ b/README.md
@@ -1,0 +2 @@
+Generated code lives in src/generated/.
diff --git a/schema.gen.ts b/schema.gen.ts
new file mode 100644
index 0000000..7777777
--- /dev/null
+++ b/schema.gen.ts
@@ -0,0 +1,2 @@
+export type Id = string;
+export const ids: Id[] = [];
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,0 +2,3 @@ import { run } from "./util.js";
+export function start() {
+  return run();
+}
diff --git a/src/generated/api.ts b/src/generated/api.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/generated/api.ts
@@ -0,0 +1,4 @@
+export function getUser() {
+  return request("/user");
+}
+export const API_VERSION = 2;
diff --git a/src/generated/old.ts b/src/generated/old.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/generated/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const old = 1;
-export const older = 2;
diff --git a/src/util.ts b/src/util.ts
index 5555555..6666666 100644
--- a/src/util.ts
+++ b/src/util.ts
@@ -4,0 +5,3 @@ export function run() {
+  const a = 1;
+  const b = 2;
+  return a + b;
```

`fixtures/golden-exclusions/coverage.info` (absolute `SF:` under `/home/runner/work/demo/demo`, the repo root the
existing golden test passes):

```text
TN:
SF:/home/runner/work/demo/demo/src/app.ts
DA:1,3
DA:2,3
DA:3,3
end_of_record
TN:
SF:/home/runner/work/demo/demo/src/util.ts
DA:5,1
DA:6,1
DA:7,0
end_of_record
TN:
SF:/home/runner/work/demo/demo/src/generated/api.ts
DA:1,0
DA:2,0
DA:4,0
end_of_record
TN:
SF:/home/runner/work/demo/demo/schema.gen.ts
DA:2,0
end_of_record
```

`fixtures/golden-exclusions/files.txt`: `AGENTS.md`, `CLAUDE.md`, `README.md`, `schema.gen.ts`, `src/app.ts`,
`src/generated/api.ts`, `src/util.ts`, one per line.

Expected, with version `0.1.0`, repo root `/home/runner/work/demo/demo`, the config's patterns and threshold 80:
verdict `pass`; `diffCoverage` = percent 80, threshold 80, coveredLines 4, coverableLines 5, files
`src/app.ts` (100, 2/2, uncovered `[]`) and `src/util.ts` (66.67, 2/3, uncovered `[7]`), then
`excludedFiles: ["schema.gen.ts", "src/generated/api.ts"]`; `agentSetup.files` = `AGENTS.md` (agents-md),
`CLAUDE.md` (claude-md); `messages: []`. Without the patterns the same inputs give 4/9 = 44.44% and `fail` — the
fixture shows exclusions flipping the gate. No excluded path is a substring of a kept path (`README.md`,
`src/app.ts`, `src/util.ts`), and the deleted `src/generated/old.ts` appears nowhere. Expected `report.md`:

```markdown
## ✅ pharn-ci: pass

### Diff coverage

**80%** of changed lines covered (4/5, threshold 80%)

| File | Coverage | Covered | Uncovered lines |
| --- | ---: | ---: | --- |
| `src/app.ts` | 100% | 2/2 |  |
| `src/util.ts` | 66.67% | 2/3 | 7 |

<details><summary>Excluded: 2 files</summary>

- `schema.gen.ts`
- `src/generated/api.ts`

</details>

### Agent setup

| Path | Kind |
| --- | --- |
| `AGENTS.md` | agents-md |
| `CLAUDE.md` | claude-md |

<sub>pharn-ci 0.1.0 · report schema v1</sub>
```

## Files

- `packages/core/src/glob.ts` — new: hand-written, regex-free, linear glob matcher (`compileGlob`, `matchGlob`); no validation
- `packages/core/src/config.ts` — `parseExcludePattern` export; `coverage.exclude` in `PharnConfig`; block list read for `coverage.exclude` only; validation of its items
- `packages/core/src/diffCoverage.ts` — optional `isExcluded` predicate; excluded changed files skipped and collected into `excludedFiles`; shared `byPath` sort
- `packages/core/src/report.ts` — optional `ReportDiffCoverage.excludedFiles`, copied by `buildReport` only when non-empty
- `packages/core/src/check.ts` — `CheckInput.exclude`; validate, de-duplicate and compile patterns first; pass the predicate to `computeDiffCoverage`
- `packages/core/src/render/markdown.ts` — the `<details>` "Excluded: N files" block in the Diff coverage section
- `packages/core/src/index.ts` — re-export `compileGlob`, `matchGlob` and `parseExcludePattern`
- `schema/report.v1.json` — optional `diffCoverage.excludedFiles` (array of non-empty strings), documented; not required
- `packages/cli/src/main.ts` — repeatable `--exclude <glob>` flag and help line; early validation; union with `coverage.exclude`
- `packages/action/src/run.ts` — `exclude` input split on commas and newlines, blanks dropped; early validation; union with `coverage.exclude`
- `action.yml` — declare the optional `exclude` input
- `fixtures/golden-exclusions/ci.yml` — the fixture's patterns and threshold (AC-17)
- `fixtures/golden-exclusions/pr.diff` — the fixture diff (AC-17)
- `fixtures/golden-exclusions/coverage.info` — the fixture lcov (AC-17)
- `fixtures/golden-exclusions/files.txt` — the fixture tracked-files list (AC-17)
- `fixtures/golden-exclusions/report.json` — golden JSON, written by `pnpm vitest run -u` on the AC-17 test file only, reviewed
- `fixtures/golden-exclusions/report.md` — golden markdown, written the same way, reviewed
- `README.md` — `exclude` row in the Action inputs table; `[--exclude <glob>]...` in the CLI usage plus a bullet; `coverage.exclude` in the config example; a short "Excluding files" note: the three sources merge (union, never override), the glob subset (`*`, `**`, `?`; anchored, whole path, case-sensitive; no braces, negation or classes), a pattern starting with `*` must be quoted in YAML, excluded files are listed in the report, and protect `.pharn/ci.yml` with CODEOWNERS because a PR can exclude its own files; one "What it proves" bullet saying exclusions come from the PR
- `docs/LIMITS.md` — §1: replace "There is no exclude list yet" with what exclusions do (changed files only, removed from every count and the table, listed in `excludedFiles` and the comment; deleted files never listed; the inventory and `COVERAGE_FILE_EMPTY` unaffected; every changed file excluded is the `NO_COVERABLE_CHANGES` pass) and the glob subset and what it does not support (braces, negation, classes, case-insensitivity, unanchored gitignore-style patterns; rejected rather than matched literally); §5: exclusions come from the PR, so the gate is only as honest as the config the PR carries; recommend CODEOWNERS
- `docs/THREAT-MODEL.md` — row A1: add the `coverage.exclude` list reader and the glob matcher (rejects unsupported syntax, matches hostile paths as given without throwing, linear on long paths and long lists) citing their AC tests; row B1: excluded paths are rendered through the same code spans, citing the AC-16 test; §3: a new named residual — exclusions come from the PR, a PR can exclude its own files (ultimately every file, which passes as `NO_COVERABLE_CHANGES`), and the gate is as honest as the config the PR carries, as with the coverage file; statuses unchanged
- `CHANGELOG.md` — under Unreleased → Added: exclusions from `coverage.exclude`, `--exclude` and the Action's `exclude` input, merged; the optional `diffCoverage.excludedFiles` report field and the "Excluded" summary in the comment
- `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build` (core is bundled into it)

### Explicitly not touched

- `packages/core/src/coverage/` — coverage parsing and format selection are another run (SPEC non-goal)
- `packages/core/src/setup/scan.ts` — the agent setup inventory never sees exclusions
- `packages/core/src/diff/unified.ts` — the diff parser is reused as is
- `packages/core/src/paths.ts` — patterns and changed paths are matched without normalization
- `packages/cli/src/nodeDeps.ts` — no new I/O
- `packages/cli/src/index.ts` — entry point unchanged
- `packages/action/src/index.ts` — inputs are read through the existing `getInput`
- `packages/core/test/config.test.ts` — its "lists are not supported" case must pass unchanged
- `packages/core/test/golden.test.ts` — the existing golden test is reused as the model, not edited
- `packages/core/test/markdown.test.ts` — existing render tests unchanged
- `packages/cli/test/main.test.ts` — existing CLI tests unchanged
- `packages/action/test/run.test.ts` — existing Action tests unchanged; the Action stays lcov-only
- `fixtures/golden/report.json` — must not change (SPEC Constraints)
- `fixtures/golden/report.md` — must not change (SPEC Constraints)
- `.pharn/ci.yml` — this repo's own config is not changed
- `LIMITS.md` — PHARN's root-level document, not a product doc
- `THREAT-MODEL.md` — PHARN's root-level document, not a product doc
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change (AGENTS.md rule 6)

## Acceptance mapping

- AC-1 → `matchGlob`: globstar segment semantics at the segment level, `*`/`?` per code point within a segment,
  collapsed `**` inside a segment, literal everything else, case-sensitive.
- AC-2 → `parseExcludePattern`: trim, strip repeated `./`, the rejection list, the raw pattern in the message;
  `matchGlob(parseExcludePattern("./src/**"), p) === matchGlob("src/**", p)`.
- AC-3 → no path normalization in `glob.ts`; `/` is the only separator; code-point iteration; no throw path.
- AC-4 → set-of-states simulation at both levels, O(pattern × path).
- AC-5 → the block-list reader (items deeper than or at the key's column, quoted/plain, comments) and
  `validateConfig`'s `exclude` case; `exclude:` alone stays `null` and yields no field.
- AC-6 → `validateConfig` (scalar, number, empty string, rejected pattern), the mapping-item rule, `parseScalar`'s
  existing `unsupported YAML syntax` (unquoted `*` item, flow list), and the unchanged `lists are not supported`
  for a list anywhere else.
- AC-7 → per-line O(length) parsing and validation.
- AC-8 → `computeDiffCoverage` skips excluded files before counting; `excludedFiles` sorted with `byPath`; verdict
  from the recomputed percent; schema-valid via the new optional field.
- AC-9 → exclusion tested on `file.path` after the `deleted` skip and before the coverage lookup.
- AC-10 → `coverableLines` 0 → existing `NO_COVERABLE_CHANGES` pass; `excludedFiles` still listed.
- AC-11 → `excludedFiles` set only when non-empty, in both `computeDiffCoverage` and `buildReport`.
- AC-12 → the predicate reaches `computeDiffCoverage` only; `scanAgentSetup` unchanged.
- AC-13 → `check()` validates every pattern before any early return.
- AC-14 → the schema property is optional, typed as an array of `minLength: 1` strings.
- AC-15 → the renderer's `<details>` block, its singular/plural summary, placement after the table or the
  no-coverable line, and nothing when the field is absent.
- AC-16 → excluded paths go through `code()`, one list line each.
- AC-17 → the golden-exclusions fixture above and the snapshot files produced with `-u` on that test only.
- AC-18 → CLI `--exclude` (`multiple: true`), union with the config's patterns, de-duplication in `check()`, exit
  code from the verdict, the help line.
- AC-19 → early `parseExcludePattern` in `runCheck`, config validation in `parseConfig`; both reach `main`'s catch,
  exit 2, pattern in stderr.
- AC-20 → `splitPatternList`, union with the config's patterns, `report.json` written as today, the
  `diff-coverage` output from the recomputed percent.
- AC-21 → early `parseExcludePattern` on the input entries; `run`'s catch calls `setFailed` with the pattern.

## Risks & open questions

- **For `/pharn-test` (red run):** read fixtures, and build hostile or 100,000-character inputs, inside each test
  body, never at module top level or in an `it.each` table. `fixtures/golden-exclusions/` does not exist before the
  build; a top-level read would fail the whole file at collection and its tests would be "never collected", not red.
  Each test's leaf title must start `AC-<n>:`.
- **For `/pharn-test`:** before the build, `matchGlob`, `compileGlob` and `parseExcludePattern` are not exported.
  Import them from `../src/index.js` (core) so the public export is what is tested, and confirm the file still
  collects: vitest's module transform turns a missing named export into `undefined` at the call (a red
  `TypeError`), but if collection fails instead, use a namespace import (`import * as core from "../src/index.js"`).
  The CLI and Action tests are red because `--exclude` is an unknown option (exit 2) and the `exclude` input is
  ignored.
- **AC-17 snapshot ordering:** the AC-17 test must assert schema validity, `excludedFiles` and its absence from
  `files` **before** the two `toMatchFileSnapshot` calls, so a wrong report fails on the assertion rather than being
  written as a new snapshot (vitest writes a missing file snapshot outside CI).
- **Rendering cap (a plan decision for `/pharn-grill`):** the SPEC asks for one list item per excluded path and
  says nothing of a cap. This plan cuts the list at `maxRows` (50 by default, like both tables) with a
  `…and N more files` item, so the summary can never push the verdict and messages out of the 65,000-character
  comment; `report.json` and the job summary keep everything. Every AC case is far below the cap. If the grill
  judges this to go beyond the SPEC, drop the cap; nothing else depends on it.
- **The mapping-item rule** (an unquoted item containing `": "` or ending in `":"` is rejected) is how YAML reads
  such a line; a real pattern with `": "` in it must be quoted. The `nested lists` rejection exists for the same
  reason. Both are stated in the README note.
- **Timing ACs (AC-4, AC-7)** are wall-clock on a shared runner; both algorithms are linear with small constants, so
  the margin under 1000 ms should be wide. If CI ever flakes, the bound is the SPEC's to change, not the test's.
- **Two validation points, one rule:** the CLI and the Action validate early only for a clean error before any git
  or file work; `check()` validates again so no caller can bypass it. `parseExcludePattern` is idempotent, so the
  second pass is a no-op on already normalized patterns.
- The SPEC's Constraints mention `pnpm build`; this plan uses the action-only build because it writes exactly the
  committed bundle and nothing outside scope. CI's dist check compares only `packages/action/dist`.
