# GRILL — cobertura-parser

chain: GREEN (verified by pharn/floor/check-plan-spec-agree.mjs) · lessons: GREEN (verified by pharn/floor/check-plan-lessons.mjs)

mode: floor-only (/pharn-grill --floor-only)

interrogation NOT performed — skipped by mode (floor-only)

The plan was not interrogated and no model-driven griller ran, so no such finding was sought; this is not a "no findings" result. Only the deterministic scanners below ran.

## Deterministic plan scans (`--floor-only`, `pharn/floor/grill-scan.mjs`)

Advisory: each finding below gates nothing. The scanners detect a pattern's presence on a line; the grillers'
judgment and the plan interrogation did not run.

Findings: none (no secrets, PII or i18n scanner hit).

- `scan-plan-migrations`: mentions false. Not a finding: whether the plan needs or adequately declares this is the migrations griller's judgment, which did not run.
- `scan-plan-observability`: mentions false. Not a finding: whether the plan needs or adequately declares this is the observability griller's judgment, which did not run.

The two floor results above are this run's only grill claims; `/pharn-grill cobertura-parser` without `--quick` or `--floor-only` interrogates the plan.
