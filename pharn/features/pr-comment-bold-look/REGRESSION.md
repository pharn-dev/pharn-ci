# REGRESSION — pr-comment-bold-look

base: `caab309707e049317bb5d46aa7d6c6f334848c1c` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `start-dirty`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (57):

```text
CHANGELOG.md
README.md
fixtures/coverage-paths/package-relative/report.md
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.md
fixtures/golden/report.md
packages/action/dist/index.js
packages/action/test/ac-comment-fit.test.ts
packages/action/test/ac-comment-look-fit.test.ts
packages/action/test/ac-summary-fit.test.ts
packages/action/test/run.test.ts
packages/cli/test/main.test.ts
packages/core/src/render/markdown.ts
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/ac-comment-look-collapse.test.ts
packages/core/test/ac-comment-look-data.test.ts
packages/core/test/ac-comment-look-footer.test.ts
packages/core/test/ac-comment-look-header.test.ts
packages/core/test/ac-comment-look-hostile.test.ts
packages/core/test/ac-comment-look-summary.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-markdown-order-cap.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-setup-expect-render.test.ts
packages/core/test/ac-setup-render.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/markdown.test.ts
.agents/skills/source-command-pharn-build/SKILL.md
.agents/skills/source-command-pharn-grill/SKILL.md
.agents/skills/source-command-pharn-loop-close/SKILL.md
.agents/skills/source-command-pharn-loop-quick/SKILL.md
.agents/skills/source-command-pharn-loop/SKILL.md
.agents/skills/source-command-pharn-memory-promote/SKILL.md
.agents/skills/source-command-pharn-plan/SKILL.md
.agents/skills/source-command-pharn-regress/SKILL.md
.agents/skills/source-command-pharn-review/SKILL.md
.agents/skills/source-command-pharn-ship-close/SKILL.md
.agents/skills/source-command-pharn-ship-quick/SKILL.md
.agents/skills/source-command-pharn-ship/SKILL.md
.agents/skills/source-command-pharn-spec/SKILL.md
.agents/skills/source-command-pharn-test/SKILL.md
.agents/skills/source-command-pharn-verify/SKILL.md
.codex/hooks.json
.codex/hooks/enforce-writes-scope.cjs
.codex/hooks/protect-trusted-paths.cjs
.codex/hooks/require-loop-record.cjs
.codex/hooks/set-writes-scope.cjs
packages/action/test/ac-comment-bold-fit.test.ts
packages/cli/test/ac-comment-bold-cli.test.ts
packages/core/test/ac-comment-bold-data.test.ts
packages/core/test/ac-comment-bold-details.test.ts
packages/core/test/ac-comment-bold-footer.test.ts
packages/core/test/ac-comment-bold-header.test.ts
packages/core/test/ac-comment-bold-hostile.test.ts
packages/core/test/ac-comment-bold-overview.test.ts
packages/core/test/ac-comment-bold-sections.test.ts
```

declared (37):

```text
packages/core/src/render/markdown.ts
fixtures/golden/report.md
fixtures/golden-cobertura/report.md
fixtures/golden-exclusions/report.md
fixtures/golden-multi/report.md
fixtures/coverage-paths/package-relative/report.md
packages/core/test/__snapshots__/markdown.test.ts.snap
packages/core/test/markdown.test.ts
packages/core/test/ac-format-golden.test.ts
packages/core/test/ac-paths-partial.test.ts
packages/core/test/ac-setup-render.test.ts
packages/core/test/ac-setup-expect-render.test.ts
packages/core/test/ac-markdown-order-cap.test.ts
packages/core/test/exclusions-report.test.ts
packages/core/test/ac-comment-look-header.test.ts
packages/core/test/ac-comment-look-summary.test.ts
packages/core/test/ac-comment-look-collapse.test.ts
packages/core/test/ac-comment-look-footer.test.ts
packages/core/test/ac-comment-look-hostile.test.ts
packages/core/test/ac-comment-look-data.test.ts
packages/action/test/ac-comment-look-fit.test.ts
packages/action/test/ac-comment-fit.test.ts
packages/action/test/ac-summary-fit.test.ts
packages/action/test/run.test.ts
packages/cli/test/main.test.ts
README.md
CHANGELOG.md
packages/action/dist/index.js
packages/core/test/ac-comment-bold-header.test.ts
packages/core/test/ac-comment-bold-overview.test.ts
packages/core/test/ac-comment-bold-sections.test.ts
packages/core/test/ac-comment-bold-details.test.ts
packages/core/test/ac-comment-bold-footer.test.ts
packages/core/test/ac-comment-bold-hostile.test.ts
packages/core/test/ac-comment-bold-data.test.ts
packages/action/test/ac-comment-bold-fit.test.ts
packages/cli/test/ac-comment-bold-cli.test.ts
```

already changed when this run began (20) — the run's pre-run snapshot recorded these with exactly the bytes they hold now, so they are reported, NOT counted as this build's escape (a re-run records an earlier run's escape the same way; pre-run-snapshot-core.mjs states the bounds):

```text
.agents/skills/source-command-pharn-build/SKILL.md
.agents/skills/source-command-pharn-grill/SKILL.md
.agents/skills/source-command-pharn-loop-close/SKILL.md
.agents/skills/source-command-pharn-loop-quick/SKILL.md
.agents/skills/source-command-pharn-loop/SKILL.md
.agents/skills/source-command-pharn-memory-promote/SKILL.md
.agents/skills/source-command-pharn-plan/SKILL.md
.agents/skills/source-command-pharn-regress/SKILL.md
.agents/skills/source-command-pharn-review/SKILL.md
.agents/skills/source-command-pharn-ship-close/SKILL.md
.agents/skills/source-command-pharn-ship-quick/SKILL.md
.agents/skills/source-command-pharn-ship/SKILL.md
.agents/skills/source-command-pharn-spec/SKILL.md
.agents/skills/source-command-pharn-test/SKILL.md
.agents/skills/source-command-pharn-verify/SKILL.md
.codex/hooks.json
.codex/hooks/enforce-writes-scope.cjs
.codex/hooks/protect-trusted-paths.cjs
.codex/hooks/require-loop-record.cjs
.codex/hooks/set-writes-scope.cjs
```

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
