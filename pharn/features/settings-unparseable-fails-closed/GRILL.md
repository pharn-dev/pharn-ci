# Grill log — settings-unparseable-fails-closed

Plan: `pharn/features/settings-unparseable-fails-closed/PLAN.md` — chain: GREEN (verified by pharn/floor/check-plan-spec-agree.mjs) · lessons: GREEN (verified by pharn/floor/check-plan-lessons.mjs)

mode: floor-only (/pharn-grill --floor-only)

interrogation NOT performed — skipped by mode (floor-only). The plan was not interrogated and no model-driven griller
ran, so no model finding was sought and none is reported. This is not a "no findings" result: no interrogation
happened at all.

## Deterministic plan scans (`pharn/floor/grill-scan.mjs`)

Advisory: each finding below gates nothing. The scanners detect a pattern's presence on a line; a scanner finding
is not the griller's judgment.

Findings: none (no secrets, PII or i18n scanner hit).

- `scan-plan-migrations`: mentions false. Not a finding: whether the plan needs or adequately declares this is the migrations griller's judgment.
- `scan-plan-observability`: mentions false. Not a finding: whether the plan needs or adequately declares this is the observability griller's judgment.

The two floor results above are this run's only grill claims. `/pharn-grill settings-unparseable-fails-closed`
without `--quick` or `--floor-only` interrogates the plan.
