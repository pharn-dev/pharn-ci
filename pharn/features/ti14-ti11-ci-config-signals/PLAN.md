---
spec_id: ti14-ti11-ci-config-signals
spec_content_hash: 1a16131eba572490379738a594cc41f1dc91d04469fb694e90bccc5a91287835
applied_lessons: none
---

## Approach

Add two pure detectors next to `detectTI01` and feed them through the path TI01 already uses. The diff reader keeps line
text for a wider group of files: test files (as now), the pharn-ci config in use, and workflow files. A new selector
`keepSignalFileText(configPath?, repoRoot?)` builds that predicate; `check()` uses it when it parses a diff text, and
`readDiffChunks(chunks, options?)` uses it for the streaming path, with the CLI and the Action passing the config path and
repo root they already hold, so both paths keep the same files. A parsed diff that arrives without kept text (a caller that
parsed it without the selector) produces no TI14 or TI11 signal, because no line is visible; this is stated in LIMITS.

`detectTI14(diff, { configPath, exclude, mode })` reads only the config file's hunks. `detectTI11(diff, mode)` reads only
workflow files' hunks (`.github/workflows/*.yml|*.yaml`). Both work from added and removed lines alone (the local diff is
`--unified=0`). Each rule yields at most one signal per file at its first matching line, with a fixed detail sentence and
no file text; block rules take the effective mode (`warn` mode turns block into warn), warn-by-design rules stay `warn`.
`check()` concatenates TI01, TI11 and TI14 signals and sorts them by id, path, line (null first), detail in code-unit
order. `buildReport` gets one generic message path for the three ids (level from the highest severity, paths via
`pathList`), keeping TI01's text; the renderer gets hints for the two new codes and ids. Mode `off` computes nothing.

## Applied lessons

- none — this project has no memory-bank yet (the lessons index verdict is NO_CANON), so there is no lesson to cite.

## Steps

- `gateInputs.ts`: factor out `configRepoPath(configPath, repoRoot): string | null` (the normalized repo-relative config path,
  or null when it is outside the repo) from `changedConfigPaths`, which keeps its behaviour; export it.
- `signals/signalFiles.ts` (new): `isWorkflowFile(path)` (starts with `.github/workflows/`, ends `.yml` or `.yaml`, no deeper
  directory) and `keepSignalFileText(configPath?, repoRoot?)` returning a `(file) => boolean` that is true for a test file
  (`keepTestFileText`), the config in use, or a workflow file, by new or old path.
- `signals/yamlLines.ts` (new): small linear helpers on one line of text: strip a trailing comment outside quotes, unquote a
  scalar, split a one-line flow list into trimmed unquoted items, read `key: value` and `- item` shapes. Each helper cuts its
  input to 400 characters first.
- `signals/ti14.ts` (new): `detectTI14`. Config file = the diff entry whose path or old path equals the normalized config path
  (none when the path is outside the repo). Rule 1 (threshold): the last removed and last added line shaped `threshold:
  <plain decimal>`; lowered when the added number is smaller, or removed with nothing added (a deleted or renamed-away config
  included); equal, raised, only added, quoted or non-numeric values give nothing; severity is the mode; the signal's line is
  the added line (new file) or the removed line (old file) and the detail names the numbers. Rule 2 (exclusion): collect
  items from an added `exclude: [..]` flow list, from added `- item` lines that follow an added `exclude:` key line with
  consecutive line numbers in the same hunk, and from added bare `- item` lines whose unquoted value, normalized with
  `parseExcludePattern` (a throw counts as no match), equals one of the check input's exclusion patterns; drop items whose
  unquoted value is also among the removed list items or removed flow items of the file; the first remaining item gives one
  signal, severity the mode, fixed detail.
- `signals/ti11.ts` (new): `detectTI11`. Rule 1 (block): removed non-comment line whose command (after `- `, `run:` and `|`)
  starts with a listed test runner; normalized text (prefix stripped, whitespace collapsed) not found among added lines of any
  workflow file in the diff. Rule 2 (block): removed trigger line (`pull_request` or `pull_request_target` as a key, a list
  item, or inside an `on:` value) when no added line of the same file carries either token in a trigger shape. Rule 3 (warn):
  removed and added `key: [..]` flow lists with the same key (not a trigger filter such as `branches`, `paths`, `types`,
  `tags`) where the added set is smaller than the removed set. Rule 4 (warn): added `continue-on-error: true` with no
  identical removed line. Rule 5 (warn): added `if:` whose expression, after stripping `${{ }}` and quotes, is `false` or an
  event-name test excluding pull requests. Rule 6 (warn): added `timeout-minutes:` literal integer 0 or 1, with no identical
  removed line. Pure renames and binary files give nothing; every detail is a fixed sentence.
- `check.ts`: parse a diff text with `keepText: keepSignalFileText(input.configPath, input.repoRoot)`; compute
  `[...detectTI01, ...detectTI11, ...detectTI14]` (mode `off` or no diff gives none), sort, pass to `buildReport`.
