---
spec_id: cobertura-parser
spec_content_hash: a0f430ad49367ef04424d15f71b4cb1700f45f85d4d0c7ad684ded2f4c449f3c
applied_lessons: none
---

## Approach

> ADVISORY model work. Planned from the Approved, un-drifted SPEC (`check-spec-approved.mjs` GREEN this run).
> Everything below was read live this run: `packages/core/src/coverage/{cobertura,index,lcov,types}.ts`,
> `packages/core/src/paths.ts`, `packages/core/src/check.ts`, `packages/core/src/index.ts`,
> `packages/core/test/{lcov,purity,golden,paths,helpers,schema}.ts`, `docs/LIMITS.md`, `docs/THREAT-MODEL.md`,
> `CHANGELOG.md`, `biome.json`, `.gitattributes`, `vitest.config.ts`, `package.json` and the package manifests.

Replace the throwing stub in `packages/core/src/coverage/cobertura.ts` with a real parser, keeping its exported
signature `parseCobertura(text: string, options: ParseCoverageOptions = {}): CoverageMap` unchanged. The dispatch in
`coverage/index.ts` already routes `"cobertura"` to it, and `index.ts` already exports it, so neither changes; once the
stub stops throwing, `check()` reports `COVERAGE_FILE_EMPTY` for an empty map with no change to `check.ts`.

The parser is two layers, one reason to change each:

1. **`packages/core/src/coverage/xml.ts` — a minimal, linear, non-recursive XML pull scanner** (no Cobertura
   knowledge). One forward index walks the text once; it uses `indexOf` and per-character checks, never a regular
   expression, over the untrusted text. It yields, in order, start tags (name, attributes, self-closing flag), end
   tags (name) and text runs between tags. Rules:
   - A leading U+FEFF is skipped.
   - `<!--` skips to the next `-->`; `<![CDATA[` skips to the next `]]>`; `<?` skips to the next `?>`. When the
     terminator is missing, scanning stops: everything from that opener to the end of the text is ignored, and
     everything before it has already been yielded. CDATA content is never yielded, as text or as markup.
   - Any other `<!` (DOCTYPE and the like) skips to the next `>` outside quotes. An internal DTD subset is not
     supported; it degrades to skipped declarations and ignored text, never to an error.
   - A tag runs from `<` to the first `>` outside a quoted attribute value. A `<` met anywhere inside a tag (quoted or
     not, since `<` is illegal in XML attribute values) drops the broken tag and scanning resumes at that `<`. A tag
     still open at the end of the text is dropped. Together these make a long run of `<`, an unterminated quoted
     value, and an unterminated tag linear: every character is visited a bounded number of times.
   - Attributes are read by hand: name, optional whitespace, `=`, optional whitespace, a `'` or `"` quoted value. An
     unquoted or value-less attribute is skipped; for a duplicated name the first wins. Attribute order, quote style
     and whitespace or newlines inside a tag do not matter.
   - Attribute values and text runs are entity-decoded: the five predefined entities and decimal/hex numeric
     references (`&#NN;`, `&#xHH;`, valid code points only, via `String.fromCodePoint`). The `;` is looked for only
     within a short bounded window after `&`, so decoding stays linear; anything unrecognised stays literal.
   - Element names are compared exactly; a prefixed name (`ns:class`) is a different name and so is ignored by the
     Cobertura layer. Processing instructions are skipped.
   - No element stack is kept, so deep nesting costs nothing.

