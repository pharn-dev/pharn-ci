# REGRESSION — accept-label-human-signoff-4

base: `a1089fdeaddbf166996856eb59b632adc2d93827` — chosen by: named with --base

**verdict: NO REGRESSIONS** — no deterministically-detectable breakage outside the feature.

BASE evidence: produced by this invocation (not reused: `other-run`; entry evidence not used: `shape-mismatch`); recorded for reuse by a later /pharn-regress of this run.

install (UNMEASURED — no run of this stage has exercised this command):

```text
pnpm install --frozen-lockfile
```

HEAD install: NOT CHECKED (`unmeasured-family`, pnpm) — the gates ran over the working tree's install as it was, so a red gate may come from the install rather than from the change.

## Scope

inside (47):

```text
CHANGELOG.md
README.md
action.yml
docs/LIMITS.md
docs/THREAT-MODEL.md
packages/action/dist/index.js
packages/action/src/api.ts
packages/action/src/run.ts
packages/cli/test/ac-ti0304-render.test.ts
packages/cli/test/ac-ti1013-render.test.ts
packages/core/src/config.ts
packages/core/src/index.ts
packages/core/src/render/markdown.ts
packages/core/src/report.ts
schema/report.v2.json
fixtures/accept-label/block.diff
fixtures/accept-label/events-applied-twice-author-last.json
fixtures/accept-label/events-applied-twice-reviewer-last.json
fixtures/accept-label/events-author.json
fixtures/accept-label/events-bot.json
fixtures/accept-label/events-hostile-login.json
fixtures/accept-label/events-human.json
fixtures/accept-label/events-no-actor.json
fixtures/accept-label/events-no-matching-event.json
fixtures/accept-label/events-organization.json
fixtures/accept-label/events-unreadable.json
fixtures/accept-label/files.txt
fixtures/accept-label/no-signal.diff
fixtures/accept-label/or-true.diff
fixtures/accept-label/warn-only.diff
packages/action/src/accept-label.ts
packages/action/test/ac-accept-signoff-actor.test.ts
packages/action/test/ac-accept-signoff-custom.test.ts
packages/action/test/ac-accept-signoff-default-golden.test.ts
packages/action/test/ac-accept-signoff-fail-closed.test.ts
packages/action/test/ac-accept-signoff-history.test.ts
packages/action/test/ac-accept-signoff-honoured.test.ts
packages/action/test/ac-accept-signoff-input.test.ts
packages/action/test/ac-accept-signoff-not-asked.test.ts
packages/action/test/ac-accept-signoff-regression.test.ts
packages/cli/test/ac-accept-signoff-cli.test.ts
packages/cli/test/ac-accept-signoff-config.test.ts
packages/core/src/acceptLabel.ts
packages/core/test/ac-accept-signoff-docs.test.ts
packages/core/test/ac-accept-signoff-hints.test.ts
packages/core/test/ac-accept-signoff-line.test.ts
packages/core/test/ac-accept-signoff-schema.test.ts
```

declared (47):

```text
packages/core/src/acceptLabel.ts
packages/core/src/report.ts
packages/core/src/render/markdown.ts
packages/core/src/config.ts
packages/core/src/index.ts
packages/action/src/api.ts
packages/action/src/accept-label.ts
packages/action/src/run.ts
action.yml
schema/report.v2.json
README.md
CHANGELOG.md
docs/THREAT-MODEL.md
docs/LIMITS.md
packages/cli/test/ac-ti1013-render.test.ts
packages/cli/test/ac-ti0304-render.test.ts
fixtures/accept-label/files.txt
fixtures/accept-label/block.diff
fixtures/accept-label/or-true.diff
fixtures/accept-label/warn-only.diff
fixtures/accept-label/no-signal.diff
fixtures/accept-label/events-human.json
fixtures/accept-label/events-author.json
fixtures/accept-label/events-bot.json
fixtures/accept-label/events-organization.json
fixtures/accept-label/events-no-matching-event.json
fixtures/accept-label/events-applied-twice-author-last.json
fixtures/accept-label/events-applied-twice-reviewer-last.json
fixtures/accept-label/events-no-actor.json
fixtures/accept-label/events-hostile-login.json
fixtures/accept-label/events-unreadable.json
packages/action/dist/index.js
packages/action/test/ac-accept-signoff-input.test.ts
packages/cli/test/ac-accept-signoff-config.test.ts
packages/action/test/ac-accept-signoff-not-asked.test.ts
packages/action/test/ac-accept-signoff-honoured.test.ts
packages/action/test/ac-accept-signoff-custom.test.ts
packages/action/test/ac-accept-signoff-actor.test.ts
packages/action/test/ac-accept-signoff-fail-closed.test.ts
packages/action/test/ac-accept-signoff-history.test.ts
packages/core/test/ac-accept-signoff-hints.test.ts
packages/core/test/ac-accept-signoff-line.test.ts
packages/core/test/ac-accept-signoff-schema.test.ts
packages/cli/test/ac-accept-signoff-cli.test.ts
packages/action/test/ac-accept-signoff-default-golden.test.ts
packages/action/test/ac-accept-signoff-regression.test.ts
packages/core/test/ac-accept-signoff-docs.test.ts
```

pre-run snapshot: applied — no undeclared path was already changed when this run began.

## Gates

gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): build
gate: base exit 0 -> head exit 0 — ok — id (quoted, untrusted): test

style gates were SKIPPED (config-touch rule: no shared style config changed in scope).

## Pre-existing and regressions

pre_existing (0): (none)
regressions (0): (none)

_/pharn-regress catches exactly what the project's own deterministic suite catches, nothing more — but deterministically. This is not a claim that nothing broke._