- `chunkInputs.ts`: `readDiffChunks(chunks, options?: { configPath?: string; repoRoot?: string })` selects with
  `keepSignalFileText`; without options it keeps test files, workflows and `.pharn/ci.yml`.
- `report.ts`: add codes `TEST_INTEGRITY_TI11` and `TEST_INTEGRITY_TI14`; replace the TI01-only block by a loop over the ids
  `TI01`, `TI11`, `TI14` that adds one message per id with signals (error, warn or info by the highest severity); keep TI01's
  texts byte-identical; fixed sentences for the two new ids naming the paths.
- `render/markdown.ts`: add `MESSAGE_HINTS` for the two codes and `SIGNAL_HINTS` for the two ids (no accept label).
- `index.ts`: export `keepSignalFileText`, `isWorkflowFile`, `detectTI11`, `detectTI14` and the options type.
- CLI `main.ts`: pass `{ configPath, repoRoot }` (the `--config` value resolved as already done for `check`) to `readDiffChunks`.
- Action `run.ts`: pass `{ configPath: input("config"), repoRoot: deps.workspace }` to `readDiffChunks` in `getDiff`.
- Existing tests: `ac-stream-check.test.ts` builds its parsed diff with `parseUnifiedDiff(text)` and no text kept, so with the
  config-lowering fixture the text and parsed forms would now differ; give its `parsedDiff` helper the same selector
  (`keepText`) so both forms see the same lines. `ac-config-changed.test.ts` is checked and changed only if a signal now
  alters one of its assertions. Reasons go in BUILD.md.
- Fixtures: diffs under `fixtures/test-integrity/TI14/` and `fixtures/test-integrity/TI11/` in real `git diff --unified=0`
  shape; each rule has a must-trigger and a must-not-trigger case.
- Docs: CHANGELOG, README, `docs/LIMITS.md` (sections "What TI14 misses" and "What TI11 misses"; the kept-text paragraph names
  the config and workflow files), `docs/THREAT-MODEL.md`, schema description.
- Run `pnpm build` so `packages/action/dist/index.js` is rebuilt; goldens change only if one lists these signals.

## Files

- `packages/core/src/gateInputs.ts` — `configRepoPath`, shared with the selector
- `packages/core/src/signals/signalFiles.ts` — the keep-text selector and the workflow-file test (new)
- `packages/core/src/signals/yamlLines.ts` — bounded one-line helpers (new)
- `packages/core/src/signals/ti14.ts` — the TI14 detector (new)
- `packages/core/src/signals/ti11.ts` — the TI11 detector (new)
- `packages/core/src/check.ts` — selector on the text path, the three detectors, sorting
- `packages/core/src/chunkInputs.ts` — `readDiffChunks` options and selector
- `packages/core/src/report.ts` — message codes and the per-id messages
- `packages/core/src/render/markdown.ts` — hints for the new codes and ids
- `packages/core/src/index.ts` — exports
- `packages/cli/src/main.ts` — passes the config path and repo root to the reader
- `packages/action/src/run.ts` — passes the config input and workspace to the reader
- `schema/report.v2.json` — the message-code description names the two new codes
- `packages/core/test/ac-stream-check.test.ts` — existing test: its parsed-diff helper keeps the same text (reason in BUILD.md)
- `packages/cli/test/ac-config-changed.test.ts` — existing test: touched only if a new signal alters an assertion
- `fixtures/test-integrity/TI14/block-threshold-lowered.diff` — threshold 80 to 70
- `fixtures/test-integrity/TI14/block-threshold-removed.diff` — threshold line removed
- `fixtures/test-integrity/TI14/block-config-deleted.diff` — config file deleted
- `fixtures/test-integrity/TI14/block-exclude-flow.diff` — an `exclude: [..]` flow list added
- `fixtures/test-integrity/TI14/block-exclude-block.diff` — an `exclude:` key with block items added
- `fixtures/test-integrity/TI14/block-exclude-appended.diff` — an item appended to an existing list
- `fixtures/test-integrity/TI14/pass-threshold-raised.diff` — threshold 80 to 90
- `fixtures/test-integrity/TI14/pass-threshold-moved.diff` — threshold line moved, same value
- `fixtures/test-integrity/TI14/pass-threshold-added.diff` — threshold added where none was
- `fixtures/test-integrity/TI14/pass-exclude-removed.diff` — an exclusion removed
- `fixtures/test-integrity/TI14/pass-exclude-moved.diff` — an exclusion item reordered
- `fixtures/test-integrity/TI14/pass-unrelated-setup.diff` — `setup.require` changed
- `fixtures/test-integrity/TI14/pass-file-item-added.diff` — an item added to `coverage.file`
- `fixtures/test-integrity/TI11/block-test-step-removed.diff` — a `pnpm test:coverage` step removed
- `fixtures/test-integrity/TI11/block-workflow-deleted.diff` — a workflow with a test step deleted
- `fixtures/test-integrity/TI11/block-trigger-removed.diff` — the `pull_request:` key removed
- `fixtures/test-integrity/TI11/block-trigger-flow.diff` — `on: [push, pull_request]` to `on: [push]`
- `fixtures/test-integrity/TI11/warn-matrix-reduced.diff` — `[18, 20, 22]` to `[20, 22]`
- `fixtures/test-integrity/TI11/warn-continue-on-error.diff` — `continue-on-error: true` added
- `fixtures/test-integrity/TI11/warn-if-false.diff` — `if: false` added
- `fixtures/test-integrity/TI11/warn-if-event.diff` — `if: github.event_name == 'push'` added
- `fixtures/test-integrity/TI11/warn-timeout-one.diff` — `timeout-minutes: 1` added
- `fixtures/test-integrity/TI11/pass-step-moved.diff` — a test step moved to another workflow
- `fixtures/test-integrity/TI11/pass-step-reflowed.diff` — a test command reflowed
- `fixtures/test-integrity/TI11/pass-comment-removed.diff` — a commented-out test line removed
- `fixtures/test-integrity/TI11/pass-trigger-kept.diff` — `push` added beside a kept `pull_request`
- `fixtures/test-integrity/TI11/pass-matrix-grown.diff` — a matrix grown
- `fixtures/test-integrity/TI11/pass-continue-expression.diff` — `continue-on-error` set to an expression
- `fixtures/test-integrity/TI11/pass-if-always.diff` — `if: always()` added
- `fixtures/test-integrity/TI11/pass-timeout-fifteen.diff` — `timeout-minutes: 15` added
- `fixtures/test-integrity/TI11/pass-action-bump.diff` — an action version bump
- `fixtures/test-integrity/TI11/pass-pure-rename.diff` — a workflow renamed with no edit
- `fixtures/test-integrity/TI11/pass-non-workflow.diff` — a non-workflow YAML file with firing lines
- `CHANGELOG.md` — Unreleased entry
- `README.md` — names TI14 and TI11 and their message codes
- `docs/LIMITS.md` — what TI14 and TI11 miss, and the kept-text paragraph
- `docs/THREAT-MODEL.md` — the diff reader keeps text of the config and workflow files
- `packages/action/dist/index.js` — rebuilt bundle

