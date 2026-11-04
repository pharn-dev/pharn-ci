chain: GREEN (verified by pharn/floor/check-plan-spec-agree.mjs) · lessons: GREEN (verified by pharn/floor/check-plan-lessons.mjs)

mode: floor-only (/pharn-grill --floor-only)

interrogation NOT performed — skipped by mode (floor-only)

The plan was not interrogated, no griller ran, and no finding was sought, so none is reported. This is not a "no findings"
result: no interrogation happened at all.

## Deterministic plan scans (`pharn/floor/grill-scan.mjs`)

Advisory: each finding below gates nothing. The scanners detect a pattern's presence on a line.

Findings: none (no secrets, PII or i18n scanner hit).

- `scan-plan-migrations`: mentions false.
- `scan-plan-observability`: mentions false.

The two floor results above are this run's only grill claims. `/pharn-grill ti03-ti04-skip-only-signals` without
`--floor-only` interrogates the plan.
