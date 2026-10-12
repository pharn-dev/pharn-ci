# GRILL — coverage-exclusions

pharn/features/coverage-exclusions/PLAN.md — chain: GREEN (verified by pharn/floor/check-plan-spec-agree.mjs) · lessons: GREEN (verified by pharn/floor/check-plan-lessons.mjs)

mode: floor-only (/pharn-grill --floor-only)

interrogation NOT performed — skipped by mode (floor-only)

The plan was not interrogated, no model-driven griller ran, and no interrogation finding was sought, so none is
reported. This is not a "no findings" result: no interrogation happened at all. Only the five deterministic
`scan-plan-*` scanners ran; their output follows, verbatim and advisory.

## Deterministic plan scans (`--floor-only`, `pharn/floor/grill-scan.mjs`)

Advisory: each finding below gates nothing. The scanners detect a pattern's presence on a line; the grillers'
judgment and the plan interrogation did not run.

```yaml
- type: FINDING
  rule_id: "P7"
  severity: important
  file: "pharn/features/coverage-exclusions/PLAN.md:106"
  problem: "a hardcoded user-facing string appears in the plan (scan-plan-i18n, i18n griller's deterministic half)"
  evidence: "scan-plan-i18n matched kind jsx-text-literal on line 106"
- type: FINDING
  rule_id: "P7"
  severity: important
  file: "pharn/features/coverage-exclusions/PLAN.md:297"
  problem: "a hardcoded user-facing string appears in the plan (scan-plan-i18n, i18n griller's deterministic half)"
  evidence: "scan-plan-i18n matched kind jsx-text-literal on line 297"
```

- `scan-plan-migrations`: mentions false. Not a finding: whether the plan needs or adequately declares this is the migrations griller's judgment, which did not run.
- `scan-plan-observability`: mentions true — lines 335 (spans). Not a finding: whether the plan needs or adequately declares this is the observability griller's judgment, which did not run.

The two floor results above are this run's only grill claims. `/pharn-grill coverage-exclusions` without `--quick`
or `--floor-only` interrogates the plan.