2. **`packages/core/src/coverage/cobertura.ts` — the Cobertura semantics** over the scanner's events, with a handful of
   flags and counters, no stack:
   - **Sources:** `<sources>` sets an in-sources flag (cleared by `</sources>`); a non-self-closing `<source>` inside it
     collects text runs until `</source>`. The collected text is trimmed; an empty one is skipped. Sources are kept in
     document order.
   - **Classes:** `<class>` (non-self-closing) opens a class context with its decoded `filename` attribute; a class
     with no or an empty `filename` contributes nothing. `</class>` closes it; a new `<class>` start replaces an open
     one. A self-closing `<class/>` has no lines.
   - **Methods:** a non-self-closing `<methods>` or `<method>` inside a class increments a method-depth counter, its
     end tag decrements it (never below 0). A `<line>` counts only when a class is open and the depth is 0, so a
     method-only line number never appears and a method's own hit count never overrides the class-level one.
   - **Lines:** `<line>` (self-closing or open/close) inside a class reads `number` and `hits`. Valid on the lcov `DA`
     rule (SPEC Assumptions): `Number(number)` is an integer >= 1; `hits` absent means 0, otherwise its trimmed text
     must be non-empty and `Number(hits)` finite and >= 0. Anything else is skipped silently. `branch`,
     `condition-coverage` and every other attribute are ignored. A line counts as soon as it is read, so a class left
     unclosed at a stop point keeps the lines read before it.
   - **Accumulation:** lines are first merged per raw `filename` (maximum hits per line number), so each distinct
     filename is resolved once after the scan, when every `<source>` is known regardless of where `<sources>` sat.
     Resolved keys are then merged into the result map by maximum hits. A file entry is created only when it receives
     a valid line, so a class with only invalid lines, or none, is absent.
   - **Path resolution** (SPEC Scope and Assumptions), for a decoded filename `f`, the trimmed sources `S` and the
     optional `repoRoot`:
     1. `f` absolute (leading `/` or a drive letter, after `\` → `/`): never joined; the key is
        `normalizePath(f, repoRoot)` — repo-relative under the root on a whole-segment match, otherwise normalized
        and still absolute (AC-9).
     2. Otherwise, for each source `s` in order, join `s + "/" + f`:
        - `s` absolute: the join qualifies only when `repoRoot` is given and `normalizePath(join, repoRoot)` comes back
          relative (that is, it lay under the root on a whole-segment match); that relative path is the key.
        - `s` relative: the join qualifies when `normalizePath(join)` is non-empty, is not `..` and does not begin
          with `../`; that normalized path is the key.
        - The first qualifying source wins (AC-10). A join whose `..` segments climb above the root therefore never
          qualifies, and no key produced by a join begins with `..` (AC-12).
     3. No source qualifies, or there are no sources: the key is `normalizePath(f, repoRoot)` — the filename as
        written with `\` → `/` and `.`/`..` segments resolved (AC-11). A filename that itself climbs keeps its leading
        `..` here; that key is not "produced by a source join".
   - Absolute-path detection is a new small export of `packages/core/src/paths.ts`, `isAbsolutePath(path: string):
     boolean`, using the same rule `toPosix` already applies (leading `/` or `X:/` after backslash conversion),
     written with character checks rather than a new regex. `normalizePath`'s behaviour is unchanged.

The merge rule (maximum) intentionally differs from lcov's (sum): Cobertura repeats one file's lines across inner
and outer classes and across packages that compile a shared source, and summing would double-count.

The fixtures are small hand-written files following each tool's published output shape (SPEC Assumptions). The
expected maps live in the AC test files (written first by `/pharn-test`), so the fixture contents are fixed here,
below, so that the tests and the build agree on them.

## Applied lessons

- none — `check-lessons-index.mjs --verdict` returned `NO_CANON`: this project has no `memory-bank/lessons-learned.md`
  yet, so there are no lessons to apply.

## Steps

- Add `isAbsolutePath` to `packages/core/src/paths.ts` (character checks; same rule as `toPosix`), with cases in
  `packages/core/test/paths.test.ts` (`/a`, `\a`, `C:\a`, `c:/a` absolute; `a`, `./a`, `C:a` and the empty string
  not absolute).
- Write `packages/core/src/coverage/xml.ts`: the pull scanner described in Approach, exported as a small iterator or
  callback API (`scanXml(text, onEvent)` or a generator) plus `decodeEntities`. No regex over the input; no recursion;
  no I/O. Comments in core source must not contain the words `process`, `require`, `fetch` or `globalThis`
  followed by `.` or `(` (the purity test greps the text, comments included).
- Rewrite `packages/core/src/coverage/cobertura.ts` over the scanner as in Approach; replace the "planned for M3" doc
  comment with one describing what is read, what is ignored, the max-merge rule and path resolution, in the style of
  `lcov.ts`'s doc comment.
- In `packages/core/test/lcov.test.ts`, replace the test "cobertura is a stub until M3" (it asserts the throw this
  change removes; AGENTS.md rule 4 permits fixing a wrong test with the reason stated) with "dispatches cobertura",
  the twin of "dispatches lcov": `parseCoverage('<coverage><packages><package><classes><class filename="a.py"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>', "cobertura").get("a.py")?.get(1)`
  is `1`. Drop the now-unused `parseCobertura` import there if nothing else uses it. Nothing else in the file changes.
- Write the fixtures below in `fixtures/cobertura/` (fixtures are `-text` in `.gitattributes` and outside Biome, so
  their bytes are kept as written). Use LF and no BOM; the CRLF and BOM forms of AC-5 are made in the test from these
  files.
- Update `docs/LIMITS.md` §1 and §3, `docs/THREAT-MODEL.md` rows A1 and A2 and `CHANGELOG.md` (details under Files).
  The THREAT-MODEL citations use the exact `file › test` titles of the AC tests `/pharn-test` wrote — read them from
  the test files, do not invent them.
- Regenerate the committed Action bundle with `pnpm --filter @pharn-ci/action build` (it runs `tsc --noEmit` and
  writes only `packages/action/dist/index.js`; core is bundled from source, so no core build is needed). Do not run
  the root `pnpm build` in the build stage: it also writes `packages/core/dist/` and `packages/cli/dist/`, which are
  gitignored and outside this plan's scope.
- Run `pnpm lint` and `pnpm test`; format only the TypeScript files this plan names, one by one
  (`pnpm biome check --write <file>`).

### Fixture contents (the contract between the AC tests and the build)

Unless stated, the repo root passed is `/home/runner/work/demo/demo` and hits are written as given. "lines" lists
class-level `<line>` records as `number:hits`. Every fixture's expected map is given; it is what the parser must
return with that root.

- `coveragepy.xml` — coverage.py `coverage xml` shape: `<?xml version="1.0" ?>`, `<coverage version=… timestamp=…
  lines-valid=… line-rate=… …>`, the two coverage.py header comments, `<sources><source>/home/runner/work/demo/demo/src</source></sources>`,
  packages `.` and `pkg`, classes with `name`, `filename`, `complexity`, `line-rate`, `branch-rate`, an empty
  `<methods/>` and `<lines>`. Classes: `app.py` lines 1:1, 2:1, 4:0, 5:1; `pkg/__init__.py` with `<lines/>`;
  `pkg/util.py` lines 1:1, 3:0, 4:2. Expected: `src/app.py` {1:1, 2:1, 4:0, 5:1}, `src/pkg/util.py` {1:1, 3:0, 4:2}.
- `pytest-cov.xml` — the coverage.py shape as pytest-cov writes it from the repo root:
  `<source>/home/runner/work/demo/demo</source>`, package `mypkg`. Classes: `mypkg/__init__.py` lines 1:1;
  `mypkg/core.py` lines 1:1, 2:1, 5:0, 6:0, 9:3. Expected: `mypkg/__init__.py` {1:1}, `mypkg/core.py`
  {1:1, 2:1, 5:0, 6:0, 9:3}.
- `jacoco.xml` — JaCoCo converted to Cobertura (cover2cover shape): XML declaration, the Cobertura `<!DOCTYPE coverage
  SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">` line,
  `<source>/home/runner/work/demo/demo/src/main/java</source>`, `<line>` records carrying `branch="false"` or
  `branch="true" condition-coverage="50% (1/2)"`, and `<methods>` blocks whose method `<lines>` repeat the class-level
  lines. Package `com.example`: class `com.example.Calculator`, filename `com/example/Calculator.java`, lines 3:1, 5:0,
  6:2 (branch), 10:0; class `com.example.Calculator$Inner`, same filename, lines 5:4, 10:0, 12:1. Package
  `com.example.util`: class `com.example.util.Strings`, filename `com/example/util/Strings.java`, lines 3:0, 4:0.
  Expected: `src/main/java/com/example/Calculator.java` {3:1, 5:4, 6:2, 10:0, 12:1},
  `src/main/java/com/example/util/Strings.java` {3:0, 4:0}.
- `coverlet.xml` — coverlet (.NET) shape: `<?xml version="1.0" encoding="utf-8"?>`, `<source>C:\a\demo\demo\</source>`,
  backslash filenames, `<line number hits branch>` attribute order with `branch="False"`/`"True"` and a
  `<conditions>` child on the branch line, and `<methods>` with per-method `<lines>`. Repo root passed:
  `C:\a\demo\demo`. Package `Demo`: class `Demo.Calculator`, filename `src\Demo\Calculator.cs`, lines 8:3, 9:3, 12:0
  (branch, with `<conditions>`); class `Shared.Guard`, filename `src\Shared\Guard.cs`, lines 3:1, 4:0. Package
  `Demo.Cli`: class `Shared.Guard`, filename `src\Shared\Guard.cs`, lines 3:0, 4:2 (a linked shared source, so one
  file in two packages). Expected: `src/Demo/Calculator.cs` {8:3, 9:3, 12:0}, `src/Shared/Guard.cs` {3:1, 4:2}.
- `forms-base.xml` — plain form: no declaration, double quotes, `number` before `hits`, self-closing `<line/>`.
  `<source>/home/runner/work/demo/demo</source>`; class `src/a.py` lines 1:1, 2:0, 3:5; class `src/b.py` lines 1:0.
- `forms-variant.xml` — the same document with every attribute order reversed, single quotes throughout, open/close
  `<line …></line>` tags, and line breaks and extra spaces inside tags.
- `forms-decorated.xml` — the same document with an XML declaration, the Cobertura DOCTYPE line, a comment before the
  root and a comment and a CDATA section between the packages, each containing
  `<class filename="src/evil.py"><lines><line number="99" hits="1"/></lines></class>`, plus, inside `src/a.py`'s
  `<lines>`, a comment `<!-- <line number="4" hits="9"/> -->` and `<![CDATA[<line number="5" hits="7"/>]]>`.
  Expected for all three forms, and for each with a leading BOM and with `\n` → `\r\n` applied in the test:
  `src/a.py` {1:1, 2:0, 3:5}, `src/b.py` {1:0}.
- `entities.xml` — `<source>/home/runner/work/demo/demo</source>`; class filename `src/R&amp;D/x.py` lines 1:1; class
  filename `src/&#x41;pp.py` lines 2:1. Expected: `src/R&D/x.py` {1:1}, `src/App.py` {2:1}.
- `invalid-lines.xml` — no `<sources>`; class `src/a.py` lines: `<line number="1"/>` (no hits), `number="x" hits="1"`,
  `number="3" hits="many"`, `number="4" hits="2"`, `number="0" hits="1"`, `number="-2" hits="1"`,
  `number="5.5" hits="1"`, `number="6" hits="-1"`, `number="7" hits=""`. Expected: `src/a.py` {1:0, 4:2}.
- `methods-branches.xml` — no `<sources>`; class `src/a.py` with `<methods><method name="f" signature="()"><lines>`
  holding 7:3 and 2:9 `</lines></method></methods>`, then class-level `<lines>` 1:1 and
  `<line number="2" hits="0" branch="true" condition-coverage="50% (1/2)"/>`. Expected: `src/a.py` {1:1, 2:0}.
- `absolute-filenames.xml` — `<source>/home/runner/work/demo/demo/lib</source>`; class filename
  `/home/runner/work/demo/demo/src/a.py` lines 1:1; class filename `/opt/elsewhere/./vendor/../b.py` lines 2:0.
  Expected: `src/a.py` {1:1}, `/opt/elsewhere/b.py` {2:0}.
- `multi-source.xml` — sources in order `/opt/build/other`, `/home/runner/work/demo/demo/pkg`,
  `/home/runner/work/demo/demo/alt`; class filename `mod/a.py` lines 1:1. Expected: `pkg/mod/a.py` {1:1}.
- `no-sources.xml` — no `<sources>` element; class filename `src\win\.\a.cs` lines 1:1; class filename `./lib/b.py`
  lines 2:1. Expected (with or without a root): `src/win/a.cs` {1:1}, `lib/b.py` {2:1}.
- `sources-outside.xml` — sources `/opt/build/a` and `/opt/build/b`; class filename `src\x.py` lines 3:2. Expected:
  `src/x.py` {3:2}.
- `climb.xml` — sources in order `../outside` (relative) and `/home/runner/work/demo/demo/src`; class filename `a.py`
  lines 2:1; class filename `../../escape.py` lines 1:1. Expected: `src/a.py` {2:1} (the `../outside/a.py` join is
  refused), `../../escape.py` {1:1} (both joins refused — one begins with `..`, the other lies outside the root — so
  the filename as written is used; it is neither `../outside/…` nor `/home/runner/work/demo/escape.py`).
- `empty.xml` — zero bytes. Expected: empty map.
- `garbage.xml` — non-XML text with no `<` at all (a few lines of prose and `key=value` pairs). Expected: empty map.
- `no-lines.xml` — a valid Cobertura document whose classes have `<lines/>` or `<lines></lines>`, one of them with a
  `<methods>` block holding lines (which do not count). Expected: empty map.
- `partial-valid.xml` — class `src/good.py` lines 1:1; class `src/bad.py` whose lines are all invalid
  (`number="x"`, `number="0"`, `hits="-1"`). Expected: `src/good.py` {1:1} only.

### Hostile inputs (AC-16, generated in the test, not committed)

`VALID` = `<coverage><packages><package name="p"><classes><class name="a" filename="src/a.py"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>`,
parsed with no repo root, expected map `src/a.py` {1:1}. Each input is about 4 MB; each must return the expected map
without throwing in under 1000 ms:

- `VALID + "<!--" + junk` where junk repeats `<class filename="x.py"><lines><line number="1" hits="1"/>` → {src/a.py: {1:1}}.
- `VALID + "<![CDATA[" + junk` → {src/a.py: {1:1}}.
- `VALID + '<class filename="' + "a".repeat(~4e6)` (no `<` after it, so the quote never closes) → {src/a.py: {1:1}}.
- `"<".repeat(~4e6) + VALID` → {src/a.py: {1:1}}.
- `"<n>".repeat(~3e5) + VALID + "</n>".repeat(~3e5)` → {src/a.py: {1:1}}.

## Files

- `packages/core/src/coverage/xml.ts` — new: linear, non-recursive, regex-free XML pull scanner and entity decoder (no Cobertura knowledge)
- `packages/core/src/coverage/cobertura.ts` — replace the throwing stub with the Cobertura parser over `xml.ts`; same exported signature
- `packages/core/src/paths.ts` — add the `isAbsolutePath` export; `normalizePath` unchanged
- `packages/core/test/paths.test.ts` — add `isAbsolutePath` cases; existing cases untouched
- `packages/core/test/lcov.test.ts` — replace the stub test "cobertura is a stub until M3" with "dispatches cobertura"; drop the unused import
- `fixtures/cobertura/coveragepy.xml` — coverage.py fixture (AC-1)
- `fixtures/cobertura/pytest-cov.xml` — pytest-cov fixture (AC-2)
- `fixtures/cobertura/jacoco.xml` — JaCoCo Cobertura-converted fixture, inner and outer classes (AC-3)
- `fixtures/cobertura/coverlet.xml` — coverlet (.NET) fixture, Windows paths, one file in two packages (AC-4)
- `fixtures/cobertura/forms-base.xml` — surface-form base document (AC-5)
- `fixtures/cobertura/forms-variant.xml` — attribute order, quotes, open/close tags (AC-5)
- `fixtures/cobertura/forms-decorated.xml` — declaration, DOCTYPE, comments and CDATA holding markup (AC-5)
- `fixtures/cobertura/entities.xml` — `&amp;` and a numeric reference in filenames (AC-6)
- `fixtures/cobertura/invalid-lines.xml` — missing hits and invalid number/hits values (AC-7)
- `fixtures/cobertura/methods-branches.xml` — method-only line and a branch line (AC-8)
- `fixtures/cobertura/absolute-filenames.xml` — absolute filenames inside and outside the root (AC-9)
- `fixtures/cobertura/multi-source.xml` — several sources, first qualifying wins (AC-10)
- `fixtures/cobertura/no-sources.xml` — no `<sources>` element (AC-11)
- `fixtures/cobertura/sources-outside.xml` — every source join outside the root (AC-11)
- `fixtures/cobertura/climb.xml` — joins climbing above the root (AC-12)
- `fixtures/cobertura/empty.xml` — zero-byte report (AC-13, AC-14)
- `fixtures/cobertura/garbage.xml` — non-XML text (AC-13)
- `fixtures/cobertura/no-lines.xml` — classes with no counted lines (AC-13, AC-14)
- `fixtures/cobertura/partial-valid.xml` — one valid class, one all-invalid class (AC-13)
- `docs/LIMITS.md` — §3: replace "lcov only" with what ships (core reads Cobertura; the CLI reads it via `coverage.format: cobertura` in config; the Action still rejects it), Cobertura's skipped-silently rule, ignored methods/branches/rates, max-merge vs lcov's sum, first-qualifying-source rule and its ambiguity bound; §1: extend the coverable-line and repo-relative-path bullets to Cobertura `<line>` records and add the monorepo caveat for Cobertura filenames
- `docs/THREAT-MODEL.md` — row A1: add Cobertura to the parsers (skipped constructs, malformed `<line>` skipped, linear on hostile input) citing its AC tests; row A2: add `<source>`-join resolution (absolute filenames never joined, joins accepted only under the root, no `..`-led join keys) citing its AC tests; statuses unchanged
- `CHANGELOG.md` — one line under Unreleased → Added: Cobertura XML coverage parsing in core, read by the CLI through `coverage.format: cobertura`; the Action still accepts lcov only
- `packages/action/dist/index.js` — regenerated with `pnpm --filter @pharn-ci/action build` (core is bundled into it)

### Explicitly not touched

- `packages/core/src/coverage/index.ts` — already dispatches `"cobertura"` to `parseCobertura`
- `packages/core/src/coverage/types.ts` — `CoverageMap`, `ParseCoverageOptions` and the format list are reused as is
- `packages/core/src/index.ts` — `parseCobertura` is already exported
- `packages/core/src/check.ts` — an empty map already yields `COVERAGE_FILE_EMPTY`
- `packages/core/src/coverage/lcov.ts` — no lcov refactor (SPEC non-goal)
- `packages/core/src/report.ts` — Report v1 types unchanged
- `schema/report.v1.json` — unchanged (AGENTS.md rule 2)
- `packages/cli/src/main.ts` — no CLI plumbing change (run 2)
- `packages/action/src/run.ts` — the Action keeps rejecting `cobertura` (run 2)
- `packages/action/test/run.test.ts` — its "not supported yet" assertion stays true
- `packages/core/test/golden.test.ts` — no Cobertura golden test (run 2)
- `LIMITS.md` — PHARN's root-level document, not a product doc
- `THREAT-MODEL.md` — PHARN's root-level document, not a product doc
- `vitest.config.ts` — test infrastructure, pinned by `/pharn-test`
- `package.json` — no dependency or script change

## Acceptance mapping

- AC-1 → `coveragepy.xml` + the absolute-source join under the root (resolution step 2) gives the expected keys.
- AC-2 → `pytest-cov.xml` with the repo-root source.
- AC-3 → `jacoco.xml`; per-filename max merge across the outer and inner `<class>` blocks; method lines ignored.
- AC-4 → `coverlet.xml`; backslashes normalized by `normalizePath`, drive-letter root matched case-insensitively,
  cross-package max merge.
- AC-5 → the scanner's quote/order/whitespace-agnostic attribute reader, self-closing and open/close handling, BOM
  skip, CRLF as ordinary whitespace, and comment/CDATA/DOCTYPE/declaration skipping; the three `forms-*.xml` fixtures
  plus in-test BOM and CRLF transforms.
- AC-6 → attribute entity decoding (`entities.xml`).
- AC-7 → the `<line>` validity rule (`invalid-lines.xml`).
- AC-8 → the method-depth counter and ignored branch attributes (`methods-branches.xml`).
- AC-9 → resolution step 1 (`absolute-filenames.xml`).
- AC-10 → resolution step 2, first qualifying source (`multi-source.xml`).
- AC-11 → resolution step 3 (`no-sources.xml`, `sources-outside.xml`).
- AC-12 → the join qualification rules in step 2 (`climb.xml`).
- AC-13 → no file entry without a valid line; nothing thrown (`empty.xml`, `garbage.xml`, `no-lines.xml`,
  `partial-valid.xml`).
- AC-14 → `check()` unchanged: an empty map from `empty.xml` and `no-lines.xml` becomes `COVERAGE_FILE_EMPTY` with
  `diffCoverage` null, schema-valid.
- AC-15 → `parseCoverage(text, "cobertura", options)` delegates to `parseCobertura` unchanged; checked over every file
  in `fixtures/cobertura/`.
- AC-16 → the scanner's linear, stack-free design and its stop/resume rules (the hostile inputs above).

## Risks & open questions

- **For `/pharn-test` (red run):** read fixtures and list `fixtures/cobertura/` inside each test body, never at module
  top level or in an `it.each` table. Before the build the fixtures do not exist; a top-level read would fail the
  whole file at collection and the AC tests would be "never collected" rather than red. Each test's leaf title must
  start `AC-<n>:`.
- **For `/pharn-test`:** before the build, the stub throws, so every `parseCobertura`/`parseCoverage` call fails and
  each AC test is red for the right reason. AC-14's test is red because `check()` currently throws through the stub.
- **AC-16 timing** is wall-clock on a shared CI runner. The inputs are kept near 4 MB and the parser is linear, so the
  margin under 1000 ms should be wide; if CI ever flakes, the cause is the runner, and the bound is the SPEC's to
  change, not the test's.
- **`empty.xml` is zero bytes.** If the Write tool cannot create an empty file, stop and report rather than adding a
  newline, which would make it "whitespace" rather than "empty".
- **Multiple sources are ambiguous by nature:** core is pure and cannot check which joined file exists, so the first
  source whose join lies under the root wins even when a later one was the right one. This is a stated limit for
  `docs/LIMITS.md`, not a defect to fix here.
- **Stub-test replacement** (AGENTS.md rule 4): the reason — the test asserts the throw this change removes — must be
  recorded in the run's record and commit message, and later in the PR description (SPEC Assumptions). `/pharn-plan`
  writes neither; the loop's commit step owns it.
- **Purity test greps comments too:** no `process`, `require`, `fetch` or `globalThis` followed by `.` or `(` anywhere in
  `xml.ts` or `cobertura.ts`, comments included.
- The SPEC's Constraints mention `pnpm build`; this plan uses the action-only build because it writes exactly the
  committed bundle and nothing outside scope. The CI dist check compares only `packages/action/dist`, so the result is
  the same.
