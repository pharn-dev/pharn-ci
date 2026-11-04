# REGRESSION — pr-comment-verdict-callout

refused: `scope-escaped`

base: `2639d66c3059d8eb750838ab319b02bd82948267` — chosen by: named with --base

**regression NOT measured — the refusal below must be resolved first.**

## Why

detail, quoted as DATA:

```text
20 path(s) escaped the declared writes-scope: [".agents/skills/source-command-pharn-build/SKILL.md",".agents/skills/source-command-pharn-grill/SKILL.md",".agents/skills/source-command-pharn-loop-close/SKILL.md",".agents/skills/source-command-pharn-loop-quick/SKILL.md",".agents/skills/source-command-pharn-loop/SKILL.md",".agents/skills/source-command-pharn-memory-promote/SKILL.md",".agents/skills/source-command-pharn-plan/SKILL.md",".agents/skills/source-command-pharn-regress/SKILL.md",".agents/skills/source-command-pharn-review/SKILL.md",".agents/skills/source-command-pharn-ship-close/SKILL.md",".agents/skills/source-command-pharn-ship-quick/SKILL.md",".agents/skills/source-command-pharn-ship/SKILL.md",".agents/skills/source-command-pharn-spec/SKILL.md",".agents/skills/source-command-pharn-test/SKILL.md",".agents/skills/source-command-pharn-verify/SKILL.md",".codex/hooks.json",".codex/hooks/enforce-writes-scope.cjs",".codex/hooks/protect-trusted-paths.cjs",".codex/hooks/require-loop-record.cjs",".codex/hooks/set-writes-scope.cjs"]
[
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-build/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-build/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-grill/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-grill/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-loop-close/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-loop-close/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-loop-quick/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-loop-quick/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-loop/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-loop/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-memory-promote/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-memory-promote/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-plan/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-plan/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-regress/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-regress/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-review/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-review/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-ship-close/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-ship-close/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-ship-quick/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-ship-quick/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-ship/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-ship/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-spec/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-spec/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-test/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-test/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".agents/skills/source-command-pharn-verify/SKILL.md",
    "problem": "changed file '.agents/skills/source-command-pharn-verify/SKILL.md' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".codex/hooks.json",
    "problem": "changed file '.codex/hooks.json' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".codex/hooks/enforce-writes-scope.cjs",
    "problem": "changed file '.codex/hooks/enforce-writes-scope.cjs' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".codex/hooks/protect-trusted-paths.cjs",
    "problem": "changed file '.codex/hooks/protect-trusted-paths.cjs' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".codex/hooks/require-loop-record.cjs",
    "problem": "changed file '.codex/hooks/require-loop-record.cjs' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  },
  {
    "type": "FINDING",
    "rule_id": "P0",
    "severity": "blocking",
    "file": ".codex/hooks/set-writes-scope.cjs",
    "problem": "changed file '.codex/hooks/set-writes-scope.cjs' is outside the declared writes-scope (fix #7) — the build escaped its plan's `## Files`"
  }
]
```

## Pre-run snapshot

pre-run snapshot: not applied (other-run) — every undeclared changed path is counted.