### Explicitly not touched

- `schema/report.v1.json` — unchanged, a test pins it to the base commit
- `packages/core/src/signals/ti01.ts` — TI01 keeps its rules and texts
- `packages/core/src/testIntegrityMode.ts` — the mode rules from the earlier increment
- `packages/core/src/diff/unified.ts` — the reader already keeps text for any selected file
- `packages/core/src/testFiles.ts` — the test-file helpers stay as they are

## Acceptance mapping

- AC-1 → `keepSignalFileText` selects test files, the config in use (default or custom), workflows; `hunks` only for those.
- AC-2 → `readDiffChunks` options; streamed and whole-text reports equal; without the config path no TI14 on a custom config.
- AC-3 → TI14 rule 1 over the threshold cases.
- AC-4 → TI14 rule 2 with the three item sources and the controls.
- AC-5 → config path outside the repo gives no TI14; the in-repo path gives one.
- AC-6 → TI11 rule 1 with move, reflow, comment and rename exemptions.
- AC-7 → TI11 rule 2 with the kept-trigger controls.
- AC-8 → TI11 rule 3, warn severity in block mode.
- AC-9 → TI11 rule 4, literal true only.
- AC-10 → TI11 rule 5, literal false and event-name tests only.
- AC-11 → TI11 rule 6 and the no-fire diffs (bump, new job, dependabot.yml, a non-workflow path).
- AC-12 → combined diff in modes block, warn, off: sorting, severities, verdicts, messages, `CONFIG_CHANGED_IN_DIFF` kept.
- AC-13 → renderer lines, hints, empty state, CLI JSON, schema-valid reports.
- AC-14 → existing assertions kept; the two helper-level test edits only; TI01 fixtures unchanged.
- AC-15 → schema description, CHANGELOG, README, LIMITS, THREAT-MODEL, fixture counts.

## Risks & open questions

- With no context lines, `continue-on-error`, `if:` and timeout lines cannot be tied to a test step, so those rules are warn
  by design; a job-level `continue-on-error` on the test job is reported only as a warning.
- A parsed diff handed to `check()` without kept text yields no TI14 or TI11; the Action and CLI always keep it.
- Rule (c) of the exclusion rule trusts `input.exclude`; a pattern added to `coverage.file` that equals an exclusion pattern
  would be read as an exclusion (stated in LIMITS).
- `ac-config-changed.test.ts` and `ac-stream-check.test.ts` use the config-lowering fixture; if other existing tests surface
  new signals, the build records the minimal change and the reason in BUILD.md.
